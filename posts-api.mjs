import {env} from './database.mjs';
import {currentAccount,sameOrigin} from './account.mjs';
import {isTestAdmin} from './admin-test.mjs';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function content(d){const title=typeof d.title==='string'?d.title.trim():'',body=typeof d.body==='string'?d.body.trim():'';return title.length>=2&&title.length<=100&&body.length>=2&&body.length<=5000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(title+body)?{title,body}:null}
const invalidContent=()=>reply({error:'제목은 2~100자, 내용은 2~5,000자로 입력하세요.'},400);
export async function GET(req){
 const url=new URL(req.url),kind=url.searchParams.get('kind');if(!['notice','feedback'].includes(kind))return reply({error:'게시판을 확인하세요.'},400);
 const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'페이지를 확인하세요.'},400);
 const account=await currentAccount(req),admin=account?await isTestAdmin(req):false;
 const rows=await env.DB.prepare('SELECT id,author_id,author_name,title,body,created,updated,revision FROM community_posts WHERE kind=? ORDER BY created DESC,id DESC LIMIT 21 OFFSET ?').bind(kind,offset).all();
 return reply({posts:rows.results.slice(0,20).map(({author_id,...post})=>({...post,canManage:!!account&&(admin||author_id===account.id)})),hasMore:rows.results.length>20});
}
export async function POST(req){
 if(!sameOrigin(req))return reply({error:'허용되지 않은 요청입니다.'},403);const account=await currentAccount(req);if(!account)return reply({error:'로그인 후 글을 작성하세요.'},401);
 let d;try{d=await req.json()}catch{return reply({error:'입력을 확인하세요.'},400)}if(!d||typeof d!=='object'||Array.isArray(d))return reply({error:'입력을 확인하세요.'},400);if(!['notice','feedback'].includes(d.kind))return reply({error:'게시판을 확인하세요.'},400);
 if(d.kind==='notice'&&!await isTestAdmin(req))return reply({error:'공지사항은 운영자만 작성할 수 있습니다.'},403);
 const text=content(d);if(!text)return invalidContent();const now=Date.now();const recent=await env.DB.prepare('SELECT created FROM community_posts WHERE author_id=? ORDER BY created DESC LIMIT 1').bind(account.id).first();if(recent&&now-recent.created<10000)return reply({error:'잠시 후 작성해 주세요. 글은 10초 간격으로 등록할 수 있습니다.'},429);
 const post={id:crypto.randomUUID(),author_name:account.username,...text,created:now,updated:null,revision:0,canManage:true};
 await env.DB.prepare('INSERT INTO community_posts(id,kind,author_id,author_name,title,body,created) VALUES(?,?,?,?,?,?,?)').bind(post.id,d.kind,account.id,post.author_name,text.title,text.body,now).run();return reply({post},201);
}
async function mutate(req,remove){
 if(!sameOrigin(req))return reply({error:'허용되지 않은 요청입니다.'},403);const account=await currentAccount(req);if(!account)return reply({error:'로그인 후 이용하세요.'},401);
 let d;try{d=await req.json()}catch{return reply({error:'입력을 확인하세요.'},400)}if(!d||typeof d!=='object'||Array.isArray(d))return reply({error:'입력을 확인하세요.'},400);
 if(typeof d.id!=='string'||d.id.length>64||!Number.isSafeInteger(d.revision)||d.revision<0)return reply({error:'게시글 정보를 확인하세요.'},400);
 const post=await env.DB.prepare('SELECT * FROM community_posts WHERE id=?').bind(d.id).first();if(!post)return reply({error:'삭제되었거나 존재하지 않는 글입니다.'},404);
 if(post.author_id!==account.id&&!await isTestAdmin(req))return reply({error:'본인이 작성한 글만 수정·삭제할 수 있습니다.'},403);
 if(post.revision!==d.revision)return reply({error:'다른 곳에서 글이 변경됐습니다. 새로고침 후 다시 확인하세요.'},409);
 if(remove){const result=await env.DB.prepare('DELETE FROM community_posts WHERE id=? AND revision=?').bind(post.id,d.revision).run();if(!result.meta.changes)return reply({error:'글이 변경됐습니다. 새로고침 후 다시 확인하세요.'},409);return reply({ok:true})}
 const text=content(d);if(!text)return invalidContent();const updated=Date.now();
 const result=await env.DB.prepare('UPDATE community_posts SET title=?,body=?,updated=?,revision=revision+1 WHERE id=? AND revision=?').bind(text.title,text.body,updated,post.id,d.revision).run();if(!result.meta.changes)return reply({error:'글이 변경됐습니다. 새로고침 후 다시 확인하세요.'},409);
 return reply({post:{id:post.id,author_name:post.author_name,...text,created:post.created,updated,revision:d.revision+1,canManage:true}});
}
export async function PATCH(req){return mutate(req,false)}
export async function DELETE(req){return mutate(req,true)}
