import {releaseAudio,playAudio} from './audio-mixer';
import {useEffect,useRef,useState} from 'react';
import ComboFeedback from './combo-feedback';
import {levelColor,progressFromXp} from '../lib/level';
const levels=[10,20,40,60,90,120,150,175,200];
const colors=['#ef7087','#edc15c','#5dbdab','#8583ef'],symbols=['●','◆','▲','✦'];
export default function AdminTest({username,visible,onAllowed,onProgress}:{username?:string;visible:boolean;onAllowed:(value:boolean)=>void;onProgress:(value:ReturnType<typeof progressFromXp>)=>void}){
 const [allowed,setAllowed]=useState(false),[combo,setCombo]=useState(10),[count,setCount]=useState(5),[result,setResult]=useState<any>(null),[error,setError]=useState('');
 const [burst,setBurst]=useState<number[]>([]),[revision,setRevision]=useState(0),[displayId,setDisplayId]=useState(0);
 const [progress,setProgress]=useState(progressFromXp(0)),[progressBusy,setProgressBusy]=useState(false),[progressMessage,setProgressMessage]=useState('');
 const progressLock=useRef(false),progressSequence=useRef(0);
 const board=useRef<HTMLDivElement|null>(null),focusTile=useRef(55),sounds=useRef<HTMLAudioElement[]>([]),seq=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{let gone=false;setAllowed(false);onAllowed(false);setResult(null);seq.current++;if(username)void fetch('/api/admin-test',{credentials:'include',cache:'no-store'}).then(r=>r.json()).then(d=>{if(!gone){setAllowed(d.allowed===true);onAllowed(d.allowed===true)}}).catch(()=>{});return()=>{gone=true}},[username,onAllowed]);
 useEffect(()=>()=>{seq.current++;sounds.current.forEach(a=>{a.pause();releaseAudio(a)});if(timer.current)clearTimeout(timer.current)},[]);
 useEffect(()=>{
  const token=++progressSequence.current;
  if(!allowed||!visible)return;
  void fetch('/api/admin-test',{credentials:'include',cache:'no-store'}).then(r=>r.json()).then(d=>{if(progressSequence.current===token&&d.allowed&&d.progress){setProgress(d.progress);onProgress(d.progress)}}).catch(()=>{});
  return()=>{progressSequence.current++};
 },[allowed,visible,username,onProgress]);
 async function changeProgress(action:string,amount?:number){
  if(progressLock.current)return;
  if(action==='reset_level'&&!window.confirm('운영자 본인 계정의 레벨을 1, 누적 경험치를 0으로 초기화할까요?'))return;
  progressLock.current=true;setProgressBusy(true);setProgressMessage('');
  const token=++progressSequence.current;
  try{
   const r=await fetch('/api/admin-test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(amount===undefined?{}:{amount})})});
   const d=await r.json();if(progressSequence.current!==token)return;
   if(!r.ok)throw new Error(d.error||'레벨 변경 실패');
   setProgress(d.progress);onProgress(d.progress);
   setProgressMessage(`${d.progress.level}레벨 · 누적 ${d.progress.totalXp.toLocaleString()} XP 저장 완료`);
  }catch(e){if(progressSequence.current===token)setProgressMessage((e as Error).message)}
  finally{progressLock.current=false;setProgressBusy(false)}
 }
 function sound(){sounds.current.forEach(a=>{a.pause();releaseAudio(a)});const a=new Audio('/sounds/block-pop.mp3');sounds.current=[a];void playAudio(a).catch(()=>setError('화면을 클릭한 뒤 다시 시도하세요.'))}

 async function test(level:number,index=focusTile.current){
  const id=++seq.current;setError('');
  try{
   const r=await fetch('/api/admin-test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({combo:level,count})});
   const d=await r.json();if(id!==seq.current)return;
   if(!r.ok){if(r.status===403){setAllowed(false);onAllowed(false)}throw new Error(d.error||'테스트 실패')}
   setCombo(level);setResult(d);setDisplayId(id);focusTile.current=index;
   const tile=board.current?.children[index];
   if(tile){const rect=tile.getBoundingClientRect();window.dispatchEvent(new CustomEvent('poprush-admin-combo',{detail:{x:rect.left+rect.width/2,y:rect.top+rect.height/2,combo:d.combo,previous:0}}))}
   sound();setBurst(Array.from({length:count},(_,n)=>(index+n)%100));
   if(timer.current)clearTimeout(timer.current);
   timer.current=setTimeout(()=>{setBurst([]);setRevision(v=>v+1)},260);
  }catch(e){if(id===seq.current)setError((e as Error).message)}
 }
 useEffect(()=>{if(!visible){seq.current++;sounds.current.forEach(a=>{a.pause();releaseAudio(a)});if(timer.current)clearTimeout(timer.current);setBurst([])}},[visible]);
 if(!allowed||!visible)return null;
 return <section className="admin-test">
  <div className="card admin-level-controls">
   <h2>레벨·경험치 테스트</h2>
   <p>운영자 본인 계정의 레벨과 경험치가 실제로 저장됩니다. 레벨 업·다운은 해당 레벨의 시작 경험치로 이동합니다.</p>
   <div className="admin-level-current"><span className="level-badge"><b style={{background:levelColor(progress.level)}}>{progress.level}</b><span>레벨</span></span><span>누적 {progress.totalXp.toLocaleString()} XP</span></div>
   <div className="level-progress" role="progressbar" aria-label="현재 레벨 경험치" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{width:`${progress.percent}%`}}/></div>
   <p className="fine">{progress.atMax?'최고 레벨입니다.':`${progress.currentXp.toLocaleString()} / ${progress.nextXp.toLocaleString()} XP`}</p>
   <div className="admin-test-levels"><button type="button" className="ghost" disabled={progressBusy||progress.level<=1} onClick={()=>void changeProgress('level_down')}>레벨 −1</button><button type="button" className="primary" disabled={progressBusy||progress.level>=200} onClick={()=>void changeProgress('level_up')}>레벨 +1</button></div>
   <div className="admin-test-levels admin-xp-buttons"><button type="button" className="ghost" disabled={progressBusy||progress.level<=1} onClick={()=>void changeProgress('level_down_10')}>레벨 −10</button><button type="button" className="primary" disabled={progressBusy||progress.atMax} onClick={()=>void changeProgress('level_up_10')}>레벨 +10</button><button type="button" className="ghost" disabled={progressBusy} onClick={()=>void changeProgress('reset_level')}>레벨 초기화</button></div>
   <div className="admin-test-levels admin-xp-buttons">{[1,10,100,1000,10000].map(amount=><button type="button" className="ghost" key={amount} disabled={progressBusy||progress.atMax} onClick={()=>void changeProgress('add_xp',amount)}>XP +{amount.toLocaleString()}</button>)}</div>
   <p role="status" aria-live="polite">{progressBusy?'저장 중…':progressMessage}</p>
  </div>
  <ComboFeedback scope={'admin:'+username} active={visible&&allowed} eventName="poprush-admin-combo"/>
  <div className="card"><h2>운영자 UI 테스트</h2><p>단계를 누르거나 아래 블록을 누르면 실제 게임의 콤보 팝업과 보너스 효과음이 나옵니다. 모든 블록에서 테스트할 수 있으며 2초 제한과 오클릭 페널티가 없습니다. 점수는 저장하지 않습니다.</p>
   <div className="admin-test-levels">{levels.map(n=><button className={combo===n?'primary':'ghost'} key={n} onClick={()=>void test(n)}>{n}콤보</button>)}</div>
   <div className="admin-test-inputs"><label>콤보 <input type="number" min="1" max="1000" value={combo} onChange={e=>setCombo(Number(e.target.value))}/></label><label>제거 블록 <input type="number" min="2" max="100" value={count} onChange={e=>setCount(Number(e.target.value))}/></label><button className="primary" onClick={()=>void test(combo)}>UI·소리 다시 재생</button><button className="ghost" onClick={sound}>블록 소리 듣기</button></div>
   {error&&<p role="alert">{error}</p>}
  </div>
  <div className="admin-preview"><span className="eyebrow">GAME UI PREVIEW · 기록 미저장</span>
   <div className="statgrid"><div className="stat"><small>이번 테스트 점수</small><strong>{(result?.total||0).toLocaleString()}</strong></div><div className="stat"><small>테스트 콤보</small><strong>{result?.combo||'—'}</strong></div><div className="stat"><small>총배율</small><strong>{result?(1+result.percent/100)+'배':'—'}</strong></div></div>
   <div className="boardwrap"><div ref={board} className="board" aria-label="운영자 테스트 블록판">{Array.from({length:100},(_,i)=>{const c=(Math.floor(i/2)+Math.floor(i/20)+revision)%4;return <button key={i} className={'tile'+(burst.includes(i)?' admin-tile-pop':'')} style={{background:colors[c]}} aria-label={`테스트 ${Math.floor(i/10)+1}행 ${i%10+1}열`} onClick={()=>void test(combo,i)}>{symbols[c]}</button>})}</div></div>
   <p className="fine">블록판은 연출 확인용입니다. 선택한 제거 블록 수를 기준으로 점수를 계산하며, 누른 위치에 실제 게임과 같은 콤보 팝업을 표시합니다.</p>
   {result&&<div className="admin-test-result"><strong>{result.combo} COMBO</strong><span>보너스 +{result.percent}% · 총 {1+result.percent/100}배</span><p>기본 {result.base.toLocaleString()} + 보너스 {result.bonus.toLocaleString()} = <b>{result.total.toLocaleString()}점</b></p></div>}
  </div>
 </section>;
}
