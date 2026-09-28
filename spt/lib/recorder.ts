import type {DeviceOutbox} from './outbox';
export type RecordStatus={recording:boolean;phase:'idle'|'preparing'|'recording'|'paused'|'stopping'|'ended'|'interrupted';pending:number;seconds:number;level:number;transcribing:boolean;message:string};
export const idleRecording:RecordStatus={recording:false,phase:'idle',pending:0,seconds:0,level:0,transcribing:false,message:''};
export type StopResult={safe:boolean;message:string};
type Callbacks={status:(s:RecordStatus)=>void;partial:(s:string)=>void;entry:(text:string,captureId:string,kind?:string)=>Promise<void>|void};
export class ClassRecorder{
 private context:AudioContext|null=null;private stream:MediaStream|null=null;private worklet:AudioWorkletNode|null=null;private socket:WebSocket|null=null;private running=false;private timer:ReturnType<typeof setInterval>|null=null;private frames:Uint8Array[]=[];private size=0;private seq=0;private samples=0;private writes:Promise<void>=Promise.resolve();private stopping:Promise<StopResult>|null=null;private partial='';private lastFrame=0;private lastConnect=0;private connecting=false;private disconnectedAt=0;private token:()=>Promise<string|null>=async()=>null;private acks=new Map<string,()=>void>();private state:RecordStatus={...idleRecording};
 private emergencyParts=new Map<number,Uint8Array>();
 get emergency(){if(!this.emergencyParts.size)return null;const parts=[...this.emergencyParts].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),bytes=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of parts){bytes.set(b,offset);offset+=b.length;}return bytes;}
 constructor(public id:string,private callbacks:Callbacks,private outbox:DeviceOutbox){}
 private update(p:Partial<RecordStatus>={}){this.state={...this.state,...p,pending:this.outbox.pending.filter(x=>x.audioSize).length};this.callbacks.status({...this.state});}
 prepare(){this.update({phase:'preparing'});if(!this.context)this.context=new AudioContext();return this.context.resume();}
 async cancelSetup(){this.running=false;if(this.timer)clearInterval(this.timer);this.stream?.getTracks().forEach(t=>t.stop());if(this.context&&this.context.state!=='closed')await this.context.close();this.update({recording:false,phase:'interrupted'});}
 private async notice(message:string){this.update({message});try{await this.callbacks.entry(message,this.id,'recording_notice');}catch{this.update({message:message+' 상태 메모를 기기에 보관하지 못했습니다.'});}}
 async start(token:()=>Promise<string|null>){
  this.token=token;
  if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw new Error('이 Safari에서 녹음을 시작할 수 없습니다. 마이크 권한을 확인해 주세요.');
  if(!this.context)await this.prepare();const context=this.context!;
  try{
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});await context.audioWorklet.addModule('/pcm-worklet.js');
   const source=context.createMediaStreamSource(this.stream);this.worklet=new AudioWorkletNode(context,'spt-pcm');const silent=context.createGain();silent.gain.value=0;
   let first:()=>void=()=>{};const ready=new Promise<void>(resolve=>{first=resolve;});this.running=true;this.lastFrame=Date.now();
   this.worklet.port.onmessage=e=>{if(e.data.ack){this.acks.get(e.data.ack)?.();this.acks.delete(e.data.ack);return;}if(!e.data.pcm)return;const bytes=new Uint8Array(e.data.pcm);this.lastFrame=Date.now();this.samples+=bytes.byteLength/2;this.frames.push(bytes);this.size+=bytes.byteLength;first();if(this.state.phase==='preparing')this.update({phase:'recording',recording:true});this.update({level:e.data.level,seconds:this.samples/16000});this.persistFrame(this.size>=64000);
    if(this.socket?.readyState===WebSocket.OPEN&&this.state.transcribing){try{let binary='';for(const b of bytes)binary+=String.fromCharCode(b);this.socket.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:btoa(binary),sample_rate:16000}));}catch{this.socket.close();}}
   };
   source.connect(this.worklet);this.worklet.connect(silent);silent.connect(context.destination);
   this.stream.getAudioTracks().forEach(track=>{track.onended=()=>{if(this.running){void this.notice('마이크 연결이 끊겨 중단했습니다. 화면을 켠 뒤 같은 대화에서 다시 녹음하세요.');void this.stop(true);}};});
   context.onstatechange=()=>{if(this.running&&context.state!=='running'){void this.notice('화면 잠금 또는 마이크 중단을 감지했습니다. 중단 이후 구간은 녹음되지 않았습니다.');void this.stop(true);}};
   this.timer=setInterval(()=>{if(!this.running)return;void this.outbox.heartbeat().catch(e=>{void this.notice(e.message);void this.stop(true);});if(this.state.phase==='recording'&&Date.now()-this.lastFrame>4000){void this.notice('마이크 입력 처리가 멈췄습니다. 마지막 보관 구간을 확인하고 다시 시작해 주세요.');void this.stop(true);}if(!this.socket&&Date.now()-this.lastConnect>15000&&navigator.onLine)void this.connect();},2000);
   // The microphone is connected before requesting a transcription token.
   void this.connect();let timeout:ReturnType<typeof setTimeout>|undefined;await Promise.race([ready,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('마이크 입력을 확인하지 못했습니다. 권한과 입력 장치를 확인해 주세요.')),6000);})]).finally(()=>clearTimeout(timeout));
  }catch(e){if(this.worklet)await this.stop(true);else await this.cancelSetup();throw e;}
 }
 private persistFrame(closed:boolean){const bytes=new Uint8Array(this.size);let offset=0;for(const f of this.frames){bytes.set(f,offset);offset+=f.length;}const seq=this.seq,seconds=this.samples/16000;if(closed){this.frames=[];this.size=0;this.seq++;}
  this.writes=this.writes.then(async()=>{await this.outbox.audio(this.id,seq,bytes,closed,seconds);if((this.emergencyParts.get(seq)?.byteLength||0)<=bytes.byteLength)this.emergencyParts.delete(seq);}).catch(e=>{this.emergencyParts.set(seq,bytes);this.update({message:'아이폰 임시 보관에 실패했습니다. 녹음을 중단합니다. 마지막 음성을 내려받아 보관해 주세요. '+(e instanceof Error?e.message:'')});void this.stop(true);});
 }
 private async command(command:string){if(!this.worklet)return;const ack=crypto.randomUUID();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{this.acks.delete(ack);reject(new Error('마이크 중지 응답을 확인하지 못했습니다. 이 녹음의 원음을 확인해 주세요.'));},1200);this.acks.set(ack,()=>{clearTimeout(timer);resolve();});this.worklet!.port.postMessage({command,ack});});}
 async pause(){if(this.state.phase!=='recording')return;await this.command('pause');await this.writes;this.update({phase:'paused',recording:false,level:0});this.commit();await this.notice('교사가 잠깐 멈췄습니다. 재개 전까지의 대화는 이 녹음에 포함하지 않습니다.');}
 async resume(){if(this.state.phase!=='paused'||!this.running)return;if(this.context?.state!=='running')throw new Error('마이크가 중단되었습니다. 이 대화에서 새 녹음 구간을 시작해 주세요.');await this.outbox.heartbeat();await this.command('resume');this.lastFrame=Date.now();this.update({phase:'recording',recording:true,message:''});await this.notice('같은 대화를 재개했습니다.');}
 private async connect(){if(this.connecting||!this.running||this.stopping)return;this.connecting=true;this.lastConnect=Date.now();try{const token=await this.token();if(!this.running||this.stopping)return;if(!token){this.update({message:'음성 보관 중 · 실시간 전사 미연결'});return;}
   const url=new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');for(const [k,v]of Object.entries({model_id:'scribe_v2_realtime',token,audio_format:'pcm_16000',language_code:'ko',commit_strategy:'vad',no_verbatim:'false'}))url.searchParams.set(k,v);
   const socket=new WebSocket(url);this.socket=socket;const timer=setTimeout(()=>{if(!this.state.transcribing)socket.close();},12000);
   socket.onmessage=e=>{let p;try{p=JSON.parse(e.data)}catch{return;}if(p.message_type==='session_started'){clearTimeout(timer);if(!this.running)return;this.update({transcribing:true,message:''});if(this.samples>0)void this.notice(`실시간 전사 연결 전 ${this.disconnectedAt?'중단':'시작'} 구간은 원음으로 확인해 주세요. 전사는 연결된 시점부터 이어집니다.`);this.disconnectedAt=0;}else if(p.message_type==='partial_transcript'){this.partial=p.text||'';this.callbacks.partial(this.partial);}else if(p.message_type==='committed_transcript'){if(p.text)void Promise.resolve(this.callbacks.entry(p.text,this.id)).catch(()=>this.update({message:'전사문을 임시 보관하지 못했습니다. 원음과 저장 공간을 확인해 주세요.'}));this.partial='';this.callbacks.partial('');}else if(p.error||/error|exceeded|rate_limited|throttled/.test(p.message_type||'')){void this.notice('전사 연결 중단 · '+String(p.message_type).slice(0,80));socket.close();}};
   socket.onerror=()=>socket.close();socket.onclose=()=>{clearTimeout(timer);if(this.socket===socket)this.socket=null;this.update({transcribing:false});if(this.running&&!this.stopping){this.disconnectedAt=Date.now();void this.notice('전사 연결이 끊겼습니다. 음성은 계속 임시 보관하며 연결되면 전송합니다. 전사 누락 구간은 원음 확인이 필요합니다.');}};
  }catch{this.update({transcribing:false,message:'전사 미연결 · 음성은 계속 보관합니다.'});}finally{this.connecting=false;}}
 private commit(){if(this.socket?.readyState===WebSocket.OPEN)try{this.socket.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:'',commit:true,sample_rate:16000}));}catch{}}
 async stop(interrupted=false):Promise<StopResult>{
  if(this.stopping)return this.stopping;
  this.stopping=(async()=>{
   this.update({phase:'stopping',recording:false});this.running=false;if(this.timer)clearInterval(this.timer);
   let issue='';try{await this.command('pause');}catch(e){issue=e instanceof Error?e.message:'마이크 중지 확인 실패';}
   this.stream?.getTracks().forEach(t=>t.stop());
   try{if(this.context&&this.context.state!=='closed')await this.context.close();}catch{issue=issue||'마이크 종료 상태를 확인하지 못했습니다.';}
   if(this.worklet)this.worklet.port.onmessage=null;
   await this.writes;
   if(this.emergency)issue=issue||'기기에 보관하지 못한 원음이 있습니다. 마지막 음성을 내려받아 보관해 주세요.';
   if(!this.emergency)try{await this.outbox.finishCapture(this.id,interrupted||!!issue);}catch{issue=issue||'기기에 종료 상태를 보관하지 못했습니다. 저장 공간과 미보관 음성을 확인해 주세요.';}
   this.commit();const socket=this.socket;
   // Tail transcription can arrive later; the original session/capture callback owns it.
   setTimeout(()=>{const tail=this.partial;this.partial='';if(tail)void this.notice('미확정 전사 · '+tail);socket?.close();},1800);
   this.callbacks.partial('');
   this.update({phase:interrupted||issue?'interrupted':'ended',recording:false,transcribing:false,level:0,...(issue?{message:issue}:{})});
   return {safe:!issue,message:issue};
  })();return this.stopping;
 }

 async retryStorage(){
  await this.stop(true);
  for(const [seq,bytes] of [...this.emergencyParts].sort((a,b)=>a[0]-b[0])){await this.outbox.audio(this.id,seq,bytes,true,this.samples/16000);this.emergencyParts.delete(seq);}
  await this.outbox.finishCapture(this.id,true);
  this.stopping=Promise.resolve({safe:true,message:''});
  this.update({phase:'paused',recording:false,message:'중단 구간의 기기 보관을 다시 확인했습니다. 대화를 재개하면 새 녹음 구간으로 이어집니다.'});
 }

 async flush(){await this.writes;await this.outbox.flush();}
 get pending(){return this.outbox.pending.filter(x=>x.audioSize).length;}
 get isRecording(){return this.running;}
}
export function pcmWav(pcm:Uint8Array){const out=new Uint8Array(44+pcm.length),v=new DataView(out.buffer);const put=(o:number,s:string)=>{for(let i=0;i<s.length;i++)out[o+i]=s.charCodeAt(i);};put(0,'RIFF');v.setUint32(4,36+pcm.length,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,pcm.length,true);out.set(pcm,44);return out;}
