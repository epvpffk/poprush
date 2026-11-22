#!/usr/bin/env python3
import argparse,datetime,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path('/var/backups/poprush-accept-update')
HERE=Path(__file__).resolve().parent

def run(args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def health():
 for _ in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/healthz',timeout=1) as response:
    if json.load(response).get('ok'):return
  except Exception:time.sleep(.3)
 raise RuntimeError('healthz 확인 실패')
def restore(path):
 run(['docker','cp',str(path/'server.mjs'),'colorpop:/app/server.mjs'])
 run(['docker','restart','colorpop']);health()
def main():
 p=argparse.ArgumentParser();p.add_argument('--restore',type=Path);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 apply-accept.py 로 실행하세요.')
 if a.restore:restore(a.restore);print('이전 실행 구조로 복구 완료');return
 run(['docker','inspect','colorpop'])
 with tempfile.TemporaryDirectory() as tmp:
  old=Path(tmp)/'server.mjs';run(['docker','cp','colorpop:/app/server.mjs',str(old)])
  text=old.read_text()
  if 'accept-only-primary' in text:raise SystemExit('이미 연결 수락 분리 구조입니다. 변경 없음.')
  if text.count('http.createServer(')!=1 or 'observeConnections(server);' not in text:raise SystemExit('지원하는 서버 코드 형태가 아닙니다. 변경하지 않습니다.')
  if 'cluster.' in text:raise SystemExit('다른 cluster 코드가 있어 변경하지 않습니다.')
  backup=ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700);(backup/'server.mjs').write_bytes(old.read_bytes())
  try:
   run(['docker','cp',str(old),'colorpop:/app/game-worker.mjs'])
   run(['docker','cp',str(HERE/'accept-launcher.mjs'),'colorpop:/app/accept-candidate.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/game-worker.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/accept-candidate.mjs'])
   run(['docker','cp',str(HERE/'accept-launcher.mjs'),'colorpop:/app/server.mjs'])
   run(['docker','restart','colorpop']);health()
   logs=run(['docker','logs','--since','30s','colorpop'])
   if 'POP_RUSH_ACCEPTOR_READY ' not in logs:raise RuntimeError('acceptor 시작 기록 확인 실패')
  except (Exception,KeyboardInterrupt):
   try:restore(backup);print('적용 실패: 이전 서버 코드로 복구했습니다.')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
  print('적용 완료: 연결 수락 프로세스 1개 + 게임 처리 프로세스 1개')
  print('DB/게임 규칙/Nginx/요청량/제한 시간은 변경하지 않았습니다.')
  print('복구: sudo -n python3 apply-accept.py --restore '+str(backup))
  print('추적 도구는 기존 설치 상태로 계속 사용하세요. install-trace.py를 다시 실행할 필요가 없습니다.')
if __name__=='__main__':main()
