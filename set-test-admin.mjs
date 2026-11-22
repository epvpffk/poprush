import fs from 'node:fs';
import {env} from './database.mjs';
import {configPath} from './admin-test.mjs';
const username=process.argv[2];
if(!username){console.error('게임 로그인 아이디를 입력하세요.');process.exit(1)}
const account=await env.DB.prepare('SELECT id,username FROM accounts WHERE username=?').bind(username).first();
if(!account){console.error('등록된 로그인 아이디를 찾지 못했습니다. 닉네임이 아닌 아이디를 입력하세요.');process.exit(1)}
fs.writeFileSync(configPath,JSON.stringify([account.id])+'\n',{mode:0o600});
console.log('운영자 테스트 계정 지정 완료:',account.username);
