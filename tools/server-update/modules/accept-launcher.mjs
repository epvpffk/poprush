// One application worker preserves the game's single-process state/SQLite ownership.
import cluster from 'node:cluster';
import {fileURLToPath} from 'node:url';
if (!cluster.isPrimary) throw new Error('Run this launcher as the primary process');
cluster.schedulingPolicy=cluster.SCHED_RR;
cluster.setupPrimary({exec:fileURLToPath(new URL('./game-worker.mjs',import.meta.url)),silent:false});
let shutting=false,timer=null;
const worker=cluster.fork();
console.log('POP_RUSH_ACCEPTOR '+JSON.stringify({pid:process.pid,workerPid:worker.process.pid,workers:1,policy:'round-robin',role:'accept-only-primary'}));
worker.once('listening',address=>console.log('POP_RUSH_ACCEPTOR_READY '+JSON.stringify({address,workerPid:worker.process.pid})));
worker.once('exit',(code,signal)=>{if(timer)clearTimeout(timer);if(!shutting)console.error('POP_RUSH_ACCEPTOR_WORKER_EXIT '+JSON.stringify({code,signal}));process.exit(shutting?0:(code||1))});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 if(shutting)return;shutting=true;
 try{worker.process.kill(signal)}catch{}
 timer=setTimeout(()=>{try{worker.process.kill('SIGKILL')}catch{}process.exit(1)},8000);timer.unref();
});
