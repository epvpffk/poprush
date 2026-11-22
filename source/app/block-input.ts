export type BlockPointer={pointerType:string;button:number;isPrimary:boolean};
export function acceptsBlockPointer(event:BlockPointer){
  // Every touch contact is a new tap, including a second finger while the first is held.
  return event.pointerType==='touch'||(event.button===0&&event.isPrimary);
}
export function acceptsKeyboardClick(detail:number,index:number,last:{index:number;time:number}|null,now:number){
  // Some mobile browsers deliver a compatibility click with detail=0 after pointerdown.
  return detail===0&&!(last?.index===index&&now-last.time<750);
}

export function blockIndexAtPoint(x:number,y:number,first:{left:number;top:number;width:number;height:number},last:{left:number;top:number}){
 const stepX=(last.left-first.left)/9,stepY=(last.top-first.top)/9;
 if(stepX<=0||stepY<=0||x<first.left-6||y<first.top-6||x>last.left+first.width+6||y>last.top+first.height+6)return -1;
 const col=Math.max(0,Math.min(9,Math.round((x-first.left-first.width/2)/stepX))),row=Math.max(0,Math.min(9,Math.round((y-first.top-first.height/2)/stepY)));
 return row*10+col;
}
