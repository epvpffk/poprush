import {performance} from 'node:perf_hooks';
import {groups,boardHash} from './game.mjs';
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1]};
if(args.includes('--help')){console.log('Node 24: node loadtest.mjs --url http://YOUR_SERVER --users 100 --seconds 60 --mode battle --rooms 50\nrooms: no fixed cap, each room must have 2–8 users; room-size: 2–8 (default 8); mode: browse | battle; users: no fixed cap (minimum 2 for battle, 1 for browse); seconds: 5–180. Run from a separate machine.');process.exit(0)}
const base=arg('url',''),users=Number(arg('users','10')),seconds=Number(arg('seconds','60')),mode=arg('mode','battle'),roomSize=Number(arg('room-size','8')),roomCount=Number(arg('rooms',String(Math.ceil(users/roomSize))));
if(!/^https?:\/\//.test(base)||!Number.isSafeInteger(users)||users<1||!Number.isInteger(seconds)||seconds<5||seconds>180||!['browse','battle'].includes(mode)||mode==='battle'&&users<2||!Number.isInteger(roomSize)||roomSize<2||roomSize>8||!Number.isSafeInteger(roomCount)||roomCount<1||mode==='battle'&&(users<roomCount*2||users>roomCount*8)){console.error('입력을 확인하세요. 총 인원과 방 개수는 양의 정수로, 방당 2~8명이 되도록 선택하세요. --help로 사용법 확인');process.exit(2)}
const origin=new URL(base).origin;
let stopping=false,phase='setup',errors=[],setupError=null,measuredFailures=0,stopReason=null,measureStarted=0,measureFinished=0;
const failureKinds={};
const metrics={setup:[],measure:[],cleanup:[]},clients=[],rooms=[];
const runStarted=performance.now();let stage='게스트 발급',stageLabel='guest',stageTarget=users,inFlight=0,lastCompleted=performance.now();
function progress(){
 const elapsed=Math.floor((performance.now()-runStarted)/1000),quiet=Math.floor((performance.now()-lastCompleted)/1000);
 if(phase==='measure'){
  const count=metrics.measure.length,elapsedMeasure=Math.floor((performance.now()-measureStarted)/1000);
  console.log(`[측정${stopping?' 중단 대기':''}] ${elapsedMeasure}/${seconds}초 | 요청 ${count}건 | 실패 ${measuredFailures}건 (${(count?100*measuredFailures/count:0).toFixed(2)}%) | 응답 대기 ${inFlight}건`);
 }else{
  const done=metrics[phase].filter(v=>v.label===stageLabel&&v.ok).length;
  console.log(`[${phase==='cleanup'?'정리':'준비'}] ${stage} ${done}/${stageTarget} | 입장 완료 ${metrics.setup.filter(v=>v.label==='join'&&v.ok).length}명 | 전체 경과 ${elapsed}초 | 응답 대기 ${inFlight}건 | 최근 완료 ${quiet}초 전`);
 }
}
function setStage(name,label,target){stage=name;stageLabel=label;stageTarget=target;progress()}
const progressTimer=setInterval(progress,2000);
process.on('SIGINT',()=>{stopping=true;stopReason||='user'});process.on('SIGTERM',()=>{stopping=true;stopReason||='user'});
async function request(c,path,body,label){
 const begin=performance.now();let status=0,ok=false,headersMs=null,bodyMs=null,serverMs=null,responseBytes=null;inFlight++;
 try{
  const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(c?.cookie?{Cookie:c.cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000),redirect:'error'});
  status=response.status;headersMs=performance.now()-begin;
  const appTiming=/(?:^|,)\s*app;dur=([0-9.]+)/.exec(response.headers.get('server-timing')||'');if(appTiming)serverMs=Number(appTiming[1]);
  if(c&&path==='/api/account'){const cookies=response.headers.getSetCookie();const entry=cookies.find(v=>v.startsWith('colorpop_guest='));if(entry)c.cookie=entry.split(';')[0]}
  let d;try{const body=await response.text();bodyMs=performance.now()-begin-headersMs;responseBytes=Buffer.byteLength(body);d=JSON.parse(body)}catch{throw new Error('JSON 응답 아님')}
  if(!response.ok)throw new Error(d.error||`HTTP ${status}`);
  if(d.error)throw new Error(d.error);
  if(path.startsWith('/api/arena?room=')&&!d.room)throw new Error('방 상태 누락');
  ok=true;return d;
 }catch(e){
  const causes=[];let cause=e.cause;
  for(let depth=0;cause&&depth<4;depth++,cause=cause.cause)causes.push({name:cause.name,code:cause.code,message:cause.message});
  const kind=status?`HTTP_${status}`:(causes.find(v=>v.code)?.code||e.name||'UnknownError');
  const key=`${phase}:${label}:${kind}`;failureKinds[key]=(failureKinds[key]||0)+1;
  if(errors.filter(v=>v.phase===phase).length<30)errors.push({phase,label,status,name:e.name,kind,message:e.message,causes,elapsedMs:Math.round(performance.now()-begin)});
  throw e
 }
 finally{inFlight--;lastCompleted=performance.now();metrics[phase].push({label,status,ok,ms:performance.now()-begin,headersMs,bodyMs,serverMs,responseBytes});if(phase==='measure'&&!ok)measuredFailures++}
}
async function pool(items,limit,fn){let cursor=0;const results=await Promise.allSettled(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await fn(item)}}));const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason}
function update(c,d){if(d.room)c.room=d.room;if(d.serverNow)c.offset=d.serverNow-Date.now()}
try{
 console.log(`준비: ${mode}, ${users}명, ${roomCount}개 방, ${seconds}초, ${origin}`);
 progress();
 for(let i=0;i<users;i++)clients.push({index:i,cookie:'',code:'',room:null});
 await pool(clients,8,async c=>{if(stopping)throw new Error('사용자 중단');await request(c,'/api/account',{action:'guest'},'guest');if(!c.cookie)throw new Error('게스트 세션 발급 실패')});
 if(mode==='battle'){
  const count=roomCount;let cursor=0;
  for(let i=0;i<count;i++){const size=Math.floor(users/count)+(i<users%count?1:0);rooms.push(clients.slice(cursor,cursor+size));cursor+=size}
  setStage('방 생성','create',roomCount);
  await pool(rooms,4,async members=>{const host=members[0],d=await request(host,'/api/arena',{action:'create',title:'LOADTEST 게스트',maxPlayers:members.length,durationSeconds:300,penaltySeconds:0,colors:4,refillMode:true},'create');if(!d.room)throw new Error('방 생성 실패');host.code=d.room.code;update(host,d);for(const c of members.slice(1)){c.code=host.code;update(c,await request(c,'/api/arena',{action:'join',code:c.code},'join'))}});
  setStage('게임 시작','start',roomCount);
  await pool(rooms,4,async members=>{if(stopping)throw new Error('사용자 중단');update(members[0],await request(members[0],'/api/arena',{action:'start',code:members[0].code},'start'))});
 }
 if(stopping)throw new Error('사용자 중단');
 phase='measure';measureStarted=performance.now();console.log(`측정 시작: 대전방 ${rooms.length}개. Ctrl+C로 중단 가능`);
 const deadline=performance.now()+seconds*1000;
 await Promise.all(clients.map(async c=>{
  let nextPoll=0,nextBeat=0;
  while(!stopping&&performance.now()<deadline){const began=performance.now();try{
   if(mode==='browse'){await request(c,'/api/arena',null,'menu')}
   else{
    if(began>=nextPoll){update(c,await request(c,'/api/arena?room='+c.code,null,'poll'));nextPoll=began+1000}
    if(began>=nextBeat){update(c,await request(c,'/api/arena',{action:'heartbeat',code:c.code},'heartbeat'));nextBeat=began+5000}
    const r=c.room,p=r?.players.find(p=>p.id==='me');
    if(r?.status==='playing'&&p&&!p.done&&!p.forfeit&&Date.now()+(c.offset||0)>=r.startAt){const candidates=groups(p.board);if(candidates.length){const index=candidates[Math.floor(Math.random()*candidates.length)][0];update(c,await request(c,'/api/arena',{action:'move',code:c.code,index,seq:p.moveSeq||0,boardHash:boardHash(p.board)},'move'))}}
   }
  }catch{}
  const m=metrics.measure;if(!stopping&&m.length>100&&measuredFailures>20&&measuredFailures/m.length>.05){stopping=true;stopReason='failure-rate';console.log('오류율 5% 초과로 자동 중단: 진행 중인 요청을 마친 뒤 결과를 저장합니다.');break}
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,(mode==='browse'?2500:500)-(performance.now()-began))));
 }
 }));
}catch(e){setupError=e.message;console.error('중단:',e.message)}
finally{
 measureFinished=performance.now();phase='cleanup';setStage('방 나가기','leave',clients.filter(c=>c.code).length);await pool(clients.filter(c=>c.code),8,async c=>{try{await request(c,'/api/arena',{action:'leave',code:c.code},'leave')}catch{}}).catch(()=>{});
 clearInterval(progressTimer);console.log('정리 완료: 최종 결과를 저장합니다.');
}
const percentile=(a,n)=>a.length?a[Math.max(0,Math.ceil(a.length*n)-1)]:null;
const report={mode,users,rooms:rooms.length,playersPerRoom:rooms.map(r=>r.length),requestedSeconds:seconds,stoppedEarly:stopping,setupError,requests:metrics.measure.length,failures:metrics.measure.filter(r=>!r.ok).length,byEndpoint:{}};
for(const label of new Set(metrics.measure.map(r=>r.label))){const rows=metrics.measure.filter(r=>r.label===label),times=rows.map(r=>r.ms).sort((a,b)=>a-b);report.byEndpoint[label]={requests:rows.length,failures:rows.filter(r=>!r.ok).length,p50:Math.round(percentile(times,.5)),p95:Math.round(percentile(times,.95)),max:Math.round(times.at(-1))}}
for(const [label,summary] of Object.entries(report.byEndpoint)){
 const rows=metrics.measure.filter(r=>r.label===label&&r.ok);
 function distribution(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return {samples:sorted.length,p50:sorted.length?Math.round(percentile(sorted,.5)):null,p95:sorted.length?Math.round(percentile(sorted,.95)):null,max:sorted.length?Math.round(sorted.at(-1)):null}}
 summary.successTimingMs={toHeaders:distribution(rows.filter(r=>r.headersMs!==null).map(r=>r.headersMs)),body:distribution(rows.filter(r=>r.bodyMs!==null).map(r=>r.bodyMs)),serverApp:distribution(rows.filter(r=>r.serverMs!==null).map(r=>r.serverMs)),outsideApp:distribution(rows.filter(r=>r.serverMs!==null).map(r=>Math.max(0,r.ms-r.serverMs)))};
 summary.responseBytes=distribution(rows.filter(r=>r.responseBytes!==null).map(r=>r.responseBytes));
}
report.failureRate=report.requests?report.failures/report.requests:1;
report.initialTargetPass=!setupError&&!stopping&&report.requests>0&&report.failureRate<.01&&Object.values(report.byEndpoint).every(v=>v.p95<500)&&(mode!=='battle'||(report.byEndpoint.move?.requests||0)>0);
report.toolVersion=7;report.timeoutMs=5000;report.stopReason=stopReason;report.measuredSeconds=measureStarted?Math.round((measureFinished-measureStarted)/100)/10:0;report.failureKinds=failureKinds;report.samples=errors;report.timingNotes='successTimingMs는 성공한 요청만 집계합니다. toHeaders에는 서버·프록시·연결 대기가 포함되고 body는 응답 수신과 해석 시간입니다. serverApp는 v50 이상 서버 헤더, outsideApp는 요청별 전체시간에서 서버시간을 뺀 값으로 네트워크·프록시·클라이언트 대기를 구분하지는 못합니다. responseBytes는 압축 해제된 응답 크기입니다.';report.notes='API 부하 측정입니다. 실제 브라우저 렌더링·터치·음악 다운로드 부하는 포함하지 않습니다. 테스트 게스트·방 데이터는 남을 수 있으며 일반 계정 랭킹에는 기록되지 않습니다.';
console.log(JSON.stringify(report,null,2));if(!report.initialTargetPass)process.exitCode=1;
