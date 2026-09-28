export type DockPosition={side:'left'|'right';ratio:number};
export const normalizedPosition=(p:DockPosition):DockPosition=>({side:p.side==='left'?'left':'right',ratio:Math.max(0,Math.min(1,Number.isFinite(p.ratio)?p.ratio:.65))});
export function movedPosition(p:DockPosition,x:number,y:number,grab:number,width:number,min:number,max:number):DockPosition{
 let side=p.side;if(side==='right'&&x<width/2-16)side='left';if(side==='left'&&x>width/2+16)side='right';
 return normalizedPosition({side,ratio:max<=min?.5:(y-grab-min)/(max-min)});
}
