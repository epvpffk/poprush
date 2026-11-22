import fs from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {monitorEventLoopDelay} from 'node:perf_hooks';
const contexts=new AsyncLocalStorage<any>();
export function timingContext(){return contexts.getStore()}
export function addTiming(name:string,ms:number,context=timingContext()){if(context)context.stages[name]=(context.stages[name]||0)+ms}
export async function timed<T>(name:string,fn:()=>Promise<T>):Promise<T>{const began=performance.now();try{return await fn()}finally{addTiming(name,performance.now()-began)}}
let requests=0,errors=0,aborted=0,stages:Record<string,number>={},times:number[]=[],maxMs=0;
let abortedMaxMs=0;
let commits=0,commitMs=0,commitMaxMs=0,writeJobs=0;
export function recordCommit(ms:number,jobs:number){commits++;commitMs+=ms;commitMaxMs=Math.max(commitMaxMs,ms);writeJobs+=jobs}
export function withRequestTiming(req:any,res:any,fn:()=>Promise<void>){
 const pathname=(req.url||'').split('?')[0];
 if(!pathname.startsWith('/api/')&&pathname!=='/healthz')return fn();
 const context={stages:{}},began=performance.now();let completed=false;
 const originalEnd=res.end;res.end=function(...args:any[]){if(!res.headersSent)res.setHeader('Server-Timing',`app;dur=${(performance.now()-began).toFixed(2)}`);return originalEnd.apply(this,args)};
 res.once('finish',()=>{completed=true;const ms=performance.now()-began;requests++;if(res.statusCode>=400)errors++;maxMs=Math.max(maxMs,ms);if(times.length>=2048)times.shift();times.push(ms);for(const [name,value] of Object.entries(context.stages))stages[name]=(stages[name]||0)+(value as number)});
 res.once('close',()=>{if(!completed){aborted++;abortedMaxMs=Math.max(abortedMaxMs,performance.now()-began)}});
 return contexts.run(context,fn);
}
let openConnections=0,openedConnections=0,peakConnections=0;
export function observeConnections(server:any){server.on('connection',(socket:any)=>{openConnections++;openedConnections++;peakConnections=Math.max(peakConnections,openConnections);socket.once('close',()=>{openConnections=Math.max(0,openConnections-1)})})}
export function parseTcpCounters(text:string){const lines=text.trim().split('\n'),values:Record<string,number>={};for(let i=0;i+1<lines.length;i+=2){const names=lines[i].trim().split(/\s+/),numbers=lines[i+1].trim().split(/\s+/);if(names[0]!==numbers[0])continue;for(let j=1;j<names.length;j++)values[names[j]]=Number(numbers[j])}return values}
function tcpCounters(){try{const values={...parseTcpCounters(fs.readFileSync('/proc/net/netstat','utf8')),...parseTcpCounters(fs.readFileSync('/proc/net/snmp','utf8'))};return {listenOverflows:values.ListenOverflows??null,listenDrops:values.ListenDrops??null,retransmittedSegments:values.RetransSegs??null,established:values.CurrEstab??null}}catch{return null}}
export function startPerformanceLog(){
 const loop=monitorEventLoopDelay({resolution:20});loop.enable();let windowStarted=performance.now(),previousTcp=tcpCounters();
 function flush(){
  const currentTcp=tcpCounters();const tcpDelta=currentTcp&&previousTcp?Object.fromEntries(['listenOverflows','listenDrops','retransmittedSegments'].map(k=>[k,currentTcp[k]===null||previousTcp[k]===null?null:Math.max(0,currentTcp[k]-previousTcp[k])])):null;
  if(requests||aborted||commits){const sorted=times.sort((a,b)=>a-b),round=(v:number)=>Math.round(v*10)/10;
   console.log('POP_RUSH_PERF '+JSON.stringify({timestamp:new Date().toISOString(),intervalSeconds:round((performance.now()-windowStarted)/1000),connections:{open:openConnections,opened:openedConnections,peak:peakConnections},tcp:currentTcp,tcpDelta,requests,httpErrors:errors,abortedResponses:aborted,abortedMaxMs:round(abortedMaxMs),totalMs:{p50:round(sorted[Math.floor(sorted.length*.5)]||0),p95:round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]||0),max:round(maxMs)},sampleCount:times.length,stageAverageMs:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,round(v/Math.max(1,requests))])),db:{transactions:commits,jobs:writeJobs,transactionAverageMs:round(commitMs/Math.max(1,commits)),transactionMaxMs:round(commitMaxMs)},eventLoopDelayMs:{p95:round(loop.percentile(95)/1e6),max:round(loop.max/1e6)}}));
  }
  requests=errors=aborted=abortedMaxMs=maxMs=commits=commitMs=commitMaxMs=writeJobs=0;stages={};times=[];loop.reset();windowStarted=performance.now();previousTcp=currentTcp;openedConnections=0;peakConnections=openConnections;
 }
 const timer=setInterval(flush,10000);timer.unref();return()=>{clearInterval(timer);flush();loop.disable()};
}
