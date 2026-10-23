import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {atomicJson,canonical,contentHash} from './reliability.mjs';
export const RECOVERY_VERSION='v7-p2-recovery-3';
const clone=value=>structuredClone(value),stamp=()=>new Date().toISOString();
export const RECOVERY_POLICY=Object.freeze({maxAttemptsPerUnitStage:4,maxRequestsPerRound:12,maxAnalysisPerRound:12,maxCumulativeRequests:128,maxCumulativeAnalysis:128,maxRounds:32,maxCumulativeWallMs:21600000,concurrency:2});
const safeId=id=>{if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('恢复任务编号无效');return id;};
export function assertLatestResume(store,from,currentTaskId){
 const jobs=store.state.jobs,byId=new Map(jobs.map(j=>[j.id,j]));
 const descends=job=>{const seen=new Set();let id=job.options?.executionResumeFrom||job.options?.documentResumeFrom||job.recovery?.parent?.taskId;while(id&&!seen.has(id)){if(id===from)return true;seen.add(id);const parent=byId.get(id);id=parent?.options?.executionResumeFrom||parent?.options?.documentResumeFrom||parent?.recovery?.parent?.taskId;}return false;};
 const newer=jobs.find(j=>j.id!==from&&j.id!==currentTaskId&&(j.recovery?.checkpointSha256||j.documentAnalysis?.checkpointSha256)&&descends(j));
 if(newer)throw Error('已有更新的恢复检查点，请从最新执行轮次继续，不能从旧祖先分叉重置累计预算');
}
export function validateTaskResume(store,{scenarioId,from,conversationId,rules,files,currentTaskId}){
 const previous=store.state.jobs.find(j=>j.id===from);
 if(!['08','24','21'].includes(scenarioId)||!previous||previous.scenarioId!==scenarioId||previous.conversationId!==conversationId||['queued','running'].includes(previous.status))throw Error('恢复任务不属于当前对话同一场景的已结束执行');
 if((previous.rules||'')!==(rules||'')||canonical(previous.dataScope.map(f=>({id:f.id,sha256:f.sha256})))!==canonical(files.map(f=>({id:f.id,sha256:f.sha256}))))throw Error('恢复材料、顺序或规则已改变；请重新开始');
 safeId(from);assertLatestResume(store,from,currentTaskId);return previous;
}
export function readRecovery(store,previous){
 if(!previous?.recovery?.checkpointSha256)return null;
 const file=path.join(store.directory,'task-recovery',safeId(previous.id),'checkpoint.json'),bytes=fs.readFileSync(file);
 if(contentHash(bytes)!==previous.recovery.checkpointSha256)throw Error('任务恢复检查点哈希不一致');
 const state=JSON.parse(bytes);
 if(!['v7-p2-recovery-1','v7-p2-recovery-2',RECOVERY_VERSION].includes(state.version)||state.taskId!==previous.id||!Array.isArray(state.units)||!state.identity||!state.payload)throw Error('任务恢复检查点结构不完整');
 return state;
}
export class RecoverySession{
 constructor({store,job,units,phases=['extract','audit'],identity,previous,adopted={},payload={},policy={},blockedUnitIds=[]}){
  this.store=store;this.job=job;this.policy={...RECOVERY_POLICY,roundTimeMs:job.scenarioId==='21'?600000:900000,requestWindowMs:180000,deliveryReserveMs:15000,...policy};this.started=Number.isFinite(Date.parse(job.startedAt))?Date.parse(job.startedAt):Date.now();this.currentAnalysis=0;this.currentRequests=0;this.phases=phases;this.identity=identity;this.payload=payload;
  this.root=path.join(store.directory,'task-recovery',safeId(job.id));this.runId=job.reliability?.runId||randomUUID();
  const old=previous?readRecovery(store,previous):null;
  if(old&&(old.identity.scopeHash!==identity.scopeHash||old.identity.unitsHash!==identity.unitsHash))throw Error('恢复检查点原文或任务范围已改变');
  this.parent=previous?{taskId:previous.id,checkpointSha256:previous.recovery?.checkpointSha256||adopted.checkpointSha256||null}:null;
  this.rootTaskId=old?.rootTaskId||previous?.id||job.id;
  this.priorRequests=old?.counters.cumulativeRequests??adopted.providerRequests??0;
  this.priorAnalysis=old?.counters.cumulativeAnalysis??adopted.analysisCalls??0;
  this.priorWallMs=(old?.counters.cumulativeWallMs??adopted.wallMs??0);
  if(previous){let cursor=previous,wall=0;const seen=new Set();while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);const duration=Date.parse(cursor.finishedAt)-Date.parse(cursor.startedAt);if(Number.isFinite(duration)&&duration>=0)wall+=duration;const id=cursor.options?.executionResumeFrom||cursor.options?.documentResumeFrom||cursor.recovery?.parent?.taskId;cursor=store.state.jobs.find(j=>j.id===id);}this.priorWallMs=Math.max(this.priorWallMs,wall);}
  this.round=(old?.round??(previous?adopted.rounds||1:0))+1;
  this.lineage=old?[...old.lineage,{taskId:previous.id,checkpointSha256:this.parent.checkpointSha256}]:previous?[{taskId:previous.id,checkpointSha256:this.parent.checkpointSha256,legacy:true}]:[];
  this.invalidations=[];
  const oldRows=new Map((old?.units||[]).map(u=>[u.sourceUnitId,u])),blocked=new Set(blockedUnitIds);
  this.units=units.map(unit=>{
   const prior=oldRows.get(unit.id),inputHash=contentHash(unit),stages={};
   if(prior&&prior.inputHash!==inputHash)throw Error('恢复片段内容哈希不一致');
   for(const phase of phases){
    const changed=old&&(old.identity.modelConfigFingerprint!==identity.modelConfigFingerprint||old.identity.promptVersions?.[phase]!==identity.promptVersions?.[phase]||phase==='audit'&&old.identity.promptVersions?.extract!==identity.promptVersions?.extract);
    let stage=prior?.stages?.[phase];
    if(stage&&changed){this.invalidations.push({unitId:unit.id,phase,reason:'stage prompt or model configuration changed',previousStatus:stage.status});stage=null;}
    const done=(adopted.dispositions||[]).some(d=>d.unitId===unit.id&&(d.pass||'extract')===phase);
    const attempts=(adopted.receipts||[]).filter(r=>(r.pass||'extract')===phase&&(r.focusIds||r.unitIds||[]).includes(unit.id)&&!r.cached).length;
    stages[phase]=stage?clone(stage):{status:blocked.has(unit.id)?'blocked':done?'done':'pending',attemptCount:changed?0:attempts,lastError:blocked.has(unit.id)?{code:'OCR_NOT_VERIFIED',message:'OCR草稿未经原图核对'}:null,lastRunId:previous?.id||null,candidateIds:[],verificationIds:[]};
    if(stages[phase].status==='running'){stages[phase].status='needs_recovery';stages[phase].lastError={code:'PROCESS_INTERRUPTED',message:'上轮进程中断，未补造成功'};}
    if(stages[phase].status!=='done'&&stages[phase].status!=='blocked'&&stages[phase].attemptCount>=this.policy.maxAttemptsPerUnitStage)stages[phase].status='failed';
   }
   return {sourceUnitId:unit.id,inputHash,promptVersion:identity.promptVersions,modelConfigFingerprint:identity.modelConfigFingerprint,status:'pending',attemptCount:0,lastError:null,lastRunId:previous?.id||null,candidateIds:prior?.candidateIds||[],verificationIds:prior?.verificationIds||[],stages,updatedAt:stamp()};
  });
  this.byId=new Map(this.units.map(u=>[u.sourceUnitId,u]));this.save();
 }
 remaining(phase){return this.units.filter(u=>['pending','needs_recovery'].includes(u.stages[phase].status)&&u.stages[phase].attemptCount<this.policy.maxAttemptsPerUnitStage).map(u=>u.sourceUnitId);}
 canStart(){return this.policy.roundTimeMs-(Date.now()-this.started)>=this.policy.requestWindowMs+this.policy.deliveryReserveMs&&this.round<=this.policy.maxRounds&&this.currentAnalysis<this.policy.maxAnalysisPerRound&&this.currentRequests<this.policy.maxRequestsPerRound&&this.priorAnalysis+this.currentAnalysis<this.policy.maxCumulativeAnalysis&&this.priorRequests+this.currentRequests<this.policy.maxCumulativeRequests&&this.priorWallMs+Date.now()-this.started<this.policy.maxCumulativeWallMs;}
 begin(phase,ids){
  if(!this.canStart())return false;
  this.currentAnalysis++;for(const id of ids){const unit=this.byId.get(id),stage=unit.stages[phase];if(!['pending','needs_recovery'].includes(stage.status)||stage.attemptCount>=this.policy.maxAttemptsPerUnitStage)throw Error('不能重复提交已处置或已阻断目标');stage.status='running';stage.attemptCount++;stage.lastRunId=this.runId;stage.updatedAt=stamp();unit.lastRunId=this.runId;unit.updatedAt=stamp();}
  this.event('batch_started',{phase,unitIds:ids});this.save();return true;
 }
 reserveProvider(){
  if(this.currentRequests>=this.policy.maxRequestsPerRound||this.priorRequests+this.currentRequests>=this.policy.maxCumulativeRequests)throw Object.assign(Error('累计或本轮真实请求预算耗尽'),{code:'PROVIDER_BUDGET'});
  this.currentRequests++;this.event('provider_request_reserved',{roundRequest:this.currentRequests,cumulativeRequest:this.priorRequests+this.currentRequests});this.save();
 }
 finish(phase,ids,handled,{error=null,candidates=[]}={}){
  const done=new Set(handled);
  for(const id of ids){const unit=this.byId.get(id),stage=unit.stages[phase];stage.status=done.has(id)?'done':stage.attemptCount>=this.policy.maxAttemptsPerUnitStage?'failed':'needs_recovery';stage.lastError=done.has(id)?null:{code:error?.code||(error?'MODEL_FAILURE':'MISSING_DISPOSITION'),message:String(error?.message||'成功返回但没有有效目标处置').slice(0,800)};stage.candidateIds=[...new Set([...stage.candidateIds,...candidates.filter(c=>[...(c.basis||[]),...(c.evidence||[])].some(r=>r.unitId===id)).map(c=>c.id||c.key)])];stage.updatedAt=stamp();unit.lastRunId=this.runId;unit.candidateIds=[...new Set([...unit.candidateIds,...stage.candidateIds])];unit.updatedAt=stamp();}
  this.event('batch_finished',{phase,unitIds:ids,handledIds:[...done],error:error?{code:error.code||'MODEL_FAILURE',message:String(error.message).slice(0,800)}:null});this.save();
 }
 event(type,value){fs.mkdirSync(this.root,{recursive:true});fs.appendFileSync(path.join(this.root,'events.jsonl'),JSON.stringify({at:stamp(),taskId:this.job.id,runId:this.runId,type,...value})+'\n');}
 save(){
  const counts=Object.fromEntries(this.phases.map(p=>[p,this.units.filter(u=>u.stages[p].status==='done').length]));
  for(const unit of this.units){const stages=Object.values(unit.stages);unit.status=stages.every(s=>s.status==='done')?(this.phases.includes('audit')?'reviewed':'extracted'):stages.some(s=>s.status==='running')?'running':stages.some(s=>s.status==='blocked')?'blocked':stages.some(s=>s.status==='failed')?'failed':unit.stages.extract?.status==='done'?'extracted':stages.some(s=>s.status==='needs_recovery')?'needs_recovery':'pending';unit.attemptCount=stages.reduce((n,s)=>n+s.attemptCount,0);unit.lastError=stages.filter(s=>s.lastError).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0]?.lastError||null;unit.lastRunId=unit.lastRunId||stages.find(s=>s.lastRunId)?.lastRunId||null;}
  const counters={roundAnalysis:this.currentAnalysis,roundRequests:this.currentRequests,cumulativeAnalysis:this.priorAnalysis+this.currentAnalysis,cumulativeRequests:this.priorRequests+this.currentRequests,cumulativeWallMs:this.priorWallMs+Date.now()-this.started};
  const remaining=Object.fromEntries(this.phases.map(p=>[p,this.units.filter(u=>u.stages[p].status!=='done').map(u=>u.sourceUnitId)]));
  const done=Object.values(remaining).every(ids=>!ids.length),eligible=this.phases.some(p=>this.remaining(p).length),cumulative=counters.cumulativeRequests>=this.policy.maxCumulativeRequests||counters.cumulativeAnalysis>=this.policy.maxCumulativeAnalysis||this.round>this.policy.maxRounds||counters.cumulativeWallMs>=this.policy.maxCumulativeWallMs;
  const running=this.units.some(u=>Object.values(u.stages).some(s=>s.status==='running'));
  const remainingWindowMs=Math.max(0,this.policy.roundTimeMs-(Date.now()-this.started));
  const stopReason=done?'source_disposition_complete':running?'running':cumulative?'cumulative_budget_exhausted':!eligible?'blocked_or_attempts_exhausted':remainingWindowMs<this.policy.requestWindowMs+this.policy.deliveryReserveMs?'window_reserved_for_delivery':this.currentAnalysis>=this.policy.maxAnalysisPerRound||this.currentRequests>=this.policy.maxRequestsPerRound?'round_budget_exhausted':'remaining_targets';
  const state={version:RECOVERY_VERSION,taskId:this.job.id,rootTaskId:this.rootTaskId,parent:this.parent,lineage:this.lineage,round:this.round,identity:this.identity,policy:this.policy,units:this.units,counters,counts,remaining,remainingWindowMs,stopReason,invalidations:this.invalidations,payload:this.payload,at:stamp()};
  const file=path.join(this.root,'checkpoint.json');atomicJson(file,state);
  this.job.recovery={version:RECOVERY_VERSION,rootTaskId:this.rootTaskId,parent:this.parent,round:this.round,checkpointSha256:contentHash(fs.readFileSync(file)),totalUnits:this.units.length,counts,remainingCounts:Object.fromEntries(Object.entries(remaining).map(([p,ids])=>[p,ids.length])),blocked:this.units.filter(u=>Object.values(u.stages).some(s=>s.status==='blocked')).length,failed:this.units.filter(u=>Object.values(u.stages).some(s=>s.status==='failed')).length,counters,policy:this.policy,stopReason,canResume:!done&&!cumulative&&eligible,limit:'处置和独立会话复核不等于语义正确；预算跨轮累计，旧输出不覆盖。'};
  this.store.save();return state;
 }
}
