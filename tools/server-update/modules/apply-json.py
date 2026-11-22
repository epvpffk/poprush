#!/usr/bin/env python3
import argparse,datetime,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=Path('/var/backups/poprush-json-update')
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def patch_api(text):
 if "from './json-reply.mjs'" in text:return text
 old="const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });"
 if text.count(old)!=1:raise ValueError('지원하는 arena-api 코드 형태가 아닙니다.')
 return "import {jsonReply} from './json-reply.mjs';\n"+text.replace(old,'const reply = jsonReply;')
def patch_server(text):
 if "typeof response.poprushJsonBody==='string'" in text:return text
 old='res.end(Buffer.from(await response.arrayBuffer()));return'
 if text.count(old)!=1:raise ValueError('지원하는 Node 응답 코드 형태가 아닙니다.')
 return text.replace(old,"res.end(typeof response.poprushJsonBody==='string'?response.poprushJsonBody:Buffer.from(await response.arrayBuffer()));return")
def health():
 for _ in range(25):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/arena',timeout=10) as r:
    data=json.load(r)
    if isinstance(data,dict) and 'ranking' in data:return
  except Exception:time.sleep(.3)
 raise RuntimeError('API JSON 확인 실패')
def restore(backup):
 data=json.loads((backup/'state.json').read_text())
 for file,target in [('entry.mjs',data['entry']),('arena-api.mjs','/app/arena-api.mjs')]:run(['docker','cp',str(backup/file),'colorpop:'+target])
 run(['docker','restart','colorpop']);health()
def main():
 p=argparse.ArgumentParser();p.add_argument('--restore',type=Path);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 apply-json.py 로 실행하세요.')
 if a.restore:restore(a.restore);print('이전 JSON 응답 경로 복구 완료');return
 with tempfile.TemporaryDirectory() as tmp:
  tmp=Path(tmp);server=tmp/'entry.mjs';api=tmp/'arena-api.mjs';entry='/app/server.mjs'
  run(['docker','cp','colorpop:'+entry,str(server)])
  if 'accept-only-primary' in server.read_text():entry='/app/game-worker.mjs';run(['docker','cp','colorpop:'+entry,str(server)])
  run(['docker','cp','colorpop:/app/arena-api.mjs',str(api)])
  updatedServer=patch_server(server.read_text());updatedApi=patch_api(api.read_text())
  if updatedServer==server.read_text() and updatedApi==api.read_text():raise SystemExit('이미 적용됐습니다. 변경 없음.')
  backup=ROOT/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True,mode=0o700)
  (backup/'entry.mjs').write_bytes(server.read_bytes());(backup/'arena-api.mjs').write_bytes(api.read_bytes());(backup/'state.json').write_text(json.dumps({'entry':entry}))
  server.write_text(updatedServer);api.write_text(updatedApi)
  try:
   run(['docker','cp',str(HERE/'json-reply.mjs'),'colorpop:/app/json-reply.mjs'])
   run(['docker','exec','colorpop','node','--check','/app/json-reply.mjs'])
   for file,target in [(server,entry),(api,'/app/arena-api.mjs')]:
    run(['docker','cp',str(file),'colorpop:'+target]);run(['docker','exec','colorpop','node','--check',target])
   run(['docker','restart','colorpop']);health()
  except (Exception,KeyboardInterrupt):
   try:restore(backup);print('적용 실패: 이전 코드 복구 완료')
   except Exception as e:print('자동 복구 오류:',e,'백업:',backup)
   raise
  print('적용 완료: 대전 API JSON 응답 전달 경로 단축. 게임/DB/Nginx 설정 유지.')
  print('복구: sudo -n python3 apply-json.py --restore '+str(backup))
if __name__=='__main__':main()
