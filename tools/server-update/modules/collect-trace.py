#!/usr/bin/env python3
import argparse,datetime,json,os,signal,subprocess,time,zipfile,urllib.request,sys
from pathlib import Path

def run(a):
 p=subprocess.run(a,capture_output=True,text=True,timeout=8)
 return {'returncode':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()}
def main():
 p=argparse.ArgumentParser();p.add_argument('--seconds',type=int,default=300);p.add_argument('--output',type=Path,default=Path.cwd());a=p.parse_args()
 if os.geteuid()!=0:raise SystemExit('sudo -n python3 collect-trace.py 로 실행하세요.')
 if not 10<=a.seconds<=600:raise SystemExit('--seconds는 10~600입니다.')
 stopRequested=False
 def request_stop(signum,frame):
  nonlocal stopRequested
  if not stopRequested:print('수집 중단 요청을 받았습니다. 현재 기록을 저장합니다.',flush=True)
  stopRequested=True
 signal.signal(signal.SIGINT,request_stop)
 started=datetime.datetime.now(datetime.timezone.utc);name='POP_RUSH_TRACE_'+started.strftime('%Y%m%d_%H%M%S');folder=a.output/name;folder.mkdir(parents=True,exist_ok=False)
 inspect=run(['docker','inspect','--format','{{.State.Pid}}','colorpop']);pid=int(inspect['stdout'])
 nginxpath=Path('/var/log/nginx/poprush-request-trace.log')
 if not nginxpath.exists():raise SystemExit('추적용 Nginx 로그가 없습니다. install-trace.py를 먼저 실행하세요.')
 # Keep the descriptor open so one log rotation cannot silently lose the original file.
 nginx=nginxpath.open();nginx.seek(0,2);inode=os.fstat(nginx.fileno()).st_ino
 snapshot={'startUtc':started.isoformat(),'durationSeconds':a.seconds,'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),'node':run(['docker','exec','colorpop','node','--version']),'hostLimits':run(['sysctl','net.core.somaxconn','net.ipv4.tcp_max_syn_backlog']),'containerPid':pid,'sampling':'socket queues every 0.5s; app fast requests 1%, all >=200ms and aborts; nginx all trace-ID requests'}
 for path in ['/etc/nginx/conf.d/poprush-upstream.conf','/etc/nginx/sites-enabled/poprush']:
  snapshot[path]=Path(path).read_text()
 snapshot['hostRootDevice']=str(os.major(os.stat('/').st_dev))+':'+str(os.minor(os.stat('/').st_dev))
 snapshot['blockDevices']={}
 for device in Path('/sys/class/block').glob('*'):
  if device.name.startswith(('loop','ram')):continue
  entry={}
  for name in ['dev','size','partition','queue/rotational','queue/logical_block_size']:
   try:entry[name]=device.joinpath(name).read_text().strip()
   except OSError:pass
  snapshot['blockDevices'][device.name]=entry
 (folder/'environment.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2))
 enabled=run(['docker','exec','colorpop','node','-e','require("fs").writeFileSync("/tmp/poprush-trace-until",process.argv[1])',str(int((time.time()+a.seconds+5)*1000))])
 if enabled['returncode']:raise SystemExit(enabled['stderr'])
 output=(folder/'app.log').open('w');logs=subprocess.Popen(['docker','logs','--since',started.isoformat(),'--follow','colorpop'],stdout=output,stderr=subprocess.STDOUT,text=True)
 deadline=time.monotonic()+a.seconds;last=-1
 try:
  checkid='pr-preflight-'+str(int(time.time()*1000));verified=False
  for _ in range(10):
   try:
    request=urllib.request.Request('http://127.0.0.1/healthz',headers={'Host':'poprush.xyz','X-Pop-Trace-Id':checkid})
    with urllib.request.urlopen(request,timeout=3) as response:
     verified=response.headers.get('X-Pop-Trace-Id')==checkid and bool(response.headers.get('X-Pop-Trace-Meta'))
    if verified:break
   except Exception:pass
   time.sleep(.3)
  if not verified:raise RuntimeError('요청 ID 왕복 확인 실패. Windows 시험을 시작하지 마세요.')
  print('요청 ID 왕복 확인 완료. 이제 Windows v12 이상 도구에서 시험을 실행하세요. 300초 시험은 준비 시간을 포함해 600초 수집을 권장합니다.',flush=True)
  print('수집 종료까지 이 창을 유지하세요. Ctrl+C로 현재까지 저장할 수 있습니다.',flush=True)
  with (folder/'queues.jsonl').open('w') as f:
   while not stopRequested and time.monotonic()<deadline:
    tick=time.monotonic();row={'at':int(time.time()*1000),'hostListen':run(['ss','-H','-lnt']),'appListen':run(['nsenter','-t',str(pid),'-n','ss','-H','-lnt'])}
    row['processes']=[]
    try:
     pids=[pid]+[int(v) for v in Path(f'/proc/{pid}/task/{pid}/children').read_text().split()]
     for processId in pids:
      base=Path(f'/proc/{processId}');status=base.joinpath('status').read_text()
      row['processes'].append({'hostPid':processId,'stat':base.joinpath('stat').read_text(),'fdCount':len(list(base.joinpath('fd').iterdir())),'status': '\n'.join(l for l in status.splitlines() if l.startswith(('Name:','NSpid:','VmRSS:','Threads:','voluntary_ctxt_switches:','nonvoluntary_ctxt_switches:'))),'limits':base.joinpath('limits').read_text(),'io':base.joinpath('io').read_text()})
    except OSError as error:row['processReadError']=str(error)
    for label,path in [('hostDisk','/proc/diskstats'),('hostMemory','/proc/meminfo'),('hostPressureCpu','/proc/pressure/cpu'),('hostPressureIo','/proc/pressure/io'),('hostPressureMemory','/proc/pressure/memory'),('cgroupIo',f'/proc/{pid}/root/sys/fs/cgroup/io.stat'),('cgroupMemoryEvents',f'/proc/{pid}/root/sys/fs/cgroup/memory.events'),('hostCpu','/proc/stat'),('cgroupCpu',f'/proc/{pid}/root/sys/fs/cgroup/cpu.stat'),('cgroupCpuLimit',f'/proc/{pid}/root/sys/fs/cgroup/cpu.max')]:
     try:row[label]=Path(path).read_text()
     except OSError as error:row[label]={'error':str(error)}
    for label,path in [('hostTcp','/proc/net/netstat'),('appTcp',f'/proc/{pid}/net/netstat')]:
     try:row[label]=Path(path).read_text()
     except OSError as e:row[label]={'error':str(e)}
    f.write(json.dumps(row)+'\n');f.flush()
    remain=max(0,int(deadline-time.monotonic()))
    if remain//15!=last:print('남은 수집 시간:',remain,'초',flush=True);last=remain//15
    time.sleep(max(0,.5-(time.monotonic()-tick)))
 except KeyboardInterrupt:print('수집을 종료하고 저장합니다.',flush=True)
 finally:
  print('수집 자료를 정리하고 ZIP으로 저장 중입니다. 잠시 기다려 주세요.',flush=True)
  run(['docker','exec','colorpop','node','-e','require("fs").writeFileSync("/tmp/poprush-trace-until","0")'])
  # Wait for worker to stop the profiler and write a profile from this collection.
  profileCode='const f=require("fs"),p="/tmp/poprush-worker.cpuprofile";if(!f.existsSync(p))process.exit(2);const v=JSON.parse(f.readFileSync(p,"utf8"));if(v.poprushStartEpochMs<Number(process.argv[1]))process.exit(3);process.stdout.write(JSON.stringify(v));'
  for _ in range(16):
   profile=run(['docker','exec','colorpop','node','-e',profileCode,str(int(started.timestamp()*1000)-2000)])
   if profile['returncode']==0:
    (folder/'worker.cpuprofile').write_text(profile['stdout']);break
   time.sleep(.5)
  else:(folder/'profile-warning.txt').write_text('이번 수집의 CPU 프로파일을 받지 못했습니다. '+profile['stderr'])
  logs.terminate()
  try:logs.wait(timeout=5)
  except subprocess.TimeoutExpired:logs.kill();logs.wait()
  output.close()
  with (folder/'nginx.jsonl').open('w') as f:
   f.write(nginx.read())
   if nginxpath.exists() and nginxpath.stat().st_ino!=inode:
    f.write(nginxpath.read_text());(folder/'rotation.txt').write_text('로그 회전 감지: 이전 파일의 끝과 현재 파일을 포함했습니다.')
  nginx.close()
  subprocess.run(['python3',str(Path(__file__).with_name('analyze-trace.py')),str(folder)],check=False)
  subprocess.run([sys.executable,str(Path(__file__).with_name('host-metrics.py')),str(folder)],check=False)
  archive=folder.with_suffix('.zip')
  with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
   for file in folder.iterdir():
    if file.is_file():z.write(file,folder.name+'/'+file.name)
  print('서버 진단 파일:',str(archive.resolve()),flush=True)
  print('이 ZIP과 Windows에서 이번에 생성된 시험 로그를 함께 보내주세요.',flush=True)
if __name__=='__main__':main()
