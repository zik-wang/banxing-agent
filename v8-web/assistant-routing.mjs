import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../v8-tools/resource-space.mjs';
import {applyAdaptivePolicy} from '../v8-tools/execution-policy.mjs';
import {handoffMoney} from '../v8-tools/handoff-money.mjs';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const success = t => ['answered', 'completed'].includes(t.status);
const terminal = new Set(['completed', 'reviewed', 'review_incomplete', 'worker_failed', 'cancelled', 'blocked']);

export class AssistantRouting {
 constructor(w) { this.w = w; }
 colleagues(c, botId, route) {
  const ancestors = new Set([botId]);
  for (let r = route; r; r = c.assistantRoutes?.find(x => x.id === r.parentRouteId)) {
   ancestors.add(r.sourceBotId); ancestors.add(r.targetBotId);
  }
  return this.w.bots.list().bots.filter(b => b.enabled && !ancestors.has(b.id)).map(({id,name,description}) => ({id,name,description}));
 }
 configure(c, t, profile, queued) {
  // Meetings and contract review have separate explicit operator protocols.
  if (!t.meetingId && !t.contractReview && this.w.config.executionPolicy?.mode !== 'bounded') applyAdaptivePolicy(profile);
  const stage = queued?.assistantRoute;
  if (stage) {
   const r = c.assistantRoutes?.find(x => x.id === stage.id);
   if (!r || terminal.has(r.state)) throw Error('ASSISTANT_ROUTE_UNAVAILABLE');
   t.assistantRoute = stage;
   const bots = this.colleagues(c, t.botSnapshot.id, r);
   profile.assistantRouting = {phase:stage.phase,routeId:r.id,sourceBotId:t.botSnapshot.id,bots};
   if (stage.phase === 'verify') profile.botPolicy = {...profile.botPolicy, preferredTools:['read_artifact','table_statistics','read_text_range','search_document']};
   const selected = [...r.refs, ...(stage.phase === 'verify' && r.workerResult ? [r.workerResult] : [])];
   for (const ref of selected) this.w.space.check(c.workspaceId, ref);
   this.w.connections.guard(c, r.refs, stage.phase === 'verify' ? r.workerResult : null, r.request);
   const state = this.w.space.load();
   if (r.refs.some(ref => c.files.some(f => f.ref.resourceId === ref.resourceId && f.removed) || (state.workItems[c.workspaceId+'/'+c.workItemId]?.excluded || []).some(e => e.resourceId === ref.resourceId))) throw Error('HANDOFF_SOURCE_EXCLUDED');
   const allowed = new Set(), visit = ref => {if (allowed.has(ref.resourceId)) return; allowed.add(ref.resourceId); for (const parent of this.w.space.check(c.workspaceId,ref,new Set(),state).parents || []) visit(parent);};
   selected.forEach(visit);
   profile.continuity.selectedInputs = r.refs;
   profile.continuity.selectedResult = stage.phase === 'verify' ? r.workerResult || null : null;
   profile.continuity.excludedInputs = [...(profile.continuity.excludedInputs || []).filter(ref => !allowed.has(ref.resourceId)), ...Object.entries(state.resources).filter(([id]) => !allowed.has(id)).flatMap(([resourceId,v]) => Object.keys(v.revisions).map(revisionId => ({resourceId,revisionId})))];
   delete profile.folderConnections; delete profile.scheduleDirectory;
   profile.knowledgeDirectory = path.join(profile.directory, 'empty-handoff-knowledge');
   let workerReceipt=stage.phase==='verify'?r.workerReceipt:null;
   if(workerReceipt){
    const evidence=handoffMoney(this.w.space,{projectId:c.workspaceId,workItemId:c.workItemId,runId:workerReceipt.runId,turnId:workerReceipt.turnId,request:r.task||r.request,refs:r.refs});
    const saved=workerReceipt.moneyEvidence;
    workerReceipt={...workerReceipt,moneyEvidence:saved&&digest(saved)!==digest(evidence)?{version:1,state:'unverified',issues:['MONEY_EVIDENCE_CHANGED'],receipts:[]}:evidence};
   }
   profile.interactionContext = {assistantHandoff:{phase:stage.phase,originalRequest:r.request,assignedTask:r.task||r.request,reason:r.reason,reviewFocus:r.reviewFocus,workerReceipt},instruction:stage.phase==='verify' ? '依据实际文件、统计和交付回执核对原任务。moneyEvidence仅在source_and_arithmetic_bound时提供宿主绑定的金额回执；unverified不代表核对通过。其摘要域与编码各自标明，不混同比较；算术一致不证明取数完整或业务口径正确。handoffReview是可用证据而非结论；不足时按需调用已授权工具补查，充分时答复。保留分歧，不能以两个助理一致证明正确。只核对，不生成或改写文件。' : '完成分配的任务，使用限定材料和实际工具交付。可直接处理，也可在业务写入前交给更合适且未在本链路主办的同事；按实际需要选择复核。'};
   return;
  }
  if (this.w.config.assistantRouting?.enabled === false || c.kind === 'group' || c.proactiveKey || t.contractReview || profile.contractReview?.temporaryGrant || profile.continuity.mode) return;
  const bots = this.colleagues(c, t.botSnapshot.id);
  if (bots.length) profile.assistantRouting = {phase:'offer',sourceBotId:t.botSnapshot.id,bots};
 }
 afterSettle(c, t) {
  const stage = t.assistantRoute;
  if (stage?.phase === 'handoff') return;
  const route = stage && c.assistantRoutes?.find(x => x.id === stage.id);
  if (route && terminal.has(route.state)) return;
  if (t.termination?.reason === 'assistant_handoff_requested') {
   if (c.assistantRoutes?.some(r => r.sourceTurnId === t.id)) return;
   const file = path.join(t.directory, 'assistant-handoff.json');
   if (!fs.existsSync(file)) return;
   const a = read(file), eligible = this.colleagues(c, t.botSnapshot.id, route);
   const profile = read(path.join(this.w.root,'runs',t.id+'.json'));
   if (a.sourceTurnId !== t.id || a.sourceBotId !== t.botSnapshot.id || a.requestHash !== digest(profile.request) || a.projectId !== c.workspaceId || !eligible.some(b => b.id === a.targetBotId)) throw Error('INVALID_HANDOFF_RECEIPT');
   const reviewer = a.reviewerBotId || a.sourceBotId;
   if (reviewer === a.targetBotId || ![a.sourceBotId,...eligible.map(b=>b.id)].includes(reviewer)) throw Error('INVALID_HANDOFF_REVIEWER');
   this.w.bots.get(a.targetBotId); this.w.bots.get(reviewer);
   // Transfer only references already selected for this turn, including result ancestry.
   const permitted = new Set(), visit = ref => {const key=ref.resourceId+':'+ref.revisionId;if(permitted.has(key))return;permitted.add(key);for(const p of this.w.space.check(c.workspaceId,ref).parents||[])visit(p);};
   const run=t.runId&&this.w.space.load().runs[t.runId];
   const selected=run?.snapshot.selected || [...profile.continuity.selectedInputs,...(profile.continuity.selectedResult?[profile.continuity.selectedResult]:[])];
   selected.forEach(visit);
   for (const ref of a.refs) if (!permitted.has(ref.resourceId+':'+ref.revisionId)) throw Error('HANDOFF_SCOPE_EXPANSION_DENIED');
   const r = {...a,reviewRequired:a.reviewRequired!==false,reviewerBotId:reviewer,request:profile.request,parentRouteId:route?.id||null,state:'worker_queued'};
   (c.assistantRoutes ??= []).push(r);
   if (route) route.state = 'delegated';
   c.collaboratorIds = [...new Set([...(c.collaboratorIds||[]),a.sourceBotId,a.targetBotId,...(r.reviewRequired?[reviewer]:[])])];
   t.status = 'answered'; t.answer = '已将任务交给'+this.w.bots.get(a.targetBotId).name+'处理；'+(r.reviewRequired?'完成后由'+this.w.bots.get(reviewer).name+'核对。':'本次未安排额外助理复核。')+'转交原因：'+a.reason;
   t.assistantRoute = {id:r.id,phase:'handoff'};
   this.enqueue(c,r,a.targetBotId,'work',r.task || r.request);
   if (r.state === 'blocked') {t.status='partial';t.answer='转交尚未启动：'+r.blockReason+'。已有材料保留。';}
   this.w.save(); return;
  }
  if (!route) return;
  if (stage.phase === 'verify') {
   const file = path.join(t.directory,'handoff-review-receipt.json');
   if (fs.existsSync(file)) {const bytes=fs.readFileSync(file);route.reviewEvidence={path:file,sha256:digest(bytes),id:JSON.parse(bytes).id};}
   route.state = success(t) ? 'reviewed' : 'review_incomplete'; route.reviewTurnId=t.id; route.contentVerified=false;
   if (success(t)) this.finishParent(c,route,t); else this.failParents(c,route,'review_incomplete');
   this.w.save(); return;
  }
  if (route.reviewQueued || route.state === 'delegated') return;
  if (!['completed','answered','partial'].includes(t.status) || (!t.artifacts?.length && !t.answer)) {route.state='worker_failed';this.failParents(c,route,'worker_failed');this.w.save();return;}
  route.workerResult=t.resultRef||null;
  route.workerReceipt={turnId:t.id,runId:t.runId||null,status:t.status,answer:t.answer.slice(0,8000),artifacts:(t.artifacts||[]).map(a=>({id:a.artifactId,sha256:a.sha256})),unmetRequirements:t.unmetRequirements||[],moneyEvidence:handoffMoney(this.w.space,{projectId:c.workspaceId,workItemId:c.workItemId,runId:t.runId,turnId:t.id,request:route.task||route.request,refs:route.refs})};
  this.advance(c,route,t); this.w.save();
 }
 advance(c,r,t) {
  if (r.reviewRequired) {r.reviewQueued=true;r.state='review_queued';this.enqueue(c,r,r.reviewerBotId,'verify','请核对协作助理刚才的结果，重点：'+r.reviewFocus+'。只回答核对意见，不生成或修改文件。');}
  else {r.state='completed';r.contentVerified=false;this.finishParent(c,r,t);}
 }
 finishParent(c,r,t) {
  if (!r.parentRouteId) return;
  const parent=c.assistantRoutes.find(x=>x.id===r.parentRouteId);
  if (!parent || parent.state!=='delegated') return;
  parent.workerResult=r.workerResult;
  parent.workerReceipt={...r.workerReceipt,delegatedRouteId:r.id,review:r.reviewTurnId?{turnId:r.reviewTurnId,status:t.status,answer:t.answer.slice(0,8000)}:null};
  this.advance(c,parent,t);
 }
 failParents(c,r,state) {for(let p=c.assistantRoutes.find(x=>x.id===r.parentRouteId);p;p=c.assistantRoutes.find(x=>x.id===p.parentRouteId))if(!terminal.has(p.state))p.state=state;}
 enqueue(c,r,botId,phase,message) {
  if (this.w.flow.pending().length>=100) {r.state='blocked';r.blockReason='待处理队列已满';this.failParents(c,r,'blocked');this.w.save();return;}
  const bot=this.w.bots.get(botId),t={id:randomUUID(),request:message,status:'queued',createdAt:new Date().toISOString(),recipientBotId:botId,botSnapshot:{id:botId,name:bot.name},assistantRoute:{id:r.id,phase},body:{message,fileIds:c.files.filter(f=>!f.removed&&r.refs.some(ref=>ref.resourceId===f.ref.resourceId&&ref.revisionId===f.ref.revisionId)).map(f=>f.id),useConversationFiles:false,recipientBotId:botId}};
  (c.pending??=[]).push(t);this.w.save();
 }
 cancel(c) {
  let count=0;
  for (const r of c.assistantRoutes||[]) if (!terminal.has(r.state)) {r.state='cancelled';count++;}
  c.pending=(c.pending||[]).filter(t=>!t.assistantRoute);
  return count;
 }
}
