#!/usr/bin/env python3
"""POP RUSH host backlog adjustment; no game/container restart."""
import argparse, datetime, json, os, re, subprocess, uuid
from pathlib import Path

NGINX = Path('/etc/nginx/sites-enabled/poprush')
SYSCTL = Path('/etc/sysctl.d/99-poprush-backlog.conf')
ROOT = Path('/var/backups/poprush-backlog')
KEY = 'net.ipv4.tcp_max_syn_backlog'
COUNTERS = ('SyncookiesSent','SyncookiesFailed','ListenOverflows','ListenDrops','TCPReqQFullDoCookies','TCPReqQFullDrop')

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()

def counters(text=None):
    lines = (Path('/proc/net/netstat').read_text() if text is None else text).splitlines()
    for a,b in zip(lines,lines[1:]):
        names,values = a.split(),b.split()
        if names and values and names[0] == values[0] == 'TcpExt:':
            data = dict(zip(names[1:],values[1:]))
            return {k:int(data[k]) for k in COUNTERS if k in data}
    raise ValueError('호스트 TCP 카운터를 읽지 못했습니다.')

def patch(text):
    pattern = r'(?m)^(\s*listen\s+80)([^;\n]*);([^\n]*)$'
    matches = list(re.finditer(pattern,text))
    if len(matches)!=1:
        raise ValueError('poprush 파일의 단일 listen 80 설정을 확인할 수 없습니다. 변경하지 않습니다.')
    def replace(m):
        options=m[2]
        old=re.search(r'\bbacklog=(\d+)\b',options)
        size=max(4096,int(old[1]) if old else 0)
        options=re.sub(r'\bbacklog=\d+\b','backlog='+str(size),options) if old else options+' backlog='+str(size)
        return m[1]+options+';'+m[3]
    return re.sub(pattern,replace,text)

def restore(path):
    data=json.loads(path.read_text())
    for name,value in data['files'].items():
        p=Path(name)
        if value is None:p.unlink(missing_ok=True)
        else:p.write_text(value)
    run(['sysctl','-w',KEY+'='+str(data['runtimeSynBacklog'])])
    run(['nginx','-t'])
    run(['systemctl','reload','nginx'])

def apply():
    run(['nginx','-t'])
    path=NGINX.resolve(strict=True)
    original=path.read_text();updated=patch(original)
    old=int(run(['sysctl','-n',KEY]));target=max(4096,old)
    syn_original=SYSCTL.read_text() if SYSCTL.exists() else None
    if syn_original is not None and not syn_original.startswith('# POP_RUSH host backlog v1'):
        raise ValueError('다른 설정이 있는 sysctl 파일이므로 변경하지 않습니다.')
    boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    baseline=counters()
    directory=ROOT/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    directory.mkdir(parents=True,mode=0o700)
    manifest=directory/'backup.json'
    manifest.write_text(json.dumps({'files':{str(path):original,str(SYSCTL):syn_original},'runtimeSynBacklog':old,'bootId':boot,'baseline':baseline},ensure_ascii=False,indent=2))
    try:
        path.write_text(updated)
        SYSCTL.write_text('# POP_RUSH host backlog v1\n'+KEY+' = '+str(target)+'\n')
        run(['nginx','-t'])
        run(['sysctl','-w',KEY+'='+str(target)])
        run(['systemctl','reload','nginx'])
        actual=int(run(['sysctl','-n',KEY]))
        if actual<target:raise ValueError('SYN 대기열 적용 확인 실패')
    except Exception:
        try:restore(manifest);print('적용 실패: 기존 설정으로 복원했습니다.')
        except Exception as error:print('자동 복원 오류:',str(error),'백업:',str(manifest))
        raise
    (ROOT/'latest').write_text(str(manifest))
    print('적용 완료: Nginx backlog 최소 4096 / 호스트 SYN backlog '+str(actual))
    print('게임 컨테이너와 데이터베이스는 변경하지 않았습니다.')
    print('검증: ss -lnt 에서 80번 포트 Send-Q 확인')
    print('시험 후 비교: sudo -n python3 backlog-update.py --report')
    print('복구: sudo -n python3 backlog-update.py --restore '+str(manifest))
    print('기준 카운터:',json.dumps(baseline,ensure_ascii=False))

def report():
    data=json.loads(Path((ROOT/'latest').read_text().strip()).read_text())
    if data['bootId']!=Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        raise ValueError('서버 재부팅으로 이전 기준과 비교할 수 없습니다.')
    current=counters()
    if any(current[k]<v for k,v in data['baseline'].items()):raise ValueError('카운터가 초기화되어 비교할 수 없습니다.')
    print(json.dumps({'scope':'호스트, 적용 시점 이후 누적 증가량; 특정 시험만의 건수는 아님','delta':{k:current[k]-v for k,v in data['baseline'].items()}},ensure_ascii=False,indent=2))

def main():
    parser=argparse.ArgumentParser();g=parser.add_mutually_exclusive_group();g.add_argument('--report',action='store_true');g.add_argument('--restore',type=Path);args=parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('sudo -n python3 backlog-update.py 로 실행하세요.')
    try:
        if args.report:report()
        elif args.restore:restore(args.restore);print('복원 완료')
        else:apply()
    except Exception as error:raise SystemExit('작업 실패: '+str(error))

if __name__=='__main__':main()
