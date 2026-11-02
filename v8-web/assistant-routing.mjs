import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {digest} from '../v8-tools/resource-space.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export class AssistantRouting{
 constructor(w){this.w=w;}
 configure(c,t,profile,queued){
  const stage=queued?.assistantRoute;
  if(stage){const r=c.assistantRoutes?.find(r=>r.id===stage.id);if(!r||r.state==='cancelled'||Date.now()>Date.parse(r.expiresAt))throw Error('ASSISTANT_ROUTE_EXPIRED_OR_CANCELLED');
   const used=c.turns.filter(x=>x.id===r.sourceTurnId||x.assistantRoute?.id===r.id).reduce((n,x)=>n+(x.metrics?.modelRequests||0),0),left=24-used-(stage.phase==='work'?4:0);if(left<1)throw Error('ASSISTANT_ROUTE_BUDGET_EXHAUSTED');
   t.assistantRoute=stage;profile.assistantRouting={phase:stage.phase,routeId:r.id};profile.maxRounds=Math.min(stage.phase==='work'?12:4,left);profile.chat={...profile.chat,maxAttempts:1};profile.timeoutMs=Math.max(1,Date.parse(r.expiresAt)-Date.now());
   const selected=stage.phase==='verify'?[...r.refs,...(r.workerResult?[r.workerResult]:[])]:r.refs;for(const ref of selected)this.w.space.check(c.workspaceId,ref);
   const state=this.w.space.load(),allowed=new Set(),visit=ref=>{if(allowed.has(ref.resourceId))return;allowed.add(ref.resourceId);for(const parent of this.w.space.check(c.workspaceId,ref,new Set(),state).parents||[])visit(parent);};selected.forEach(visit);
   profile.continuity.selectedInputs=stage.phase==='work'?r.refs:[];profile.continuity.selectedResult=stage.phase==='verify'?r.workerResult||null:null;profile.continuity.excludedInputs=[...(profile.continuity.excludedInputs||[]),...Object.entries(state.resources).filter(([id])=>!allowed.has(id)).flatMap(([resourceId,v])=>Object.keys(v.revisions).map(revisionId=>({resourceId,revisionId})))];
   delete profile.folderConnections;delete profile.scheduleDirectory;profile.knowledgeDirectory=path.join(profile.directory,'empty-handoff-knowledge');profile.interactionContext={assistantHandoff:{phase:stage.phase,originalRequest:r.request,reason:r.reason,reviewFocus:r.reviewFocus,workerReceipt:stage.phase==='verify'?r.workerReceipt:null},instruction:stage.phase==='verify'?'只核对交付回执、原文依据、范围和明显数字错误；保留分歧，不能以两个助理一致证明正确。禁止改写或生成成果文件。':'你负责完成原用户目标，使用限定材料和实际工具交付；不要再次转交。'};return;
  }
  if(profile.inlineMaterial||this.w.config.assistantRouting?.enabled===false||c.kind==='group'||c.proactiveKey||t.contractReview||profile.contractReview?.temporaryGrant||profile.continuity.mode)return;
  const bots=this.w.bots.list().bots.filter(b=>b.enabled&&b.id!==t.botSnapshot.id).map(b=>({id:b.id,name:b.name,description:b.description}));if(bots.length)profile.assistantRouting={phase:'offer',sourceBotId:t.botSnapshot.id,bots};
 }
 afterSettle(c,t){
  const stage=t.assistantRoute;if(stage?.phase==='handoff')return;
  if(stage){const r=c.assistantRoutes?.find(r=>r.id===stage.id);if(!r||r.state==='cancelled')return;
   if(stage.phase==='verify'){r.state=['answered','completed'].includes(t.status)?'reviewed':'review_incomplete';r.reviewTurnId=t.id;r.contentVerified=false;this.w.save();return;}
   if(r.reviewTurnId||r.reviewQueued)return;
   if(!['completed','answered','partial'].includes(t.status)||!t.artifacts?.length&&!t.answer){r.state='worker_failed';this.w.save();return;}
   r.workerResult=t.resultRef||null;r.workerReceipt={turnId:t.id,status:t.status,answer:t.answer.slice(0,8000),artifacts:t.artifacts.map(a=>({id:a.artifactId,sha256:a.sha256})),unmetRequirements:t.unmetRequirements||[]};r.reviewQueued=true;r.state='review_queued';this.enqueue(c,r,r.sourceBotId,'verify','请核对协作助理刚才的结果，重点：'+r.reviewFocus+'。只回答核对意见，不生成或修改文件。');return;
  }
  if(t.termination?.reason!=='assistant_handoff_requested')return;
  if(c.assistantRoutes?.some(r=>r.sourceTurnId===t.id))return;
  const p=path.join(t.directory,'assistant-handoff.json');if(!fs.existsSync(p))return;const a=read(p);
  if(a.sourceTurnId!==t.id||a.sourceBotId!==t.botSnapshot.id||a.requestHash!==digest(t.request)||a.projectId!==c.workspaceId||a.targetBotId===a.sourceBotId)throw Error('INVALID_HANDOFF_RECEIPT');this.w.bots.get(a.targetBotId);for(const ref of a.refs)this.w.space.check(c.workspaceId,ref);
  const r={...a,request:t.request,state:'worker_queued',expiresAt:new Date(Date.parse(t.createdAt)+600000).toISOString()};(c.assistantRoutes??=[]).push(r);c.collaboratorIds=[...new Set([...(c.collaboratorIds||[]),a.sourceBotId,a.targetBotId])];t.status='answered';t.answer='已将任务交给'+this.w.bots.get(a.targetBotId).name+'处理；我将辅助核对。转交原因：'+a.reason;t.assistantRoute={id:r.id,phase:'handoff'};this.enqueue(c,r,a.targetBotId,'work',r.request);if(r.state==='blocked'){t.status='partial';t.answer='转交尚未启动：'+r.blockReason+'。已有材料保留。';this.w.save();}
 }
 enqueue(c,r,botId,phase,message){if(this.w.flow.pending().length>=100||Date.now()>Date.parse(r.expiresAt)){r.state='blocked';r.blockReason='队列或协作时间预算不足';this.w.save();return;}
  const bot=this.w.bots.get(botId),t={id:randomUUID(),request:message,status:'queued',createdAt:new Date().toISOString(),recipientBotId:botId,botSnapshot:{id:botId,name:bot.name},assistantRoute:{id:r.id,phase},body:{message,fileIds:[],useConversationFiles:false,recipientBotId:botId}};(c.pending??=[]).push(t);this.w.save();}
}
