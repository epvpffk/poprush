import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=[];
function walk(dir){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','.git','data','logs','public'].includes(item.name))continue;
    const file=path.join(dir,item.name);
    if(item.isDirectory())walk(file);
    else if(item.name.endsWith('.mjs'))files.push(file);
  }
}
walk(root);
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)throw new Error(`${path.relative(root,file)}\n${result.stderr||result.error}`);
}
for(const asset of fs.readFileSync(path.join(root,'public/index.html'),'utf8').matchAll(/(?:src|href)="(\/[^"?#]+)"/g)){
  if(!fs.existsSync(path.join(root,'public',asset[1])))throw new Error('Missing asset: '+asset[1]);
}
console.log(`Checked ${files.length} JavaScript modules and public entry assets.`);
