#!/usr/bin/env python3
import argparse,datetime,json,os,re,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path('/var/backups/poprush-payload-update')
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def patch(text):
 old=r'board: r\.status === ([\'"])waiting\1 \|\| p\.id !== id \? \[\] : p\.board'
 new="board: r.status === 'waiting' ? [] : p.board"
 if re.search(r'board: r\.status === ([\'"])waiting\1 \? \[\] : p\.board',text):return text
 updated,count=re.subn(old,new,text)
 if count!=1:raise ValueError('지원하는 view 함수 형태가 아니므로 변경하지 않습니다.')
 return updated
def health():
 for _ in range(25):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/arena',timeout=10) as r:
    if 'ranking' in json.load(r):return
  except Exception:time.sleep(.3)
 raise RuntimeError('API 확인 실패')
def restore(folder):
 run(['docker','cp',str(folder/'arena-api.mjs'),'colorpop:/app/arena-api.mjs']);run(['docker','restart','colorpop']);health()
def main():
 p=argparse.ArgumentParser();p.add_argument('--restore',type=Path);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 apply-payload.py 로 실행하세요.')
 if a.restore:restore(a.restore);print('이전 응답 구성 복구 완료');return
 with tempfile.TemporaryDirectory() as tmp:
  file=Path(tmp)/'arena-api.mjs';run(['docker','cp','colorpop:/app/arena-api.mjs',str(file)])
  original=file.read_text();updated=patch(original)
  if updated==original:raise SystemExit('이미 적용됐습니다. 변경 없음.')
  backup=ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700);(backup/'arena-api.mjs').write_text(original);file.write_text(updated)
  try:
   run(['docker','cp',str(file),'colorpop:/app/arena-api.mjs']);run(['docker','exec','colorpop','node','--check','/app/arena-api.mjs']);run(['docker','restart','colorpop']);health()
  except (Exception,KeyboardInterrupt):
   try:restore(backup);print('적용 실패: 이전 코드 복구 완료')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
  print('적용 완료: 모든 참가자의 실제 블록판을 다시 전송합니다. 라이브 스코어에서 상대 퍼즐을 표시합니다.')
  print('복구: sudo -n python3 apply-payload.py --restore '+str(backup))
if __name__=='__main__':main()
