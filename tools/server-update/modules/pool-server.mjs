// accept-only-primary compatibility marker; role: pooled-http-primary.
// Exactly one game process keeps all existing state and DB ownership.
import http from 'node:http';import {fork} from 'node:child_process';import {fileURLToPath} from 'node:url';
const port=Number(process.env.PORT||3000),backend=port+1;
if(!Number.isInteger(port)||port<1||backend>65535)throw Error('Invalid port');
const agent=new http.Agent({keepAlive:true,maxSockets:64,maxFreeSockets:64,maxTotalSockets:64,scheduling:'fifo'});
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','proxy-connection']);
function headers(input){const excluded=new Set(hop);for(const name of String(input.connection||'').split(','))excluded.add(name.trim().toLowerCase());return Object.fromEntries(Object.entries(input).filter(([k])=>!excluded.has(k.toLowerCase())))}
let stopping=false,fatal=false,killTimer,closeTimer,requests=0,finished=0,aborted=0,active=0,peak=0;
const child=fork(fileURLToPath(new URL('./game-worker.mjs',import.meta.url)),[],{env:{...process.env,PORT:String(backend),POPRUSH_GAME_BIND:'127.0.0.1'},stdio:['inherit','inherit','inherit','ipc']});
const server=http.createServer((req,res)=>{
 const began=performance.now(),start=Date.now(),id=String(req.headers['x-pop-trace-id']||'');let assigned=null,headerAt=null,completed=false,settled=false,out;
 requests++;active++;peak=Math.max(peak,active);
 const finish=()=>{
  if(settled)return;settled=true;active--;if(completed)finished++;else aborted++;
  if(/^pr-[A-Za-z0-9-]{1,90}$/.test(id)&&(!completed||(assigned!==null&&assigned-began>=500)))console.log('POP_RUSH_PROXY_TRACE '+JSON.stringify({id,start,assignedAt:assigned===null?null:start+assigned-began,headerAt,status:res.statusCode,aborted:!completed,queueMs:assigned===null?null:assigned-began,totalMs:performance.now()-began}));
 };
 res.once('finish',()=>{completed=true;finish()});
 res.once('close',()=>{if(!res.writableFinished)out?.destroy();finish()});
 out=http.request({host:'127.0.0.1',port:backend,method:req.method,path:req.url,headers:headers(req.headers),agent},upstream=>{
  headerAt=Date.now();const h=headers(upstream.headers),queue=assigned===null?0:assigned-began;
  h['server-timing']=(h['server-timing']?h['server-timing']+', ':'')+'proxy_queue;dur='+queue.toFixed(2);
  res.writeHead(upstream.statusCode||502,h);upstream.on('error',()=>res.destroy());upstream.pipe(res);
 });
 out.once('socket',()=>{assigned=performance.now()});
 out.once('error',()=>{if(res.destroyed)return;if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"게임 서버 연결을 확인해 주세요."}')}else res.destroy()});
 req.once('aborted',()=>out.destroy());req.on('error',()=>out.destroy());req.pipe(out);
});
server.keepAliveTimeout=65000;server.headersTimeout=70000;
child.on('message',message=>{if(message?.type!=='poprush-game-ready'||server.listening||stopping)return;server.listen({host:'0.0.0.0',port,backlog:4096},()=>console.log('POP_RUSH_POOL_READY '+JSON.stringify({port,backend,backendConnections:64,gameWorkers:1}))) });
function stopChild(){agent.destroy();try{child.kill('SIGTERM')}catch{}if(!killTimer){killTimer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}process.exit(1)},4500);killTimer.unref()}}
function shutdown(){if(stopping)return;stopping=true;server.close(()=>stopChild());closeTimer=setTimeout(()=>{server.closeAllConnections();stopChild()},4000);closeTimer.unref()}
server.on('error',error=>{fatal=true;console.error('POP_RUSH_POOL_ERROR '+error.code);shutdown()});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,shutdown);
child.once('exit',(code,signal)=>{clearTimeout(killTimer);clearTimeout(closeTimer);if(!stopping)console.error('POP_RUSH_POOL_WORKER_EXIT '+JSON.stringify({code,signal}));process.exit(stopping&&!fatal?0:(code||1))});
setInterval(()=>{if(requests)console.log('POP_RUSH_POOL_STATS '+JSON.stringify({requests,finished,aborted,active,peak,backendSockets:Object.values(agent.sockets).reduce((n,a)=>n+a.length,0),queued:Object.values(agent.requests).reduce((n,a)=>n+a.length,0)}));requests=finished=aborted=0;peak=active},10000).unref();
