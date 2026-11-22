import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentAccount,sameOrigin,accountDb} from './account.mjs';
import {popPoints,comboBonusPercent} from './game.mjs';
import {MAX_XP,MAX_LEVEL,totalXpForLevel,progressFromXp} from './level.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export const configPath=path.join(path.dirname(process.env.DATABASE_PATH||path.join(root,'data','colorpop.sqlite')),'admin-test-accounts.json');
export async function isTestAdmin(req){const account=await currentAccount(req);if(!account||account.username!=='admin')return false;try{const ids=JSON.parse(fs.readFileSync(configPath,'utf8'));return Array.isArray(ids)&&ids.includes(account.id)}catch{return false}}
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function progress(id){const row=await accountDb().prepare('SELECT xp FROM player_progress WHERE user=?').bind(id).first();return progressFromXp(row?.xp||0)}
export async function GET(req){const allowed=await isTestAdmin(req);return json({allowed,...(allowed?{progress:await progress((await currentAccount(req)).id)}:{})})}
export async function POST(req){
 if(!sameOrigin(req))return json({error:'허용되지 않은 요청입니다.'},403);
 if(!await isTestAdmin(req))return json({error:'운영자 전용입니다.'},403);
 let d;try{d=await req.json()}catch{return json({error:'잘못된 입력입니다.'},400)}
 if(['level_up','level_down','level_up_10','level_down_10','reset_level','add_xp'].includes(d.action)){
  if(d.action==='add_xp'&&![1,10,100,1000,10000].includes(d.amount))return json({error:'지원하지 않는 경험치입니다.'},400);
  const account=await currentAccount(req),db=accountDb(),now=Date.now();
  try{
   const statements=[db.prepare('INSERT OR IGNORE INTO player_progress(user,xp,updated) VALUES(?,0,?)').bind(account.id,now)];
   if(d.action==='add_xp')statements.push(db.prepare('UPDATE player_progress SET xp=MIN(?,xp+?),updated=? WHERE user=?').bind(MAX_XP,d.amount,now,account.id));
   else if(d.action==='reset_level')statements.push(db.prepare('UPDATE player_progress SET xp=0,updated=? WHERE user=?').bind(now,account.id));
   else{
    // Calculate the adjacent level inside SQL against the latest committed XP.
    // This avoids overwriting concurrent game awards with a stale read.
    const step={level_up:1,level_down:-1,level_up_10:10,level_down_10:-10}[d.action],branches=[];
    for(let level=MAX_LEVEL;level>=1;level--){
     const next=Math.max(1,Math.min(MAX_LEVEL,level+step));
     branches.push(`WHEN xp>=${totalXpForLevel(level)} THEN ${next===level?'MIN(xp,'+MAX_XP+')':totalXpForLevel(next)}`);
    }
    statements.push(db.prepare('UPDATE player_progress SET xp=CASE '+branches.join(' ')+' ELSE 0 END,updated=? WHERE user=?').bind(now,account.id));
   }
   await db.batch(statements);
   return json({ok:true,progress:await progress(account.id),saved:true});
  }catch{return json({error:'레벨 변경을 저장하지 못했습니다.'},500)}
 }
 if(!Number.isInteger(d.combo)||d.combo<1||d.combo>1000||!Number.isInteger(d.count)||d.count<2||d.count>100)return json({error:'범위를 확인하세요.'},400);
 const p=popPoints(d.count,d.combo-1,1000,2000);return json({...p,percent:comboBonusPercent(p.combo),test:true})
}
