import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';
let db,queue=[],timer=null;const cache=new Map();
function compiled(sql){let s=cache.get(sql);if(!s){s=db.prepare(sql);if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(sql,s)}return s}
function execute(s){const r=compiled(s.sql).run(...s.values);return{meta:{changes:Number(r.changes)}}}
function result(id,value,error,extra={}){parentPort.postMessage({kind:'result',id,value,error:error?{name:error.name,message:error.message}:null,...extra})}
function flush(){
 if(timer){clearTimeout(timer);timer=null}if(!queue.length)return;
 const jobs=queue.splice(0),completed=[],start=performance.now();let transaction=false;
 try{
  db.exec('BEGIN IMMEDIATE');transaction=true;
  for(const job of jobs){
   const waitMs=performance.now()-job.arrived;db.exec('SAVEPOINT write_job');
   try{const value=job.op==='batch'?job.statements.map(execute):execute(job.statement);db.exec('RELEASE write_job');completed.push({job,value,waitMs})}
   catch(error){db.exec('ROLLBACK TO write_job; RELEASE write_job');completed.push({job,error,waitMs})}
  }
  db.exec('COMMIT');transaction=false;const transactionMs=performance.now()-start;
  parentPort.postMessage({kind:'commit',duration:transactionMs,jobs:jobs.length});
  for(const e of completed)result(e.job.id,e.value,e.error,{waitMs:e.waitMs,transactionMs});
 }catch(error){if(transaction)try{db.exec('ROLLBACK')}catch{}for(const job of jobs)result(job.id,null,error)}
}
try{
 fs.mkdirSync(path.dirname(workerData.file),{recursive:true});db=new DatabaseSync(workerData.file);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
 for(const name of fs.readdirSync(workerData.migrations).filter(n=>n.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM _migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN');try{db.exec(fs.readFileSync(path.join(workerData.migrations,name),'utf8'));db.prepare('INSERT INTO _migrations VALUES(?,?)').run(name,Date.now());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 }
 parentPort.on('message',job=>{
  if(job.op==='run'||job.op==='batch'){queue.push({...job,arrived:performance.now()});if(!timer)timer=setTimeout(flush,8);return}
  try{
   if(job.op==='close'){flush();db.close();result(job.id,true);parentPort.close();return}
   const start=performance.now(),s=compiled(job.statement.sql),values=job.statement.values;
   const value=job.op==='first'?(s.get(...values)||null):job.op==='all'?{results:s.all(...values)}:(()=>{throw Error('지원하지 않는 DB 작업')})();
   result(job.id,value,null,{readMs:performance.now()-start});
  }catch(error){result(job.id,null,error)}
 });
 parentPort.postMessage({kind:'ready'});
}catch(error){parentPort.postMessage({kind:'startup-error',error:{name:error.name,message:error.message}});parentPort.close()}
