export function isTouchDevice(){return navigator.maxTouchPoints>0||!!window.matchMedia?.('(pointer:coarse)').matches}
const pendingLeaveKey='poprush-pending-leaves';
function pendingLeaves():string[]{try{const value=JSON.parse(sessionStorage.getItem(pendingLeaveKey)||'[]');return Array.isArray(value)?value.filter((code:unknown)=>typeof code==='string'&&/^[A-F0-9]{8}$/.test(code)):[]}catch{return[]}}
function storeLeaves(codes:string[]){try{sessionStorage.setItem(pendingLeaveKey,JSON.stringify(codes.slice(-16)))}catch{}}
export function retryPendingRoomLeaves(){for(const code of pendingLeaves())sendRoomLeave(code)}
export function sendRoomLeave(code:string){
 if(!/^[A-F0-9]{8}$/.test(code))return;
 storeLeaves([...new Set([...pendingLeaves(),code])]);
 const body=JSON.stringify({action:'leave',code});
 // Beacon can be accepted for queuing and still fail during mobile suspension.
 // Keep the intent until an acknowledged keepalive request or a later retry.
 try{navigator.sendBeacon('/api/arena',new Blob([body],{type:'application/json'}))}catch{}
 try{void fetch('/api/arena',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body,keepalive:true}).then(response=>{if(response.ok)storeLeaves(pendingLeaves().filter(value=>value!==code))}).catch(()=>{})}catch{}
}
export function syncDialog(dialog:HTMLDialogElement,open:boolean){
 if(open&&!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.classList.add('dialog-fallback')}}
 else if(!open&&dialog.open){if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');dialog.classList.remove('dialog-fallback')}}
}
export function watchGameFocus(onExit:()=>void){
 let timer:ReturnType<typeof setTimeout>|null=null,exited=false;
 const cancel=()=>{if(timer!==null){clearTimeout(timer);timer=null}};
 const finish=()=>{if(exited)return;exited=true;cancel();onExit()};
 const hidden=()=>{if(document.hidden||document.visibilityState==='hidden')finish()};
 const blur=()=>{cancel();if(isTouchDevice()){finish();return}timer=setTimeout(()=>{timer=null;if(typeof document.hasFocus!=='function'||!document.hasFocus())finish()},150)};
 window.addEventListener('pagehide',finish);window.addEventListener('blur',blur);window.addEventListener('focus',cancel);document.addEventListener('visibilitychange',hidden);document.addEventListener('freeze',finish);
 hidden();
 return()=>{cancel();window.removeEventListener('pagehide',finish);window.removeEventListener('blur',blur);window.removeEventListener('focus',cancel);document.removeEventListener('visibilitychange',hidden);document.removeEventListener('freeze',finish)};
}
