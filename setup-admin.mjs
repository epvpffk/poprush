import fs from 'node:fs';
import {env,closeDatabase} from './database.mjs';
import {hashPassword,sha256} from './account.mjs';
import {configPath} from './admin-test.mjs';
let password='';for await(const chunk of process.stdin)password+=chunk;
password=password.replace(/\r?\n$/,'');
if(password.length<8||password.length>128){console.error('비밀번호는 8~128자로 입력하세요.');process.exit(1)}
const username='admin',now=Date.now(),old=await env.DB.prepare('SELECT id FROM accounts WHERE username=?').bind(username).first();
const id=old?.id||crypto.randomUUID(),salt=crypto.randomUUID(),hash=await hashPassword(password,salt);password='';
const statements=old?[env.DB.prepare('UPDATE accounts SET password_hash=?,salt=? WHERE id=?').bind(hash,salt,id)]:[env.DB.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').bind(id,username,hash,salt,now)];
statements.push(env.DB.prepare('INSERT INTO profiles(id,nickname,created) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,'운영자',now));
statements.push(env.DB.prepare('DELETE FROM sessions WHERE user=?').bind(id));
statements.push(env.DB.prepare('DELETE FROM auth_rates WHERE key=?').bind(await sha256('login:'+username)));
await env.DB.batch(statements);
fs.writeFileSync(configPath,JSON.stringify([id])+'\n',{mode:0o600});
console.log('admin 계정 및 운영자 테스트 권한 설정 완료. 새 비밀번호로 로그인하세요.');closeDatabase();
