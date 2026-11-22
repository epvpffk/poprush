import {performance} from 'node:perf_hooks';
const replyTimings=new WeakMap();
export function rememberResponseTiming(data,timing){if(data&&typeof data==='object')replyTimings.set(data,timing)}
export function updateClientState(client,data){
 if(data.room)client.room=data.room;
 const timing=replyTimings.get(data);
 if(timing){client.recentRtts=[...(client.recentRtts||[]),timing.roundTripMs].slice(-16)}
 if(Number.isFinite(data.serverNow)){
  const receivedAt=timing?.receivedAt??performance.now();
  client.serverClock={serverNow:data.serverNow,receivedAt,roundTripMs:timing?.roundTripMs??0};
  client.offset=data.serverNow-(timing?.receivedEpoch??Date.now());
 }
}
// serverNow was generated before receipt. Include a full observed round trip
// in the upper clock bound and another recent RTT as a dispatch budget.
// This avoids issuing known late moves without changing failure accounting.
export function moveWindow(client,now=performance.now()){
 const r=client.room,clock=client.serverClock;
 if(r?.status!=='playing')return {allowed:false,reason:'not-playing'};
 if(!clock||!Number.isFinite(r.startAt)||!Number.isFinite(r.endAt)||r.endAt<=r.startAt)return {allowed:false,reason:'missing-clock-or-deadline'};
 const lower=clock.serverNow+Math.max(0,now-clock.receivedAt);
 const upper=lower+Math.max(0,clock.roundTripMs);
 const arrivalBudgetMs=Math.max(0,...(client.recentRtts||[]))+250;
 return {allowed:lower>=r.startAt&&upper+arrivalBudgetMs<r.endAt,reason:lower<r.startAt?'not-started':upper+arrivalBudgetMs>=r.endAt?'near-deadline':'playing',serverLowerMs:lower,serverUpperMs:upper,roomEndAt:r.endAt,arrivalBudgetMs};
}
