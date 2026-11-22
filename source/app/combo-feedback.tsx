import {attachAudio,releaseAudio,playAudio} from './audio-mixer';
import {useEffect,useRef,useState} from 'react';
import {comboBonusPercent} from '../lib/game';

type Pop={id:number;x:number;y:number;combo:number;bonus:number;up:boolean};
export function popCombo(index:number,combo:number,previous:number){
  const tile=document.querySelector('[aria-label="블록 게임판"]')?.children[index];
  if(!tile)return;
  const rect=tile.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent('poprush-combo',{detail:{x:rect.left+rect.width/2,y:rect.top+rect.height/2,combo,previous}}));
}
function loadVoice(){try{return localStorage.getItem('poprush-combo-voice')!=='off'}catch{return true}}
export default function ComboFeedback({scope,active,eventName="poprush-combo"}:{scope:string;active:boolean;eventName?:string}){
  const [pops,setPops]=useState<Pop[]>([]),[voice,setVoice]=useState(loadVoice);
  const serial=useRef(0),timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const bonusAudio=useRef<HTMLAudioElement|null>(null);
  const enabled=useRef(voice);enabled.current=voice;

  useEffect(()=>{const change=(e:Event)=>setVoice((e as CustomEvent).detail);window.addEventListener('poprush-voice-setting',change);return()=>window.removeEventListener('poprush-voice-setting',change)},[]);
  useEffect(()=>{
    const a=new Audio('/sounds/combo-bonus.mp3');a.preload='auto';attachAudio(a);a.load();bonusAudio.current=a;
    return()=>{a.pause();releaseAudio(a);a.removeAttribute('src');a.load();bonusAudio.current=null};
  },[]);
  function stop(){const a=bonusAudio.current;if(a){a.pause();a.currentTime=0}}
  function announce(){
    try{
    const a=bonusAudio.current;if(!enabled.current||!a)return;
    a.currentTime=0;void playAudio(a).catch(()=>{});
    }catch{}
  }
  useEffect(()=>{try{localStorage.setItem('poprush-combo-voice',voice?'on':'off')}catch{}if(!voice)stop()},[voice]);
  useEffect(()=>{
    const receive=(event:Event)=>{
      if(!active)return;
      const d=(event as CustomEvent).detail;
      const id=++serial.current,bonus=comboBonusPercent(d.combo),up=bonus>comboBonusPercent(d.previous);
      setPops(p=>[...p.slice(-3),{id,x:Math.max(72,Math.min(window.innerWidth-72,d.x)),y:Math.max(78,d.y-12),combo:d.combo,bonus,up}]);
      const timer=setTimeout(()=>{setPops(p=>p.filter(v=>v.id!==id));timers.current=timers.current.filter(t=>t!==timer)},1000);
      timers.current.push(timer);
      if(up)announce();
    };
    window.addEventListener(eventName,receive);
    return()=>window.removeEventListener(eventName,receive);
  },[active,eventName]);
  useEffect(()=>{setPops([]);timers.current.forEach(clearTimeout);timers.current=[];stop()},[scope,active]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);stop()},[]);
  return <><div className="combo-pop-layer" aria-hidden="true">{pops.map(p=><div key={p.id} className={'combo-pop'+(p.up?' bonus-up':'')} style={{left:p.x,top:p.y}}><strong>{p.combo}<em> COMBO</em></strong>{p.bonus>0&&<span>{p.up?'콤보 보너스! ':''}+{p.bonus}%</span>}</div>)}</div></>;
}
