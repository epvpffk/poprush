#!/usr/bin/env python3
import argparse,datetime,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=Path('/var/backups/poprush-pool')
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def patch(text):
 old="host:'0.0.0.0',backlog:4096"
 new="host:process.env.POPRUSH_GAME_BIND||'0.0.0.0',backlog:4096"
 if new not in text:
  if text.count(old)!=1:raise ValueError('지원하는 listen 형태가 아닙니다.')
  text=text.replace(old,new)
 ready="console.log('COLORPOP_READY '+server.address().port);"
 signal="if(process.send)process.send({type:'poprush-game-ready'});"
 if signal not in text:
  if text.count(ready)!=1:raise ValueError('지원하는 ready callback이 아닙니다.')
  text=text.replace(ready,ready+signal)
 return text

def health():
 for _ in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/arena',timeout=10) as r:
    if 'ranking' in json.load(r):return
  except Exception:time.sleep(.3)
 raise RuntimeError('풀 경유 API 확인 실패')
def restore(backup):
 run(['docker','cp',str(backup/'server.mjs'),'colorpop:/app/server.mjs']);run(['docker','cp',str(backup/'game-worker.mjs'),'colorpop:/app/game-worker.mjs']);run(['docker','restart','colorpop']);health()
def main():
 p=argparse.ArgumentParser();p.add_argument('--restore',type=Path);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 update.py --apply 로 실행하세요.')
 if a.restore:restore(a.restore);print('기존 연결 전달 구조 복구 완료');return
 with tempfile.TemporaryDirectory() as tmp:
  tmp=Path(tmp);server=tmp/'server.mjs';worker=tmp/'game-worker.mjs';run(['docker','cp','colorpop:/app/server.mjs',str(server)])
  if 'pooled-http-primary' in server.read_text():raise SystemExit('이미 풀 구조입니다. 변경 없음.')
  if 'accept-only-primary' not in server.read_text():raise SystemExit('먼저 통합 도구의 accept 단계를 적용해야 합니다.')
  run(['docker','cp','colorpop:/app/game-worker.mjs',str(worker)]);updated=patch(worker.read_text())
  backup=ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700)
  for name,file in [('server.mjs',server),('game-worker.mjs',worker)]:(backup/name).write_bytes(file.read_bytes())
  worker.write_text(updated)
  try:
   run(['docker','cp',str(worker),'colorpop:/app/game-worker.mjs']);run(['docker','exec','colorpop','node','--check','/app/game-worker.mjs'])
   run(['docker','cp',str(HERE/'pool-server.mjs'),'colorpop:/app/server.mjs']);run(['docker','exec','colorpop','node','--check','/app/server.mjs']);run(['docker','restart','colorpop']);health()
   if 'POP_RUSH_POOL_READY ' not in run(['docker','logs','--since','30s','colorpop']):raise RuntimeError('풀 시작 확인 실패')
  except (Exception,KeyboardInterrupt):
   try:restore(backup);print('적용 실패: 이전 실행 구조 복구 완료')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
  print('적용 완료: 게임 처리 1개 유지, 백엔드 재사용 연결 풀 64개. PC 요청량과 제한 시간 유지.')
  print('복구: sudo -n python3 apply-pool.py --restore '+str(backup))
if __name__=='__main__':main()
