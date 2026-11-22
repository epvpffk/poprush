#!/usr/bin/env python3
import argparse,collections,json,re
from pathlib import Path

def number(v):
 try:return float(v)
 except (ValueError,TypeError):return None

def analyze(folder,client=None):
 nginx={};bad=0
 for line in (folder/'nginx.jsonl').read_text().splitlines():
  try:
   r=json.loads(line)
   if r.get('id'):nginx[r['id']]=r
  except ValueError:bad+=1
 app={};accepts=0;proxy={}
 for line in (folder/'app.log').read_text().splitlines():
  if 'POP_RUSH_PROXY_TRACE ' in line:
   try:
    event=json.loads(line.split('POP_RUSH_PROXY_TRACE ',1)[1]);proxy[event['id']]=event
   except (ValueError,KeyError):pass
  if 'POP_RUSH_TRACE ' not in line:continue
  try:r=json.loads(line.split('POP_RUSH_TRACE ',1)[1])
  except ValueError:continue
  if r.get('id'):app.setdefault(r['id'],[]).append(r)
  if r.get('event')=='accept':accepts+=1
 rows=[]
 for id,r in nginx.items():
  end,rt,header=number(r.get('end')),number(r.get('rt')),number(r.get('header'))
  out={'id':id,'status':r.get('status'),'nginxMs':rt*1000 if rt is not None else None,'events':app.get(id,[])}
  start=end*1000-rt*1000 if end is not None and rt is not None else None
  out['nginxStartEpochMs']=start
  pe=proxy.get(id)
  if pe:
   out['proxyEvent']=pe;out['proxyQueueMs']=pe.get('queueMs')
   out['proxyUnassignedAtAbort']=pe.get('assignedAt') is None and pe.get('aborted',False)
   if start is not None:out['nginxStartToProxyRequestMs']=pe['start']-start
  queue=re.search(r'proxy_queue;dur=([0-9.]+)',str(r.get('app','')))
  if queue:out['proxyQueueMs']=float(queue[1])
  parts=str(r.get('meta','')).split(':')
  event=next((e for e in app.get(id,[]) if e.get('event') in ('abort','finish','request')),None)
  if len(parts)!=5 and event:
   parts=[str(event[k]) for k in ['accepted','requestAt','sid','requestNumber','remotePort']]
  if event and event.get('event')=='abort':out['appRequestToAbortMs']=event['at']-event['requestAt']
  if len(parts)==5 and all(v.isdigit() for v in parts):
   accepted,received,sid,requestNumber,port=map(int,parts)
   out.update({'socketAcceptedEpochMs':accepted,'appReceivedEpochMs':received,'socketId':sid,'requestOnSocket':requestNumber,'nginxBackendSourcePort':port,'nginxStartToAppRequestMs':received-start if start is not None else None,'socketAgeAtRequestMs':received-accepted})
   # For reused sockets an earlier accepted time is expected; not a negative delay.
   if requestNumber==1 and start is not None:out['nginxStartToSocketAcceptMs']=accepted-start
   match=re.search(r'app;dur=([0-9.]+)',str(r.get('app','')))
   if start is not None and header is not None and match:
    out['appMs']=float(match[1]);out['estimatedAppEndToNginxHeaderMs']=start+header*1000-received-float(match[1])
  rows.append(out)
 clientRows=[]
 if client:
  text=client.read_text(encoding='utf-8-sig');data=json.loads(text[text.index('{'):]);clientRows=data.get('traceRows',[])
  for r in clientRows:
   if r.get('requestId') not in nginx:rows.append({'id':r.get('requestId'),'clientOnly':True,'client':r,'events':app.get(r.get('requestId'),[])})
  index={r['id']:r for r in rows}
  for r in clientRows:
   if r.get('requestId') in index:index[r['requestId']]['client']=r
 def dist(key):
  v=sorted(r[key] for r in rows if isinstance(r.get(key),(int,float)))
  return {'samples':len(v),'p50':round(v[len(v)//2],2) if v else None,'p95':round(v[min(len(v)-1,int(len(v)*.95))],2) if v else None,'max':round(max(v),2) if v else None}
 summary={'nginxRows':len(nginx),'byRequestLabelAndStatus':dict(collections.Counter((re.search(r'-(guest|create|join|start|leave|poll|heartbeat|move|menu)-[0-9]+$',r['id']).group(1) if re.search(r'-(guest|create|join|start|leave|poll|heartbeat|move|menu)-[0-9]+$',r['id']) else 'other')+':'+str(r.get('status')) for r in nginx.values())),'nginxRowsWithAppMetadata':sum('appReceivedEpochMs' in r for r in rows),'nginxAbortRowsWithAppAbort':sum(r.get('status')==499 and any(e.get('event')=='abort' for e in r.get('events',[])) for r in rows),'malformedNginxLines':bad,'status':dict(collections.Counter(str(r.get('status')) for r in nginx.values())),'appAcceptEvents':accepts,'clientTraceRows':len(clientRows),'joinedClientRows':sum('client' in r and not r.get('clientOnly') for r in rows),'stages':{k:dist(k) for k in ['proxyQueueMs','nginxStartToProxyRequestMs','nginxStartToSocketAcceptMs','socketAgeAtRequestMs','nginxStartToAppRequestMs','appMs','appRequestToAbortMs','estimatedAppEndToNginxHeaderMs']}}
 summary['proxyAbortsBeforeBackendAssignment']=sum(r.get('proxyUnassignedAtAbort',False) for r in rows)
 summary['notes']=['서버의 같은 호스트 시각만 비교하며 PC와 서버 시계 차이를 지연으로 해석하지 않습니다.','Nginx 시각은 로그 종료 시각과 request_time으로 추정하며 수 ms 오차가 있을 수 있습니다.','앱의 빠른 완료 요청은 1%만 로그에 남지만 Nginx meta는 모든 추적 응답에 포함됩니다.','앱 이벤트 누락만으로 요청 미도착을 단정하지 않습니다. 499와 앱 abort는 요청 ID로 연결합니다.','수집은 부하를 추가합니다. 측정 시각은 HTTP 단계이며 패킷 원인을 확정하지 않습니다.']
 queueRows=[]
 if (folder/'queues.jsonl').exists():
  for line in (folder/'queues.jsonl').read_text().splitlines():
   try:queueRows.append(json.loads(line))
   except ValueError:pass
 summary['queueMax']={}
 for name,port in [('hostListen','80'),('appListen','3000'),('gameBackendListen','3001')]:
  values=[]
  for q in queueRows:
   for line in q.get('appListen' if name=='gameBackendListen' else name,{}).get('stdout','').splitlines():
    fields=line.split()
    if len(fields)>=4 and fields[3].endswith(':'+port):
     try:values.append((int(fields[1]),int(fields[2])))
     except ValueError:pass
  summary['queueMax'][name]={'samples':len(values),'recvQMax':max((v[0] for v in values),default=None),'backlogMax':max((v[1] for v in values),default=None)}
 def tcp(text):
  if not isinstance(text,str):return None
  lines=text.splitlines()
  for x,y in zip(lines,lines[1:]):
   a,b=x.split(),y.split()
   if a and b and a[0]==b[0]=='TcpExt:':
    vals=dict(zip(a[1:],b[1:]));return {k:int(vals[k]) for k in ['ListenOverflows','ListenDrops','SyncookiesSent','TCPReqQFullDoCookies','TCPReqQFullDrop'] if k in vals}
 summary['tcpDelta']={}
 for name in ['hostTcp','appTcp']:
  samples=[v for q in queueRows if (v:=tcp(q.get(name))) is not None]
  summary['tcpDelta'][name]={'samples':len(samples),'delta':{k:samples[-1][k]-v for k,v in samples[0].items()} if len(samples)>=2 else None}
 profilePath=folder/'worker.cpuprofile'
 if profilePath.exists():
  profile=json.loads(profilePath.read_text());nodes={n['id']:n for n in profile.get('nodes',[])};parents={child:n['id'] for n in nodes.values() for child in n.get('children',[])}
  beginTimes=[];endTimes=[]
  for r in nginx.values():
   if re.search(r'-(poll|heartbeat|move)-[0-9]+$',r['id']):
    e,t=number(r.get('end')),number(r.get('rt'))
    if e is not None and t is not None:beginTimes.append((e-t)*1000);endTimes.append(e*1000)
  def cpuWindow(start,end):
   selfTime=collections.Counter();inclusive=collections.Counter();total=0;at=profile.get('poprushStartEpochMs',0)
   def key(id):
    f=nodes[id]['callFrame'];return (f.get('functionName') or '(anonymous)',f.get('url',''),f.get('lineNumber',-1)+1)
   for id,delta in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
    at+=delta/1000
    if not start<=at<=end or id not in nodes:continue
    duration=max(0,delta/1000);total+=duration;selfTime[key(id)]+=duration;seen=set();cursor=id
    while cursor in nodes:
     k=key(cursor)
     if k not in seen:inclusive[k]+=duration;seen.add(k)
     cursor=parents.get(cursor)
   def top(counter):return [{'function':k[0],'file':k[1],'line':k[2],'sampleMs':round(v,2),'percent':round(v/max(total,.001)*100,2)} for k,v in counter.most_common(30)]
   return {'sampledMs':round(total,2),'self':top(selfTime),'inclusive':top(inclusive)}
  cpu={'pid':profile.get('poprushPid'),'overall':cpuWindow(0,float('inf')),'notes':'샘플에는 idle 시간이 포함됩니다. battle 구간 시각 매핑은 근사치이며 실제 CPU 사용량은 proc 통계와 함께 해석합니다.'}
  if beginTimes:cpu['battle']=cpuWindow(min(beginTimes),max(endTimes))
  (folder/'cpu-summary.json').write_text(json.dumps(cpu,ensure_ascii=False,indent=2))
  summary['cpuProfileAvailable']=True
 else:summary['cpuProfileAvailable']=False
 (folder/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
 with (folder/'joined.jsonl').open('w') as f:
  for r in rows:f.write(json.dumps(r,ensure_ascii=False)+'\n')
 print(json.dumps(summary,ensure_ascii=False,indent=2))
 return rows,summary
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('folder',type=Path);p.add_argument('--client',type=Path);a=p.parse_args();analyze(a.folder,a.client)
