import {timingContext,addTiming,recordCommit} from './performance.mjs';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const file=process.env.DATABASE_PATH||path.join(root,'data','colorpop.sqlite');
fs.mkdirSync(path.dirname(file),{recursive:true});
const sqlite=new DatabaseSync(file);
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
for(const name of fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort()){
 if(sqlite.prepare('SELECT name FROM _migrations WHERE name=?').get(name))continue;
 sqlite.exec('BEGIN');try{sqlite.exec(fs.readFileSync(path.join(root,'migrations',name),'utf8'));sqlite.prepare('INSERT INTO _migrations VALUES(?,?)').run(name,Date.now());sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}
}
// Group concurrent writes into one durable transaction. Replies wait for COMMIT.
const writeQueue=[];let writeTimer=null;
function enqueueWrite(execute){return new Promise((resolve,reject)=>{writeQueue.push({execute,resolve,reject,context:timingContext(),queuedAt:performance.now()});if(!writeTimer)writeTimer=setTimeout(flushWrites,8)})}
function flushWrites(){
 if(writeTimer){clearTimeout(writeTimer);writeTimer=null}
 if(!writeQueue.length)return;
 const jobs=writeQueue.splice(0),completed=[],began=performance.now();let transaction=false;
 try{
  sqlite.exec('BEGIN IMMEDIATE');transaction=true;
  for(const job of jobs){
   addTiming('db_wait',performance.now()-job.queuedAt,job.context);
   sqlite.exec('SAVEPOINT write_job');
   try{const result=job.execute();sqlite.exec('RELEASE write_job');completed.push({job,result})}
   catch(error){sqlite.exec('ROLLBACK TO write_job; RELEASE write_job');completed.push({job,error})}
  }
  sqlite.exec('COMMIT');transaction=false;const duration=performance.now()-began;recordCommit(duration,jobs.length);for(const job of jobs)addTiming('db_transaction',duration,job.context);
  for(const entry of completed){if(entry.error)entry.job.reject(entry.error);else entry.job.resolve(entry.result)}
 }catch(error){if(transaction){try{sqlite.exec('ROLLBACK')}catch{}}for(const job of jobs)job.reject(error)}
}
const statementCache=new Map();
function compiled(sql){let statement=statementCache.get(sql);if(!statement){statement=sqlite.prepare(sql);if(statementCache.size>=128)statementCache.delete(statementCache.keys().next().value);statementCache.set(sql,statement)}return statement}
function prepare(sql){let values=[];const statement={bind(...args){values=args;return this},first(){return compiled(sql).get(...values)||null},all(){return{results:compiled(sql).all(...values)}},execute(){const result=compiled(sql).run(...values);return{meta:{changes:Number(result.changes)}}},run(){const bound=[...values];return enqueueWrite(()=>{const result=compiled(sql).run(...bound);return{meta:{changes:Number(result.changes)}}})}};return statement}
export const env={DB:{prepare,batch(statements){return enqueueWrite(()=>statements.map(s=>s.execute()))}}};
export function closeDatabase(){flushWrites();sqlite.close()}
