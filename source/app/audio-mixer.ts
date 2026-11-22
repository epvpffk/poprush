// One output gain controls music and every game/test effect, including on iOS.
let context:AudioContext|null=null,master:GainNode|null=null;
let level=readVolume();
const sources=new WeakMap<HTMLMediaElement,{node:MediaElementAudioSourceNode;connected:boolean;gain:GainNode}>();
const elements=new Set<HTMLMediaElement>(),fallback=new Set<HTMLMediaElement>();
function readVolume(){try{const value=JSON.parse(localStorage.getItem('poprush-music')||'{}').volume;return typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):.25}catch{return .25}}
function init(){
 if(context)return context;
 const Constructor=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
 if(!Constructor)return null;
 const ctx=new Constructor(),gain=ctx.createGain();gain.gain.setValueAtTime(level,ctx.currentTime);gain.connect(ctx.destination);context=ctx;master=gain;
 return ctx;
}
export function attachAudio(element:HTMLMediaElement){
 elements.add(element);
 try{
  const ctx=init();if(!ctx||!master)throw new Error('Web Audio unavailable');
  let entry=sources.get(element);if(!entry){entry={node:ctx.createMediaElementSource(element),connected:false,gain:ctx.createGain()};sources.set(element,entry)}
  if(!entry.connected){entry.node.connect(entry.gain);entry.gain.connect(master);entry.connected=true}
  element.volume=1;element.muted=false;fallback.delete(element);
 }catch{fallback.add(element);try{element.volume=level;element.muted=level===0}catch{}}
}
export function releaseAudio(element:HTMLMediaElement){
 const entry=sources.get(element);if(entry?.connected){entry.node.disconnect();entry.gain.disconnect();entry.connected=false}
 elements.delete(element);fallback.delete(element);
}
export function setMasterVolume(value:number){
 level=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.25;
 if(master&&context){const at=context.currentTime;master.gain.cancelScheduledValues(at);master.gain.setValueAtTime(master.gain.value,at);master.gain.linearRampToValueAtTime(level,at+.015)}
 for(const element of fallback){try{element.volume=level;element.muted=level===0}catch{}}
}
export function playAudio(element:HTMLMediaElement){
 attachAudio(element);
 if(context&&context.state!=='running')void context.resume().catch(()=>{});
 return element.play();
}
function unlock(){if(context&&context.state!=='running')void context.resume().catch(()=>{})}
if(typeof document!=='undefined'){document.addEventListener('pointerdown',unlock,true);document.addEventListener('keydown',unlock,true);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&[...elements].some(a=>!a.paused))unlock()})}

export function setAudioGain(element:HTMLMediaElement,value:number){attachAudio(element);const entry=sources.get(element);if(entry&&context){entry.gain.gain.cancelScheduledValues(context.currentTime);entry.gain.gain.setTargetAtTime(value,context.currentTime,.025)}else{element.muted=value===0}}
