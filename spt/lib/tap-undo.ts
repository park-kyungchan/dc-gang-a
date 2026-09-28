/** One reversible action per form. Only changed fields are restored. */
export type TapUndo<T>={key:string;before:Partial<T>;after:Partial<T>};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function matchesTap<T>(value:T,undo:TapUndo<T>|null,key:string){return !!undo&&undo.key===key&&(Object.keys(undo.after) as (keyof T)[]).every(k=>equal(value[k],undo.after[k]));}
export function tapPatch<T extends object>(value:T,undo:TapUndo<T>|null,key:string,patch:Partial<T>):{patch:Partial<T>;undo:TapUndo<T>|null}{
 if(matchesTap(value,undo,key))return {patch:undo!.before,undo:null};
 const before:Partial<T>={};for(const k of Object.keys(patch) as (keyof T)[])before[k]=value[k];
 return {patch,undo:{key,before,after:patch}};
}
