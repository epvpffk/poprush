#!/usr/bin/env python3
"""Counter deltas only. No settings changes or disk performance probes."""
import argparse,json
from pathlib import Path

def key_values(text):
 if not isinstance(text,str):return {}
 out={}
 for line in text.splitlines():
  p=line.replace(':',' ').split()
  if len(p)>=2:
   try:out[p[0]]=int(p[1])
   except ValueError:pass
 return out

def disk_values(text):
 out={}
 if not isinstance(text,str):return out
 for line in text.splitlines():
  p=line.split()
  if len(p)<14 or p[2].startswith(('loop','ram')):continue
  try:out[p[2]]=list(map(int,p[3:]))
  except ValueError:pass
 return out

def summarize(rows):
 result={'samples':len(rows)}
 if len(rows)<2:return result
 first,last=rows[0],rows[-1];elapsed=(last['at']-first['at'])/1000
 result['elapsedSeconds']=round(elapsed,2)
 def delta_field(name):
  a,b=key_values(first.get(name)),key_values(last.get(name));return {k:b[k]-v for k,v in a.items() if k in b and b[k]>=v}
 cpu=[];resets=0
 for a,b in zip(rows,rows[1:]):
  try:
   x=list(map(int,a['hostCpu'].splitlines()[0].split()[1:9]));y=list(map(int,b['hostCpu'].splitlines()[0].split()[1:9]));d=[j-i for i,j in zip(x,y)]
   if len(d)!=8:continue
   if any(v<0 for v in d):resets+=1;continue
   cpu.append(d)
  except (KeyError,TypeError,ValueError,IndexError):pass
 totals=[sum(r[i] for r in cpu) for i in range(8)];ticks=sum(totals)
 result['hostCpuPercent']={k:round(v/ticks*100,2) for k,v in zip(['user','nice','system','idle','ioWait','irq','softIrq','steal'],totals)} if ticks else {}
 result['hostCpuSkippedCounterDecreaseIntervals']=resets
 result['cgroupCpuDelta']=delta_field('cgroupCpu');result['cgroupMemoryEventsDelta']=delta_field('cgroupMemoryEvents')
 mem=[key_values(r.get('hostMemory')) for r in rows];available=[m['MemAvailable'] for m in mem if 'MemAvailable' in m]
 result['hostMemAvailableMinKiB']=min(available) if available else None
 result['diskDevices']={}
 a,b=disk_values(first.get('hostDisk')),disk_values(last.get('hostDisk'))
 for name,v in a.items():
  if name not in b:continue
  w=b[name];indices=[0,2,3,4,6,7,9,10]
  if any(len(v)<=i or len(w)<=i or w[i]<v[i] for i in indices):continue
  d={i:w[i]-v[i] for i in indices};reads,writes=d[0],d[4]
  out={'readIOPS':round(reads/max(elapsed,.001),2),'writeIOPS':round(writes/max(elapsed,.001),2),'readKiBps':round(d[2]/2/max(elapsed,.001),2),'writeKiBps':round(d[6]/2/max(elapsed,.001),2),'readCompletionAverageMs':round(d[3]/reads,2) if reads else None,'writeCompletionAverageMs':round(d[7]/writes,2) if writes else None,'ioBusyPercentIndicator':round(d[9]/max(elapsed*10,.001),2),'weightedQueueDepthIndicator':round(d[10]/max(elapsed*1000,.001),3)}
  if len(v)>=17 and len(w)>=17 and w[15]>=v[15] and w[16]>=v[16]:
   flushes=w[15]-v[15];out['flushIOPS']=round(flushes/max(elapsed,.001),2);out['flushCompletionAverageMs']=round((w[16]-v[16])/flushes,2) if flushes else None
  result['diskDevices'][name]=out
 result['pressureStallPercent']={}
 for field in ['hostPressureCpu','hostPressureIo','hostPressureMemory']:
  def parse(text):
   values={}
   if isinstance(text,str):
    for line in text.splitlines():
     parts=line.split()
     for token in parts[1:]:
      if token.startswith('total='):
       try:values[parts[0]]=int(token[6:])
       except ValueError:pass
   return values
  v,w=parse(first.get(field)),parse(last.get(field))
  result['pressureStallPercent'][field]={k:round((w[k]-n)/max(elapsed*10000,.001),3) for k,n in v.items() if k in w and w[k]>=n}
 result['processIoDelta']={}
 old={r['hostPid']:r for r in first.get('processes',[])}
 for r in last.get('processes',[]):
  if r['hostPid'] in old:
   v,w=key_values(old[r['hostPid']].get('io')),key_values(r.get('io'));result['processIoDelta'][str(r['hostPid'])]={k:w[k]-n for k,n in v.items() if k in w and w[k]>=n}
 return result

def report(folder):
 rows=[]
 for line in (folder/'queues.jsonl').read_text().splitlines():
  try:rows.append(json.loads(line))
  except ValueError:pass
 rows.sort(key=lambda r:r['at']);result={'overall':summarize(rows)}
 begin=[];end=[]
 if (folder/'nginx.jsonl').exists():
  for line in (folder/'nginx.jsonl').read_text().splitlines():
   try:
    r=json.loads(line)
    if any('-'+label+'-' in str(r.get('id','')) for label in ['poll','heartbeat','move']):
     e=float(r['end'])*1000;begin.append(e-float(r['rt'])*1000);end.append(e)
   except (ValueError,KeyError,TypeError):pass
 if begin:
  low,high=min(begin),max(end);result['battleWindow']=summarize([r for r in rows if low<=r['at']<=high])
 result['notes']=['CPU ioWait는 참고 지표이며 저장장치 고장이나 AWS 크레딧 소진을 확정하지 않습니다.','디스크 완료 평균은 커널 대기와 처리 시간을 포함하며 게임 API 지연과 다릅니다.','장치와 파티션 지표는 중복되므로 합산하지 마세요. busy 비율만으로 NVMe 포화를 확정할 수 없습니다.','이전 trace에 없는 디스크/메모리/PSI 지표는 빈 값으로 표시합니다.','이 도구는 AWS CloudWatch 크레딧 또는 EBS 제한 지표를 수집하지 않습니다.']
 (folder/'host-metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('folder',type=Path);report(p.parse_args().folder)
