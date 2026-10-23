import fs from 'node:fs';import path from 'node:path';
import {contentHash,atomicJson,canonical} from './reliability.mjs';
import {SUPPLEMENT_PROTOCOL,validateSupplement} from './targeted-recovery.mjs';
import {sameUnits} from './supplement-plan.mjs';
const root=store=>path.join(store.directory,'supplement-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function registeredEvidence(store,baseId){
 const folder=root(store);if(!fs.existsSync(folder))return [];
 return fs.readdirSync(folder).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>{const bytes=fs.readFileSync(path.join(folder,n)),record=JSON.parse(bytes);if(contentHash(record)!==n.slice(0,-5))throw Error('补查回执哈希不一致');return record;}).filter(r=>r.baseTaskId===baseId);
}
export function registerSupplementEvidence(store,{base,request,raw,call,phase,origin}){
 if(!['extract','audit'].includes(phase)||request.protocol!==SUPPLEMENT_PROTOCOL||request.parent?.taskId!==base.id||request.parent.checkpointSha256!==base.recovery.checkpointSha256||call.status!=='succeeded'||!Array.isArray(call.requests)||call.requests.length!==1||!call.harnessSession?.file||!call.inference?.profile||!Array.isArray(request.documents)||request.documents.length!==1)throw Error('真实补查回执来源不完整');
 const doc=request.documents[0],targets=doc.units.filter(u=>u.target===true),context=doc.units.filter(u=>u.contextOnly===true);
 if(canonical(call.targetUnitIds)!==canonical(targets.map(u=>u.id))||contentHash(request.documents)!==call.inputHash)throw Error('补查调用与保存输入不匹配');
 const validation=validateSupplement(raw,targets,context);if(!validation.allTargetsRegistered)throw Error('回执未通过逐目标及引用校验');
 const record={version:'v7-p2-registered-evidence-1',baseTaskId:base.id,baseCheckpointSha256:base.recovery.checkpointSha256,phase,protocol:SUPPLEMENT_PROTOCOL,targets,context,raw,call:{id:call.id,taskId:call.taskId,profile:call.inference.profile,requests:call.requests.length,inputHash:call.inputHash,promptHash:call.promptHash},origin,registeredAt:new Date().toISOString()};
 // Idempotent by original provider call, without counting replay as a request.
 const existing=registeredEvidence(store,base.id).find(r=>r.call.id===call.id);if(existing){if(canonical({...existing,registeredAt:null})!==canonical({...record,registeredAt:null}))throw Error('同一模型调用的补查回执发生变化');return existing;}
 atomicJson(path.join(root(store),contentHash(record)+'.json'),record);return record;
}
export function reusableEvidence(records,plan,group){return records.find(r=>r.baseCheckpointSha256===plan.baseCheckpointSha256&&r.phase===group.phase&&r.protocol===plan.protocol&&sameUnits(r.targets,group.targets)&&sameUnits(r.context,group.context));}
export function supplementRequestAccounting(store,plan){
 const ids=new Map(registeredEvidence(store,plan.baseTaskId).map(r=>[r.call.id,r.call.requests]));
 for(const job of store.state.jobs.filter(j=>j.supplement?.baseTaskId===plan.baseTaskId))for(const call of job.reliability?.modelCalls||[]){const file=path.join(store.directory,'reliability',job.id,'calls',call.id+'.json');if(fs.existsSync(file)){const c=read(file);ids.set(c.id,c.requests?.length||0);}}
 const protocolRequests=[...ids.values()].reduce((a,b)=>a+b,0);
 return {originalRequests:plan.baseCounters.cumulativeRequests,protocolRequests,cumulativeRequests:plan.baseCounters.cumulativeRequests+protocolRequests,maxProtocolRequests:plan.policy.maxProtocolRequests,maxCumulativeRequests:plan.policy.maxCumulativeRequests,providerCallIds:[...ids.keys()]};
}
