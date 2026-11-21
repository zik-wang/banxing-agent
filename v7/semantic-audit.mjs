import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contentHash,atomicJson} from './reliability.mjs';
import {readOriginal} from './workspace-files.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {extractAtoms} from './semantic-atoms.mjs';
import {auditClaim} from './semantic-relations.mjs';
export const SEMANTIC_VERSION='v7-p3-semantic-1';
function findModelCall(store,taskId,callId){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(callId))throw Error('非法模型调用ID');const root=path.join(store.directory,'reliability'),preferred=path.join(root,taskId,'calls',callId+'.json');if(fs.existsSync(preferred))return preferred;const hits=(fs.existsSync(root)?fs.readdirSync(root):[]).filter(id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id)).map(id=>path.join(root,id,'calls',callId+'.json')).filter(f=>fs.existsSync(f));return hits.length===1?hits[0]:preferred;}
export function semanticFolder(store,id){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('非法任务标识');return path.join(store.directory,'semantic',id);}
export function buildSemanticSnapshot(store,taskId){
 const job=store.state.jobs.find(j=>j.id===taskId);if(!job||!['08','24','21'].includes(job.scenarioId)||job.conversationId)throw Error('仅支持独立Workspace 08/24/21授权任务');
 if(['running','queued'].includes(job.status))throw Error('请等待原任务结束');
 const sourceFile=path.join(store.directory,'supplements',job.id,'checkpoint.json');if(!job.supplement||!fs.existsSync(sourceFile))return buildTargetedLegacySnapshot(store,job);
 const bytes=fs.readFileSync(sourceFile);if(contentHash(bytes)!==job.supplement.checkpointSha256)throw Error('原补查检查点哈希不一致');
 const cp=JSON.parse(bytes),base=store.state.jobs.find(j=>j.id===cp.plan.baseTaskId);if(!base)throw Error('原任务缺失');
 const files=cp.plan.sourceFiles.map(ref=>{const file=store.state.workspaceFiles.find(f=>f.id===ref.id);if(!file||file.sha256!==ref.sha256||!job.dataScope.some(f=>f.id===file.id&&f.sha256===file.sha256))throw Error('授权来源范围或文件哈希变化');if(contentHash(readOriginal(store,file))!==ref.sha256)throw Error('原件哈希变化');return {id:file.id,name:file.name,sha256:file.sha256};});
 const baseFile=path.join(store.directory,'task-recovery',base.id,'checkpoint.json'),baseBytes=fs.readFileSync(baseFile);if(contentHash(baseBytes)!==cp.plan.baseCheckpointSha256)throw Error('原任务检查点变化');
 const original=JSON.parse(baseBytes),allUnits=original.payload?.inventory?.units||original.payload?.units||[];
 const units=[...new Map([...cp.plan.targets,...cp.plan.groups.flatMap(g=>[...g.targets,...g.context])].map(u=>[u.id,{...u,fileHash:files.find(f=>f.id===u.sourceId)?.sha256}])).values()];
 const atomResult=extractAtoms(units.filter(u=>!u.deterministicHeader));
 const candidates=cp.candidates.map(c=>{
  const a=auditClaim(c,units,job.scenarioId),origin=c.origin,callTask=origin.taskId||origin.originalTaskId||job.id;
  let call,callPath,receiptPath=null,rawPresent=false;
  if(origin.kind==='registered-evidence'){
   const dir=path.join(store.directory,'supplement-evidence');for(const n of fs.existsSync(dir)?fs.readdirSync(dir):[]){if(!/^[a-f0-9]{64}\.json$/.test(n))continue;const r=JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));if(r.call?.id===origin.modelCallId){receiptPath=path.join(dir,n);call=r.call;rawPresent=!!r.raw;break;}}
  }else{callPath=path.join(store.directory,'reliability',callTask,'calls',origin.modelCallId+'.json');if(fs.existsSync(callPath)){call=JSON.parse(fs.readFileSync(callPath,'utf8'));rawPresent=fs.existsSync(path.join(store.directory,'reliability',callTask,'calls',origin.modelCallId+'-parsed.json'))&&!!call.harnessSession?.file&&fs.existsSync(path.join(store.directory,'harness-sessions',path.basename(call.harnessSession.file)));}}
  const artifacts=[...job.artifacts,...base.artifacts].map(ar=>({taskId:job.artifacts.some(j=>j.id===ar.id)?job.id:base.id,id:ar.id,name:ar.name,sha256:ar.sha256}));
  return {...a,taskId:job.id,originalCandidate:c,origin,sourceFiles:files.filter(f=>c.evidence.some(e=>e.sourceId===f.id)),evidence:c.evidence.map(e=>({...e,fullUnit:units.find(u=>u.id===e.unitId)?.text||null})),modelTrace:{modelCallId:origin.modelCallId,callTaskId:callTask,callPath:callPath||null,receiptPath,rawPresent,promptHash:call?.promptHash||null,profile:call?.inference||call?.profile||origin.profile||null,callMetadataHash:call?contentHash(call):null},deliveryRefs:artifacts,traceIssues:rawPresent?[]:['MODEL_RAW_TRACE_MISSING']};
 });
 // Mark possible duplicates, retaining every original and both evidence chains.
 for(let i=0;i<candidates.length;i++){const a=candidates[i],prior=candidates.slice(0,i).find(b=>b.originalClaim===a.originalClaim||a.evidence.some(e=>b.evidence.some(f=>e.sourceId===f.sourceId&&e.unitId===f.unitId&&e.quote.includes(f.quote)))&&a.originalClaim.replace(/^采购/,'').replace(/^项目名称/,'名称')===b.originalClaim.replace(/^采购/,'').replace(/^项目名称/,'名称'));if(prior)a.potentialDuplicateOf=prior.candidateId;}
 const originalDeliveryReadback=[];for(const ar of job.artifacts){try{resolveArtifact(store,job.id,ar.id);originalDeliveryReadback.push({id:ar.id,verified:true});}catch(e){originalDeliveryReadback.push({id:ar.id,verified:false,error:e.message});}}
 return {version:SEMANTIC_VERSION,taskId:job.id,scenarioId:job.scenarioId,goal:job.goal,rules:job.rules,createdAt:new Date().toISOString(),sourceCheckpointHash:contentHash(bytes),baseCheckpointHash:contentHash(baseBytes),baseCounts:cp.plan.baseCounts,coverage:cp.coverage,sourceFiles:files,sourceUnits:units,originalInventoryUnitCount:allUnits.length,originalCandidateHash:contentHash(cp.candidates),originalDeliveryReadback,candidates,atomic:atomResult,modelFindings:[],relations:[],counterEvidence:[],independentHumanGoldCount:0,limits:['Only selected supplement targets/context audited; not full document semantic coverage.','Literal span verification does not independently validate semantic claims.']};
}
export function saveSemanticSnapshot(store,snapshot){const root=semanticFolder(store,snapshot.taskId),file=path.join(root,'snapshot.json'),codeRoot=path.dirname(fileURLToPath(import.meta.url)),pipelineFingerprint=contentHash(['semantic-audit.mjs','semantic-atoms.mjs','semantic-relations.mjs'].map(n=>({file:n,hash:contentHash(fs.readFileSync(path.join(codeRoot,n)))})));
 const body={...snapshot,pipelineFingerprint};if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.sourceCheckpointHash!==snapshot.sourceCheckpointHash)throw Error('来源变化，不能覆盖旧语义审计');if(old.pipelineFingerprint===pipelineFingerprint)return old;const oldPath=path.join(root,'snapshots',old.snapshotHash+'.json');if(!fs.existsSync(oldPath))atomicJson(oldPath,old);}
 const next={...body,snapshotHash:contentHash(body)},revision=path.join(root,'snapshots',next.snapshotHash+'.json');if(!fs.existsSync(revision))atomicJson(revision,next);atomicJson(file,next);return next;}
