#!/usr/bin/env python3
import argparse,datetime,json,os,re,shutil,subprocess,tempfile,time,urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent
STATE=Path('/var/backups/poprush-request-trace');CONF=Path('/etc/nginx/conf.d/poprush-upstream.conf');SITE=Path('/etc/nginx/sites-enabled/poprush')
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def health():
 for _ in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/healthz',timeout=2) as r:
    if json.load(r).get('ok'):return
  except Exception:time.sleep(.5)
 raise RuntimeError('앱 healthz 확인 실패')
def patch_server(s):
 if "from './request-trace.mjs'" in s:return s
 if s.count('observeConnections(server);')!=1:raise ValueError('지원하는 server.mjs 형태가 아닙니다.')
 return "import {installTrace} from './request-trace.mjs';\n"+s.replace('observeConnections(server);','observeConnections(server);installTrace(server);')
def patch_nginx(conf,site):
 marker='# POP_RUSH request trace v1'
 if marker not in conf:
  conf+='''\n# POP_RUSH request trace v1
map $http_x_pop_trace_id $poprush_trace_log { default 0; ~^pr-[A-Za-z0-9-]+$ 1; }
log_format poprush_request_trace escape=json '{"id":"$http_x_pop_trace_id","end":"$msec","rt":"$request_time","status":$status,"method":"$request_method","path":"$uri","remotePort":"$remote_port","connection":"$connection","connectionRequests":"$connection_requests","upstream":"$upstream_addr","connect":"$upstream_connect_time","header":"$upstream_header_time","response":"$upstream_response_time","app":"$upstream_http_server_timing","meta":"$upstream_http_x_pop_trace_meta"}';
'''
 if 'access_log /var/log/nginx/poprush-request-trace.log ' not in site:
  if site.count('proxy_pass ')!=1 or not re.search(r'proxy_set_header\s+Host\s+',site):raise ValueError('단일 upstream/기존 proxy header 설정이 필요합니다.')
  site=re.sub(r'(proxy_pass\s+[^;]+;)',r'\1\n        proxy_set_header X-Pop-Trace-Id $http_x_pop_trace_id;\n        access_log /var/log/nginx/poprush-request-trace.log poprush_request_trace if=$poprush_trace_log;',site,count=1)
  site=site.replace('poprush_request_trace;','poprush_request_trace if=$poprush_trace_log;') if 'if=$poprush_trace_log;' not in site else site
 return conf,site

def restore(backup):
 data=json.loads((backup/'state.json').read_text())
 for name,value in data['nginx'].items():Path(name).write_text(value)
 run(['docker','cp',str(backup/'server.mjs'),'colorpop:'+data.get('entryPath','/app/server.mjs')])
 if data.get('previousTraceExists') is True:run(['docker','cp',str(backup/'request-trace.mjs'),'colorpop:/app/request-trace.mjs'])
 elif data.get('previousTraceExists') is False:run(['docker','exec','colorpop','node','-e','require("fs").rmSync("/app/request-trace.mjs",{force:true})'])
 run(['docker','restart','colorpop']);health();run(['nginx','-t']);run(['systemctl','reload','nginx'])
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--restore',type=Path);a=parser.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 install-trace.py 로 실행하세요.')
 if a.restore:restore(a.restore);print('추적 설치 전 상태로 복구 완료');return
 run(['nginx','-t']);run(['docker','inspect','colorpop'])
 confpath=CONF.resolve(strict=True);sitepath=SITE.resolve(strict=True)
 original={str(confpath):confpath.read_text(),str(sitepath):sitepath.read_text()}
 # Preflight entirely before changing the running application.
 with tempfile.TemporaryDirectory() as tmp:
  server=Path(tmp)/'server.mjs';run(['docker','cp','colorpop:/app/server.mjs',str(server)])
  old=server.read_text();entryPath='/app/server.mjs'
  if 'accept-only-primary' in old:
   entryPath='/app/game-worker.mjs';run(['docker','cp','colorpop:'+entryPath,str(server)]);old=server.read_text()
  updated=patch_server(old);conf,site=patch_nginx(original[str(confpath)],original[str(sitepath)])
  backup=STATE/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700)
  hasTrace=run(['docker','exec','colorpop','node','-e','process.stdout.write(String(require("fs").existsSync("/app/request-trace.mjs")))'])=='true'
  if hasTrace:run(['docker','cp','colorpop:/app/request-trace.mjs',str(backup/'request-trace.mjs')])
  (backup/'server.mjs').write_text(old);(backup/'state.json').write_text(json.dumps({'nginx':original,'entryPath':entryPath,'previousTraceExists':hasTrace}))
  candidate=Path(tmp)/'server.trace-candidate.mjs';candidate.write_text(updated)
  try:
   run(['docker','cp',str(HERE/'request-trace.mjs'),'colorpop:/app/request-trace.mjs'])
   run(['docker','cp',str(candidate),'colorpop:/app/server.trace-candidate.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/request-trace.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/server.trace-candidate.mjs'])
   confpath.write_text(conf);sitepath.write_text(site);run(['nginx','-t'])
   run(['docker','cp',str(candidate),'colorpop:'+entryPath])
   run(['docker','restart','colorpop']);health();run(['systemctl','reload','nginx'])
  except Exception:
   try:restore(backup);print('설치 실패: 이전 상태 복구 완료')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
 print('설치 완료. 게임 컨테이너를 재시작했습니다. DB와 게임 규칙은 변경하지 않았습니다.')
 print('복구: sudo -n python3 install-trace.py --restore '+str(backup))
if __name__=='__main__':main()
