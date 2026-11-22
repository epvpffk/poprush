import {Session} from 'node:inspector/promises';
import fs from 'node:fs';
const sockets=new WeakMap();let serial=0,until=0,nextCheck=0;
function active(){const now=Date.now();if(now>=nextCheck){nextCheck=now+1000;try{until=Number(fs.readFileSync('/tmp/poprush-trace-until','utf8'))}catch{until=0}}return now<until}
function log(data){console.log('POP_RUSH_TRACE '+JSON.stringify(data))}
export function installTrace(server){
 server.prependListener('connection',socket=>{
  const info={sid:++serial,accepted:Date.now(),requests:0,remotePort:socket.remotePort,localPort:socket.localPort};sockets.set(socket,info);
  if(active())log({event:'accept',...info});
  socket.once('close',hadError=>{if(active())log({event:'socket-close',...info,at:Date.now(),hadError,bytesRead:socket.bytesRead,bytesWritten:socket.bytesWritten})});
 });
 server.prependListener('request',(req,res)=>{
  const at=Date.now(),socket=req.socket,info=sockets.get(socket)||{sid:0,accepted:at,requests:0};info.requests++;
  const id=String(req.headers['x-pop-trace-id']||'');if(!/^pr-[A-Za-z0-9-]{1,90}$/.test(id)||!active())return;
  const base={id,sid:info.sid,accepted:info.accepted,requestAt:at,requestNumber:info.requests,remotePort:socket.remotePort,localPort:socket.localPort,method:req.method,path:(req.url||'').split('?')[0]};
  res.setHeader('X-Pop-Trace-Id',id);
  res.setHeader('X-Pop-Trace-Meta',[base.accepted,at,base.sid,base.requestNumber,base.remotePort].join(':'));
  // Always retain aborts and slow app requests; deterministic 1% for fast successes.
  let hash=0;for(const c of id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
  if(hash%100===0)log({event:'request',...base});
  let sentAt=null,finished=false;
  const end=res.end;res.end=function(...args){sentAt=Date.now();return end.apply(this,args)};
  res.once('finish',()=>{finished=true;const done=Date.now();if(hash%100===0||done-at>=200)log({event:'finish',...base,sentAt,at:done,status:res.statusCode,appTiming:res.getHeader('Server-Timing')||'',bytesWritten:socket.bytesWritten})});
  res.once('close',()=>{if(!finished)log({event:'abort',...base,sentAt,at:Date.now(),status:res.statusCode,bytesRead:socket.bytesRead,bytesWritten:socket.bytesWritten})});
 });
}

// CPU samples contain function names and source locations, never request bodies.
let profiler=null,profiling=false,profilerBusy=false,profileStart=0;
const profileTimer=setInterval(async()=>{
 if(profilerBusy)return;
 profilerBusy=true;
 try{
  if(active()&&!profiling){
   profiler=new Session();profiler.connect();
   await profiler.post('Profiler.enable');await profiler.post('Profiler.setSamplingInterval',{interval:1000});
   await profiler.post('Profiler.start');profileStart=Date.now();profiling=true;
   log({event:'cpu-profile-start',pid:process.pid,at:profileStart});
  }else if(!active()&&profiling){
   const {profile}=await profiler.post('Profiler.stop');
   profile.poprushStartEpochMs=profileStart;profile.poprushStopEpochMs=Date.now();profile.poprushPid=process.pid;
   fs.writeFileSync('/tmp/poprush-worker.cpuprofile',JSON.stringify(profile));
   profiler.disconnect();profiler=null;profiling=false;
   log({event:'cpu-profile-saved',pid:process.pid,at:Date.now(),samples:profile.samples?.length||0});
  }
 }catch(error){log({event:'cpu-profile-error',name:error.name});try{profiler?.disconnect()}catch{}profiler=null;profiling=false}
 finally{profilerBusy=false}
},1000);profileTimer.unref();