export function loadSemanticSnapshot(store,id){const file=path.join(semanticFolder(store,id),'snapshot.json');if(!fs.existsSync(file))return null;const s=JSON.parse(fs.readFileSync(file,'utf8')),{snapshotHash,...body}=s;if(contentHash(body)!==snapshotHash)throw Error('语义快照哈希不一致');return s;}
function buildTargetedLegacySnapshot(store,job){
 if(job.scenarioId!=='24')throw Error('本轮仅对08/21补查与24已存候选提供审计入口');
 const file=path.join(store.directory,'task-recovery',job.id,'checkpoint.json'),bytes=fs.readFileSync(file),cp=JSON.parse(bytes),all=cp.payload?.inventory?.units;if(!all||!cp.payload.candidates)throw Error('历史任务格式暂不支持');
 const sourceFiles=job.dataScope.map(ref=>{const f=store.state.workspaceFiles.find(f=>f.id===ref.id);if(!f||contentHash(readOriginal(store,f))!==ref.sha256)throw Error('原件或范围变化');return {id:f.id,name:f.name,sha256:f.sha256};});
 const selected=cp.payload.candidates.filter(c=>c.modelCallId&&c.evidence?.length).slice(0,8),ids=new Set(selected.flatMap(c=>[...c.basis,...c.evidence].map(e=>e.unitId))),units=all.filter(u=>ids.has(u.id));
 const candidates=selected.map(c=>{const evidence=[...new Map([...c.basis,...c.evidence].map(e=>[e.unitId,e])).values()].map(e=>{const u=units.find(u=>u.id===e.unitId),start=u?.text.indexOf(e.quote)??-1;return {...e,spanStart:start,spanEnd:start+e.quote.length,textHash:u?contentHash(u.text):null};}),mapped={id:c.id,text:c.raw.summary||c.raw.title,evidence};const callPath=findModelCall(store,job.id,c.modelCallId),call=fs.existsSync(callPath)?JSON.parse(fs.readFileSync(callPath,'utf8')):null;return {...auditClaim(mapped,units,'24'),taskId:job.id,originalCandidate:c,origin:{kind:'historical-candidate',modelCallId:c.modelCallId},sourceFiles,evidence:evidence.map(e=>({...e,fullUnit:units.find(u=>u.id===e.unitId)?.text})),modelTrace:{modelCallId:c.modelCallId,callTaskId:call?.taskId||job.id,callPath,rawPresent:!!call?.harnessSession?.file,promptHash:call?.promptHash||null,profile:call?.inference||null},deliveryRefs:job.artifacts.map(a=>({taskId:job.id,...a})),traceIssues:call?[]:['MODEL_RAW_TRACE_MISSING']};});
 return {version:SEMANTIC_VERSION,taskId:job.id,scenarioId:'24',goal:job.goal,rules:job.rules,createdAt:new Date().toISOString(),sourceCheckpointHash:contentHash(bytes),sourceFiles,sourceUnits:units,originalCandidateHash:contentHash(cp.payload.candidates),originalInventoryUnitCount:all.length,candidates,atomic:extractAtoms(units),originalDeliveryReadback:[],relations:[],modelFindings:[],counterEvidence:[],independentHumanGoldCount:0,coverage:null,limits:['Targeted first 8 stored impact candidates only; not all 24 candidates nor whole-document semantic coverage.']};
}
