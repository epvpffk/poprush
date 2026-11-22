import {attachAudio,releaseAudio,playAudio,setMasterVolume,setAudioGain} from './audio-mixer';
import {useEffect,useRef,useState,type CSSProperties} from 'react';

const lobbyTracks=['/music/pixel-peeker-slower.mp3','/music/pixel-peeker-faster.mp3'];
type Settings={enabled:boolean;volume:number;mode:string};
function loadSettings():Settings{
  try{const s=JSON.parse(localStorage.getItem('poprush-music')||'null');if(s)return {enabled:s.enabled!==false,volume:typeof s.volume==='number'&&Number.isFinite(s.volume)?Math.max(0,Math.min(1,s.volume)):.25,mode:['playlist','0','1'].includes(s.mode)?s.mode:'playlist'}}catch{}
  return {enabled:true,volume:.25,mode:'playlist'};
}

export default function MusicPlayer({active,playing=false,urgent=false,restartKey=""}:{active:boolean;playing?:boolean;urgent?:boolean;restartKey?:string}){
  const [settings,setSettings]=useState(loadSettings),[index,setIndex]=useState(0);
  const [voice,setVoice]=useState(()=>{try{return localStorage.getItem('poprush-combo-voice')!=='off'}catch{return true}});
  const [hidden,setHidden]=useState(()=>document.hidden),[status,setStatus]=useState(''),[credits,setCredits]=useState(false);
  const audio=useRef<HTMLAudioElement|null>(null),wantPlay=useRef(false),attempt=useRef(0);
  const urgentAudio=useRef<HTMLAudioElement|null>(null),urgentAttempt=useRef(0);
  const startedRuns=useRef(new Set<string>());
  const shouldPlay=active&&settings.enabled&&!hidden;
  const trackFile=playing?'/music/bit-quest.mp3':lobbyTracks[index];
  wantPlay.current=shouldPlay;
  useEffect(()=>{try{localStorage.setItem('poprush-music',JSON.stringify(settings))}catch{}},[settings]);
  useEffect(()=>{const change=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change)},[]);
  function play(){
    const a=audio.current;if(!a||!wantPlay.current)return;
    const id=++attempt.current;
    void playAudio(a).then(()=>{if(id!==attempt.current||!wantPlay.current)return;setStatus('')}).catch(e=>{
      if(id!==attempt.current||!wantPlay.current||e.name==='AbortError')return;
      setStatus(e.name==='NotAllowedError'?'▶ 눌러서 음악 재생':'음악 재생 다시 시도');
    });
  }
  useEffect(()=>{setMasterVolume(settings.volume)},[settings.volume]);
  useEffect(()=>{const a=audio.current;if(!a)return;attachAudio(a);return()=>releaseAudio(a)},[]);
  useEffect(()=>{
    if(!playing||!restartKey||startedRuns.current.has(restartKey))return;
    const a=audio.current;if(!a)return;
    startedRuns.current.add(restartKey);
    attempt.current++;
    a.currentTime=0;
    a.playbackRate=1;
    if(wantPlay.current)play();
  },[restartKey,playing]);

  useEffect(()=>{
    const normal=audio.current,fast=urgentAudio.current;if(!normal||!fast)return;
    attachAudio(fast);setAudioGain(fast,0);
    return()=>{fast.pause();releaseAudio(fast)};
  },[]);
  useEffect(()=>{
    const normal=audio.current,fast=urgentAudio.current;if(!normal||!fast)return;
    const id=++urgentAttempt.current;
    if(!urgent||!playing||!shouldPlay){setAudioGain(normal,1);setAudioGain(fast,0);fast.pause();return}
    const start=()=>{
      if(id!==urgentAttempt.current)return;
      const position=normal.currentTime/1.25;
      if(Number.isFinite(position))fast.currentTime=position;
      void playAudio(fast).then(()=>{
        if(id!==urgentAttempt.current)return;
        setAudioGain(fast,1);setAudioGain(normal,0);
      }).catch(()=>{if(id===urgentAttempt.current)setAudioGain(normal,1)});
    };
    if(fast.readyState>=2)start();else fast.addEventListener('canplay',start,{once:true});
    return()=>{urgentAttempt.current++;fast.removeEventListener('canplay',start)};
  },[urgent,playing,shouldPlay,restartKey]);

  useEffect(()=>{
    setStatus('');const a=audio.current;if(!a)return;
    if(shouldPlay)play();else{attempt.current++;a.pause();if(!active)a.currentTime=0}
  },[shouldPlay,trackFile,active]);
  useEffect(()=>{
    const element=audio.current;
    const resume=()=>{if(wantPlay.current&&audio.current?.paused)play()};
    document.addEventListener('pointerdown',resume,true);document.addEventListener('keydown',resume,true);
    return()=>{document.removeEventListener('pointerdown',resume,true);document.removeEventListener('keydown',resume,true);attempt.current++;element?.pause()};
  },[]);
  function changeVolume(value:string){
    const volume=Math.max(0,Math.min(100,Number(value)||0))/100;
    setSettings(s=>s.volume===volume?s:{...s,volume});
    setMasterVolume(volume);
  }
  return <section className="music-controls" aria-label="배경음악 설정">
    <audio ref={audio} src={trackFile} preload="auto" autoPlay={shouldPlay} loop={playing} onEnded={()=>{if(!playing)setIndex(i=>(i+1)%lobbyTracks.length)}} onError={()=>setStatus('음악을 불러오지 못했습니다. 다시 시도해 주세요.')}/>
    <audio ref={urgentAudio} src={playing?'/music/bit-quest-urgent.mp3':undefined} preload="auto" loop/>
    <button type="button" className="ghost" aria-pressed={settings.enabled} title={status||'배경음악 켜기 / 끄기'} onClick={()=>{const enabled=status?true:!settings.enabled;setSettings(s=>({...s,enabled}));if(enabled&&active&&!hidden){wantPlay.current=true;play()}}}>♪ 음악 {settings.enabled?'켜짐':'꺼짐'}</button>
    <button type="button" className="ghost" aria-pressed={voice} onClick={()=>{const next=!voice;setVoice(next);try{localStorage.setItem('poprush-combo-voice',next?'on':'off')}catch{}window.dispatchEvent(new CustomEvent('poprush-voice-setting',{detail:next}))}}>콤보 소리 {voice?'켜짐':'꺼짐'}</button>
    <label className="music-volume">음량 <input className="volume-slider" aria-label="전체 소리 음량" aria-valuetext={`${Math.round(settings.volume*100)}퍼센트`} type="range" min="0" max="100" step="1" value={Math.round(settings.volume*100)} style={{'--volume':`${Math.round(settings.volume*100)}%`} as CSSProperties} onInput={e=>changeVolume(e.currentTarget.value)} onChange={e=>changeVolume(e.currentTarget.value)}/><span>{Math.round(settings.volume*100)}%</span></label>
    <button type="button" className="ghost" aria-expanded={credits} onClick={()=>setCredits(v=>!v)}>음악 정보</button>
    {credits&&<div className="music-credits">대기실: “Pixel Peeker Polka - slower” · “Pixel Peeker Polka - faster”<br/>게임: “Bit Quest”<br/>Music: Kevin MacLeod (<a href="https://incompetech.com/" target="_blank" rel="noreferrer">incompetech.com</a>)<br/>Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution 4.0</a> · 원본 음원 사용</div>}
  </section>;
}
