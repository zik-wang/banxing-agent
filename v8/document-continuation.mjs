import fs from 'node:fs';
import {assertLatestResume} from './task-recovery.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const ANALYSIS_VERSION='v7-p1-analysis-4';
export const checkpointHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function analysisIdentity(job,files,units,harness){
 const model=harness?.modelStatus?.()||{};
 return {version:ANALYSIS_VERSION,rules:job.rules||'',files:files.map(f=>({id:f.id,sha256:f.sha256})),unitsHash:checkpointHash(JSON.stringify(units)),model:model.modelName||'configured-model',provider:model.provider||'configured-provider',analysisMode:model.analysisMode||'native-tools',batchCharacters:6200};
}
export function validateResumeRequest(store,{scenarioId,from,conversationId,rules,files,currentTaskId}){
 const previous=store.state.jobs.find(j=>j.id===from);
 if(scenarioId!=='21'||!previous||previous.scenarioId!=='21'||previous.conversationId!==conversationId||['running','queued'].includes(previous.status)||!previous.documentAnalysis?.checkpointSha256)throw Error('检查点不属于当前对话的已结束场景21任务');
 if((previous.rules||'')!==(rules||'')||JSON.stringify(previous.dataScope.map(f=>({id:f.id,sha256:f.sha256})))!==JSON.stringify(files.map(f=>({id:f.id,sha256:f.sha256}))))throw Error('检查点的材料、顺序或规则已改变；请重新开始');
 assertLatestResume(store,from,currentTaskId);
 return previous;
}
export function restoreAnalysis(store,job,identity,units){
 const from=job.options?.documentResumeFrom;
 if(!from)return null;
 const previous=validateResumeRequest(store,{scenarioId:job.scenarioId,from,conversationId:job.conversationId,rules:job.rules,files:job.dataScope,currentTaskId:job.id});
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(from))throw Error('检查点任务编号无效');
 const file=path.join(store.directory,'document-analysis',from,'checkpoint.json'),bytes=fs.readFileSync(file);
 if(checkpointHash(bytes)!==previous.documentAnalysis.checkpointSha256)throw Error('检查点哈希不一致，禁止复用');
 const state=JSON.parse(bytes);
 if(state.taskId!==from||state.version!==ANALYSIS_VERSION||JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('检查点模型、处理版本或原文片段已改变；请重新开始');
 for(const field of ['items','issues','receipts','dispositions'])if(!Array.isArray(state[field]))throw Error('检查点结构不完整');
 const allowed=new Set(units.map(u=>u.id));
 if(state.dispositions.some(d=>!allowed.has(d.unitId)||!['item','background','uncertain'].includes(d.status)))throw Error('检查点含无效片段处置');
 const itemKeys=new Set(state.items.map(i=>i.key));
 if(state.dispositions.some(d=>d.status==='item'&&!itemKeys.has(d.key)))throw Error('检查点候选去向缺失');
 const byId=new Map(units.map(u=>[u.id,u]));
 for(const item of state.items){if(item.status!=='needs_confirmation'||!Array.isArray(item.basis)||!item.basis.length)throw Error('检查点候选状态或依据无效');for(const ref of item.basis){const unit=byId.get(ref.unitId);if(!unit||ref.sourceId!==unit.sourceId||ref.quote!==unit.text||ref.page!==unit.page)throw Error('检查点候选证据已改变');}}
 const handled=new Set(state.dispositions.filter(d=>(d.pass||'extract')==='extract').map(d=>d.unitId));
 if(state.processedUnits!==handled.size||JSON.stringify(state.remainingUnitIds)!==JSON.stringify(units.filter(u=>!handled.has(u.id)).map(u=>u.id)))throw Error('检查点处置计数不一致');
 // Operational failures remain in history; retry can resolve their outstanding
 // targets. Semantic issues remain open even if another batch finishes later.
 const operational=new Set(['model_failure','unit_unprocessed','audit_unprocessed','analysis_budget']);
 return {items:state.items,dispositions:state.dispositions,issues:state.issues.filter(i=>!operational.has(i.reason)),history:[...(state.history||[]),{taskId:from,checkpointSha256:previous.documentAnalysis.checkpointSha256,calls:state.calls,receipts:state.receipts,operationalIssues:state.issues.filter(i=>operational.has(i.reason))}],parent:{taskId:from,checkpointSha256:previous.documentAnalysis.checkpointSha256,processedUnits:handled.size}};
}
export function executionFailure(job,signal,error){
 const timedOut=signal.aborted&&signal.reason?.code==='WORKSPACE_TIMEOUT';
 if(timedOut)return {status:job.documentAnalysis?.processedUnits>0||job.comparisonPreflight?.readbackVerified||job.workResult?.items?.length?'partial':'waiting_input',message:'执行时间预算耗尽；已保留检查点、候选和剩余片段。',cancelled:false,timedOut:true};
 if(signal.aborted||job.status==='cancelled')return {status:'cancelled',message:'已取消，原件保留；已有交付物和已确认待办不会被撤销。',cancelled:true,timedOut:false};
 return null;
}
