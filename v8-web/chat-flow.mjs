import {randomUUID} from 'node:crypto';
import {MAX_MESSAGE_CHARS} from '../v8-tools/inline-material.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export class ChatFlow{
 constructor(workspace){this.w=workspace;this.pumping=false;}
 pending(){return Object.values(this.w.state.conversations).filter(c=>!c.deleted).flatMap(c=>(c.pending||[]).map(t=>({c,t}))).sort((a,b)=>a.t.createdAt.localeCompare(b.t.createdAt));}
 validate(c,b){const message=String(b.message||'').trim();if(!message||message.length>MAX_MESSAGE_CHARS)fail(400,'请输入1至240000字');if(b.fileIds!==undefined&&(!Array.isArray(b.fileIds)||b.fileIds.some(id=>!c.files.some(f=>f.id===id&&this.w.available(c,f)))))fail(403,'所选材料不可用或不属于本对话');if(b.mode&&!['revise','resume','rebuild_delivery'].includes(b.mode))fail(400,'不支持的执行方式');return message;}
 async submit(id,body){const w=this.w,c=w.conversation(id),message=this.validate(c,body);if(w.activeUploads.get(id))fail(425,'材料仍在上传，正文已保留，请上传完成后发送');if(body.requestId&&(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId)))fail(400,'无效请求ID');const prior=body.requestId&&[...c.turns,...(c.pending||[])].find(t=>t.clientRequestId===body.requestId);if(prior)return prior.status==='queued'?this.view(prior):w.turnView(c,prior);
 if(!w.jobs.size&&!this.pending().length){const turn=await w.start(id,body);const saved=c.turns.find(t=>t.id===turn.id);saved.clientRequestId=body.requestId||null;w.save();return turn;}
 if(this.pending().length>=100)fail(429,'待处理消息已达100条，请先整理队列');
 const fileIds=body.fileIds?.length?body.fileIds:body.mode==='resume'||body.useConversationFiles===false?[]:c.files.filter(f=>w.available(c,f)).map(f=>f.id);
 const t={id:randomUUID(),request:message,status:'queued',createdAt:new Date().toISOString(),clientRequestId:body.requestId||null,body:{message,fileIds,useConversationFiles:false,...(body.mode?{mode:body.mode}:{}),...(body.retryTurnId?{retryTurnId:body.retryTurnId}:{})}};(c.pending??=[]).push(t);w.save();return this.view(t);
 }
 view(t){return {id:t.id,request:t.request,status:'queued',createdAt:t.createdAt,answer:'已加入待处理队列，前面的任务结束后开始。',progress:{toolCalls:0,modelRequests:0,steps:[]},artifacts:[],localFiles:[],canResume:false,canSelect:false};}
 edit(id,turnId,body){const c=this.w.conversation(id),t=(c.pending||[]).find(t=>t.id===turnId);if(!t)fail(409,'消息已开始处理，请刷新后使用修改分支');const message=this.validate(c,{...t.body,message:body.message});(t.revisions??=[]).push({request:t.request,at:new Date().toISOString()});t.request=message;t.body.message=message;this.w.save();return this.view(t);}
 remove(id,turnId){const c=this.w.conversation(id),t=(c.pending||[]).find(t=>t.id===turnId);if(!t)fail(409,'消息已开始处理，请刷新后使用删除分支');(c.queueHistory??=[]).push({...t,status:'deleted',deletedAt:new Date().toISOString()});c.pending=c.pending.filter(t=>t.id!==turnId);this.w.save();return {deleted:true};}
 async pump(){const w=this.w;if(this.pumping||w.jobs.size)return;const next=this.pending()[0];if(!next||w.activeUploads.get(next.c.id))return;this.pumping=true;const {c,t}=next;try{await w.start(c.id,t.body,t.id);c.turns.find(x=>x.id===t.id).clientRequestId=t.clientRequestId;c.pending=c.pending.filter(x=>x.id!==t.id);w.save();}catch(e){c.pending=c.pending.filter(x=>x.id!==t.id);c.turns.push({id:t.id,request:t.request,createdAt:t.createdAt,status:'failed',answer:'待处理消息未能启动：'+e.message,error:e.message,artifacts:[],clientRequestId:t.clientRequestId});w.save();}finally{this.pumping=false;}}
 start(){this.timer=setInterval(()=>this.pump().catch(e=>{this.error=e.message;}),300);this.timer.unref();}
 stop(){clearInterval(this.timer);}
 async fork(id,{turnId,operation='fork',message}={}){
  const w=this.w,c=w.conversation(id),at=c.turns.findIndex(t=>t.id===turnId);if(at<0)fail(404,'分支起点不存在');if(!['fork','edit','delete'].includes(operation))fail(400,'无效分支操作');if(operation==='edit')this.validate(c,{message});
  const end=operation==='fork'?at+1:at,prefix=c.turns.slice(0,end),cutoff=c.turns[at].createdAt,files=c.files.filter(f=>{try{return w.available(c,f)&&w.space.check(c.workspaceId,f.ref).createdAt<=cutoff;}catch{return false;}});
  const child=w.newConversation(c.botId||'general',{branch:{conversationId:id,turnId,operation}}),target=w.conversation(child.id);target.title=(operation==='fork'?'分支 · ':operation==='edit'?'修改 · ':'删除后 · ')+c.title;target.files=structuredClone(files);target.turns=structuredClone(prefix).map(t=>({...t,inherited:true,...(t.status==='running'?{status:'interrupted',answer:'原分支仍在执行，本分支未复制未完成的回答。',artifacts:[],resultRef:null,runId:null}:{} )}));
  const latest=[...target.turns].reverse().find(t=>t.resultRef);if(latest){w.space.read(target.workspaceId,latest.resultRef);const work=w.space.work(target.workspaceId,target.workItemId);w.space.select(target.workspaceId,target.workItemId,latest.resultRef,work.selectionRevision);}w.save();if(operation==='edit')await this.submit(child.id,{message,fileIds:target.files.map(f=>f.id),useConversationFiles:false});return w.view(child.id);
 }
}
