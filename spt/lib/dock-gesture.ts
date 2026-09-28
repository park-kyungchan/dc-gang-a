export type DockPart='name'|'mic'|'edge';
export type DockGesture={id:number;x:number;y:number;part:DockPart;held:boolean;moved:boolean;early:boolean;samples:{x:number;y:number;t:number}[]};
export const holdDelay=420;
export function moveDockGesture(g:DockGesture,x:number,y:number,t:number){
 if(Math.hypot(x-g.x,y-g.y)>12){g.moved=true;if(!g.held)g.early=true;}
 g.samples.push({x,y,t});g.samples=g.samples.filter(s=>t-s.t<=140);
}
export function finishDockGesture(g:DockGesture,x:number,y:number,t:number){
 const dx=x-g.x,dy=y-g.y,moved=g.moved||Math.hypot(dx,dy)>12;
 const first=g.samples.find(s=>t-s.t<=140),dt=first?Math.max(1,t-first.t):1,vx=first?(x-first.x)/dt:0,vy=first?(y-first.y)/dt:0;
 const flick=!!first&&Math.abs(vx)>.5&&Math.abs(vx)>Math.abs(vy)*1.5&&Math.abs(x-first.x)>35;
 if(g.part!=='edge'&&moved&&(!g.held&&Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5||g.held&&flick))return (g.held?vx:dx)<0?'stow-left':'stow-right';
 if(moved)return g.held?'drag':'none';
 if(g.held)return g.part==='mic'?'end':g.part==='edge'?'none':'choose';
 return 'tap';
}
export const clampDock=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:.5));
