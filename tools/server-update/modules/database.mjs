import {Worker} from 'node:worker_threads';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {timingContext,addTiming,recordCommit} from './performance.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const worker=new Worker(new URL('./database-worker.mjs',import.meta.url),{workerData:{file:process.env.DATABASE_PATH||path.join(root,'data','colorpop.sqlite'),migrations:path.join(root,'migrations')}});
const pending=new Map();let sequence=0,closing=false,failed=null,readyResolve,readyReject;
const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});ready.catch(()=>{});
function failure(error){failed=error;readyReject(error);for(const p of pending.values())p.reject(error);pending.clear()}
worker.on('error',failure);
worker.on('exit',code=>{if(!closing||code)failure(new Error('DB worker가 종료되었습니다: '+code))});
worker.on('message',message=>{
 if(message.kind==='ready'){readyResolve();console.log('POP_RUSH_DB_WORKER_READY');return}
 if(message.kind==='startup-error'){failure(Object.assign(new Error(message.error.message),{name:message.error.name}));return}
 if(message.kind==='commit'){recordCommit(message.duration,message.jobs);return}
 const p=pending.get(message.id);if(!p)return;pending.delete(message.id);
 if(message.transactionMs!==undefined){addTiming('db_wait',message.waitMs,p.context);addTiming('db_transaction',message.transactionMs,p.context)}
 if(message.readMs!==undefined)addTiming('db_read',message.readMs,p.context);
 if(message.error)p.reject(Object.assign(new Error(message.error.message),{name:message.error.name}));else p.resolve(message.value);
});
async function rpc(op,body={}){
 if(failed)throw failed;if(closing&&op!=='close')throw new Error('DB가 종료 중입니다.');
 await ready;if(failed)throw failed;
 const id=++sequence,context=timingContext();
 return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,context});try{worker.postMessage({id,op,...body})}catch(error){pending.delete(id);reject(error)}});
}
function prepare(sql){let values=[];return{bind(...args){values=args;return this},descriptor(){return{sql,values:[...values]}},first(){return rpc('first',{statement:this.descriptor()})},all(){return rpc('all',{statement:this.descriptor()})},run(){return rpc('run',{statement:this.descriptor()})}}}
export const env={DB:{prepare,batch(statements){return rpc('batch',{statements:statements.map(s=>s.descriptor())})}}};
let closePromise;
export function closeDatabase(){return closePromise||(closePromise=(async()=>{closing=true;await rpc('close');await worker.terminate()})())}
