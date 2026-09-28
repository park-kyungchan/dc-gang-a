export type CardSwipe={id:number;x:number;y:number;base:number;width:number;revision:string;axis:'pending'|'horizontal'|'vertical';dx:number;dy:number};
export const deleteDistance=(width:number)=>Math.min(170,Math.max(1,width)*.62);
export function moveCardSwipe(d:CardSwipe,x:number,y:number){
 d.dx=x-d.x;d.dy=y-d.y;
 if(d.axis==='pending'&&Math.max(Math.abs(d.dx),Math.abs(d.dy))>10)d.axis=Math.abs(d.dx)>Math.abs(d.dy)*1.4?'horizontal':'vertical';
 return {offset:d.axis==='horizontal'?Math.max(0,Math.min(d.width,d.base-d.dx)):d.base,armed:d.axis==='horizontal'&&-d.dx>=deleteDistance(d.width)&&Math.abs(d.dx)>Math.abs(d.dy)*1.4};
}
export function endCardSwipe(d:CardSwipe,x:number,y:number,revision:string,disabled:boolean){
 const moved=moveCardSwipe(d,x,y);
 return {remove:!disabled&&revision===d.revision&&moved.armed,open:d.axis==='horizontal'?d.base-d.dx>40:d.base>0,suppress:Math.abs(d.dx)>10||Math.abs(d.dy)>10};
}
