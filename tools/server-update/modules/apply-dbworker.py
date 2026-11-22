#!/usr/bin/env python3
import argparse,datetime,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=Path('/var/backups/poprush-dbworker')
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def health():
 for _ in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/arena',timeout=10) as response:
    if isinstance(json.load(response),dict):return
  except Exception:time.sleep(.3)
 raise RuntimeError('DB를 사용하는 API 정상 응답 확인 실패')
def patch_shutdown(text):
 old='server.close(()=>{closeDatabase();'
 new='server.close(async()=>{await closeDatabase();'
 if new in text:return text
 if text.count(old)!=1:raise ValueError('서버 종료 처리 형태가 달라 변경하지 않습니다.')
 return text.replace(old,new)
def restore(backup):
 data=json.loads((backup/'state.json').read_text())
 run(['docker','cp',str(backup/'database.mjs'),'colorpop:/app/database.mjs'])
 run(['docker','cp',str(backup/'entry.mjs'),'colorpop:'+data['entry']])
 run(['docker','restart','colorpop']);health()
def main():
 p=argparse.ArgumentParser();p.add_argument('--restore',type=Path);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 apply-dbworker.py 로 실행하세요.')
 if a.restore:restore(a.restore);print('이전 DB 실행 구조로 복구 완료');return
 with tempfile.TemporaryDirectory() as tmp:
  tmp=Path(tmp);server=tmp/'entry.mjs';database=tmp/'database.mjs'
  run(['docker','cp','colorpop:/app/server.mjs',str(server)]);entry='/app/server.mjs'
  if 'accept-only-primary' in server.read_text():entry='/app/game-worker.mjs';run(['docker','cp','colorpop:'+entry,str(server)])
  run(['docker','cp','colorpop:/app/database.mjs',str(database)])
  if 'database-worker.mjs' in database.read_text():raise SystemExit('이미 DB worker 구조입니다. 변경 없음.')
  if 'new DatabaseSync' not in database.read_text() or 'enqueueWrite' not in database.read_text():raise SystemExit('지원하는 DB 코드가 아니므로 변경하지 않습니다.')
  updated=patch_shutdown(server.read_text())
  backup=ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700)
  (backup/'database.mjs').write_bytes(database.read_bytes());(backup/'entry.mjs').write_bytes(server.read_bytes());(backup/'state.json').write_text(json.dumps({'entry':entry}))
  server.write_text(updated)
  try:
   run(['docker','cp',str(HERE/'database-worker.mjs'),'colorpop:/app/database-worker.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/database-worker.mjs'])
   run(['docker','cp',str(HERE/'database.mjs'),'colorpop:/app/database.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/database.mjs'])
   run(['docker','cp',str(server),'colorpop:'+entry])
   run(['docker','exec','colorpop','node','--check',entry])
   run(['docker','restart','colorpop']);health()
   if 'POP_RUSH_DB_WORKER_READY' not in run(['docker','logs','--since','30s','colorpop']):raise RuntimeError('DB worker 시작 기록 확인 실패')
  except (Exception,KeyboardInterrupt):
   try:restore(backup);print('적용 실패: 이전 DB 코드로 복구했습니다.')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
  print('적용 완료: 게임 스레드와 동기 SQLite 실행 스레드 분리. COMMIT 이후에만 저장 성공 응답.')
  print('DB 파일·게임 규칙·Nginx·요청량·제한 시간은 변경하지 않았습니다.')
  print('복구: sudo -n python3 apply-dbworker.py --restore '+str(backup))
if __name__=='__main__':main()
