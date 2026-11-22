import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'poprush-smoke-'));
const child=spawn(process.execPath,['server.mjs'],{
  cwd:root,env:{...process.env,PORT:'0',PUBLIC_ORIGIN:'',DATABASE_PATH:path.join(temporary,'smoke.sqlite')},
  stdio:['ignore','pipe','pipe'],
});
let output='',failure='';
child.stdout.on('data',chunk=>{output+=chunk});
child.stderr.on('data',chunk=>{failure+=chunk});
const exited=once(child,'exit');
try{
  const deadline=Date.now()+15000;
  while(!/COLORPOP_READY (\d+)/.test(output)){
    if(child.exitCode!==null||Date.now()>deadline)throw new Error('Server startup failed: '+failure);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const base='http://127.0.0.1:'+output.match(/COLORPOP_READY (\d+)/)[1];
  for(const route of ['/healthz','/version.json','/api/arena','/']){
    const response=await fetch(base+route,{signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200,route);
    if(route==='/api/arena')assert.ok(Array.isArray((await response.json()).ranking));
  }
  assert.ok(fs.existsSync(path.join(temporary,'smoke.sqlite')));
  console.log('Smoke passed: isolated DB migrations, health, version, arena API and frontend.');
}finally{
  child.kill('SIGTERM');
  const killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);killTimer.unref();
  await exited;clearTimeout(killTimer);
  // Only this script's newly generated temporary fixture is removed.
  fs.rmSync(temporary,{recursive:true,force:true});
}
