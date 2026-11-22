#!/usr/bin/env python3
import argparse,json,os,subprocess,sys,signal
from pathlib import Path
HERE=Path(__file__).resolve().parent;MODULES=HERE/'modules'
STEPS={'pool':'apply-pool.py','accept':'apply-accept.py','db':'apply-dbworker.py','json':'apply-json.py','payload':'apply-payload.py','trace':'install-trace.py','backlog':'backlog-update.py'}
def status():
 code='''const f=require('fs');const read=p=>f.existsSync(p)?f.readFileSync(p,'utf8'):'';const s=read('/app/server.mjs'),w=s.includes('accept-only-primary')?read('/app/game-worker.mjs'):s,a=read('/app/arena-api.mjs'),d=read('/app/database.mjs'),t=read('/app/request-trace.mjs');console.log(JSON.stringify({pool:s.includes('pooled-http-primary'),accept:s.includes('accept-only-primary'),db:d.includes('database-worker.mjs'),json:a.includes("from './json-reply.mjs'")&&w.includes('response.poprushJsonBody'),payload:a.includes("board: r.status === 'waiting' ? [] : p.board")||a.includes('board: r.status === "waiting" ? [] : p.board'),trace:w.includes("from './request-trace.mjs'")&&t.includes('Profiler.start'),shutdownAwaitsDb:w.includes('await closeDatabase()')}))'''
 result=subprocess.run(['docker','exec','colorpop','node','-e',code],capture_output=True,text=True,check=True)
 return json.loads(result.stdout)
def invoke(step,extra=None):
 result=subprocess.run([sys.executable,str(MODULES/STEPS[step]),*(extra or [])],cwd=MODULES,capture_output=True,text=True)
 for line in (result.stdout+result.stderr).splitlines():
  if line.startswith('복구: ') and ' --restore ' in line:
   print('복구: sudo -n python3 update.py --restore '+step+' '+line.split(' --restore ',1)[1],flush=True)
  else:print(line,flush=True)
 if result.returncode:raise SystemExit(result.returncode)
def run_collection(command):
 # Only the collector receives the forwarded interrupt. Keep waiting for its ZIP.
 stopped=False
 process=subprocess.Popen(command,start_new_session=True)
 def interrupt(signum,frame):
  nonlocal stopped
  if stopped:
   print('이미 중단 요청을 전달했습니다. ZIP 저장 완료를 기다리는 중입니다.',flush=True);return
  stopped=True
  print('수집 중단 요청을 전달합니다. ZIP 저장 완료까지 기다려 주세요.',flush=True)
  if process.poll() is None:process.send_signal(signal.SIGINT)
 previous=signal.signal(signal.SIGINT,interrupt)
 try:return process.wait()
 finally:signal.signal(signal.SIGINT,previous)

def main():
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--apply',action='store_true');g.add_argument('--collect',action='store_true');g.add_argument('--restore',nargs=2,metavar=('STEP','BACKUP'));g.add_argument('--backlog',action='store_true');p.add_argument('--seconds',type=int,default=300);a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 update.py 로 실행하세요.')
 print('POP_RUSH_SERVER_UPDATE_VERSION=5 FILE='+str(Path(__file__).resolve()),flush=True)
 if a.restore:
  step,backup=a.restore
  if step not in STEPS:raise SystemExit('지원하는 복구 단계: '+', '.join(STEPS))
  invoke(step,['--restore',backup]);return
 if a.backlog:invoke('backlog');return
 if a.collect:
  if not status()['trace']:raise SystemExit('먼저 update.py --apply 로 추적 설치를 완료하세요.')
  raise SystemExit(run_collection([sys.executable,str(MODULES/'collect-trace.py'),'--seconds',str(a.seconds),'--output',str(HERE/'logs')]))
 current=status();print(json.dumps(current,ensure_ascii=False,indent=2),flush=True)
 if not a.apply:return
 for step in ['accept','db','json','payload','pool','trace']:
  current=status()
  if current[step]:print(step+': 이미 적용됨, 유지',flush=True);continue
  print(step+': 적용 시작',flush=True);invoke(step)
 current=status()
 if not all(current[k] for k in ['accept','db','json','payload','pool','trace','shutdownAwaitsDb']):raise SystemExit('최종 상태 확인 실패: '+json.dumps(current))
 print('통합 상태 확인 완료. 수집: sudo -n python3 update.py --collect --seconds 300',flush=True)
if __name__=='__main__':main()
