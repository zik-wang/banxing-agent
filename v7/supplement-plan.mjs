import {readRecovery,assertLatestResume} from './task-recovery.mjs';
import {contentHash,canonical} from './reliability.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {readOriginal} from './workspace-files.mjs';
import {splitNumberedRequirements,SUPPLEMENT_PROTOCOL} from './targeted-recovery.mjs';
export const SUPPLEMENT_VERSION='v7-p2-workspace-supplement-1';
export const SUPPLEMENT_POLICY=Object.freeze({maxProtocolRequests:4,maxAttemptsPerTarget:2,maxBatchTargets:20,maxBatchCharacters:5500});
const key=(phase,id)=>phase+'|'+id;
export function getSupplementBase(store,input){
 const previous=store.state.jobs.find(j=>j.id===input.jobId);
 if(!previous||previous.conversationId||!['08','24','21'].includes(previous.scenarioId)||['running','queued'].includes(previous.status))throw Error('补查入口仅支持已结束的Workspace 08/24/21任务');
 const base=previous.supplement?store.state.jobs.find(j=>j.id===previous.supplement.baseTaskId):previous;
 if(!base||base.conversationId||!base.recovery)throw Error('没有可核验的原任务检查点');
 assertLatestResume(store,base.id);
 const descendants=store.state.jobs.filter(j=>j.supplement?.baseTaskId===base.id);
 if(!previous.supplement&&descendants.length)return {base,previous,existing:descendants[0]};
 if(previous.supplement&&descendants[0]?.id!==previous.id)throw Error('已有更新的补查子任务，请打开最新补查记录');
 const files=base.dataScope.map(s=>{const f=store.state.workspaceFiles.find(f=>f.id===s.id&&f.sha256===s.sha256);if(!f)throw Error('补查原件身份已变化');readOriginal(store,f);return f;});
 const checkpoint=readRecovery(store,base);
 return {base,previous,files,checkpoint};
}
export function buildSupplementPlan(store,{base,files,checkpoint}){
 let units=checkpoint.payload.inventory?.units;
 if(base.scenarioId==='21'){
  const artifact=base.artifacts.find(a=>a.name==='分页来源片段清单.json');if(!artifact)throw Error('缺少页级来源清单，不能猜测补查原文');
  units=JSON.parse(resolveArtifact(store,base.id,artifact.id).bytes).units;
 }
 if(!Array.isArray(units)||units.length!==checkpoint.units.length||contentHash(units)!==checkpoint.identity.unitsHash)throw Error('补查来源清单哈希不一致');
 if(units.some(u=>!checkpoint.units.some(x=>x.sourceUnitId===u.id&&x.inputHash===contentHash(u))))throw Error('片段原文与阶段检查点不一致');
 const sourceIds=new Set(files.map(f=>f.id));if(units.some(u=>!sourceIds.has(u.sourceId)))throw Error('来源清单包含未授权文件');
 const expectedScope=base.scenarioId==='21'?contentHash({rules:base.rules||'',files:files.map(f=>({id:f.id,sha256:f.sha256}))}):contentHash({scenario:base.scenarioId,rules:base.rules||'',files:checkpoint.payload.inventory.files});
 if(checkpoint.identity.scopeHash!==expectedScope)throw Error('原任务规则或授权范围已变化');
 if(base.scenarioId!=='21'&&checkpoint.payload.inventory.files.some((s,i)=>s.id!==files[i]?.id||s.sha256!==files[i]?.sha256||s.textHash!==contentHash(files[i]?.content||'')))throw Error('正文全文、顺序或文件版本已变化');
 if(base.scenarioId!=='21')for(const u of units){const f=files.find(f=>f.id===u.sourceId);if(f.content.slice(u.start,u.end)!==u.text)throw Error('正文与补查证据偏移不一致');}
 const stageMap=new Map(checkpoint.units.map(u=>[u.sourceUnitId,u.stages])),targets=[],groups=[],blocked=[];
 for(const phase of ['extract','audit']){
  const parents=units.filter(u=>stageMap.get(u.id)?.[phase]?.status!=='done');
  const readable=parents.filter(u=>{if(stageMap.get(u.id)[phase]?.status==='blocked'){blocked.push({sourceUnitId:u.id,phase,reason:stageMap.get(u.id)[phase].lastError});return false;}return true;});
  const phaseTargets=[];
  for(const u of readable){
   const parts=base.scenarioId==='21'?splitNumberedRequirements(u):[{...u,parentUnitId:u.id,parentStart:0,parentEnd:u.text.length}];
   if(parts[0]?.parentStart>0){const text=u.text.slice(0,parts[0].parentStart);if(text.trim())parts.unshift({...u,id:u.id+':PREFIX',text,parentUnitId:u.id,parentStart:0,parentEnd:parts[0].parentStart});}
   for(const part of parts){const isHeader=part.id.endsWith(':PREFIX')&&/^\s*招标文件\s+项目编号\s*[:：]\s*[\d-]+\s+\d+\s*$/.test(part.text);const t={...part,phase,targetKey:key(phase,part.id),deterministicHeader:isHeader};targets.push(t);phaseTargets.push(t);}
  }
  // A failed batch is one comparison input, with nearby text as context only.
  const context=[];for(const t of readable){const i=units.indexOf(t),radius=base.scenarioId==='21'?1:2;for(const c of units.slice(Math.max(0,i-radius),i+radius+1))if(c.sourceId===t.sourceId&&!readable.some(t=>t.id===c.id)&&!context.some(x=>x.id===c.id)&&!Object.values(stageMap.get(c.id)||{}).some(s=>s.status==='blocked'))context.push(c);}
  let batch=[],size=0;
  const push=()=>{if(batch.length){groups.push({id:contentHash({phase,ids:batch.map(t=>t.id)}).slice(0,20),phase,targets:batch,context});batch=[];size=0;}};
  for(const t of phaseTargets.filter(t=>!t.deterministicHeader)){if(batch.length&&(batch.length>=SUPPLEMENT_POLICY.maxBatchTargets||size+t.text.length>SUPPLEMENT_POLICY.maxBatchCharacters))push();batch.push(t);size+=t.text.length;}push();
 }
 const parentScopeHash=contentHash({rules:base.rules||'',files:base.dataScope}),plan={version:SUPPLEMENT_VERSION,protocol:SUPPLEMENT_PROTOCOL,baseTaskId:base.id,baseCheckpointSha256:base.recovery.checkpointSha256,parentScopeHash,sourceInventoryHash:contentHash(units),sourceFiles:base.dataScope,policy:{...SUPPLEMENT_POLICY,maxCumulativeRequests:checkpoint.policy.maxCumulativeRequests},baseCounters:checkpoint.counters,baseCounts:checkpoint.counts,totalSourceUnits:units.length,targets,groups,blocked,legacyCandidateHash:contentHash(checkpoint.payload.candidates||checkpoint.payload.items||[])};
 return {...plan,planHash:contentHash(plan)};
}
export function supplementCoverage(plan,rows){
 const accepted=new Set(rows.map(r=>key(r.phase,r.id))),counts={...plan.baseCounts};
 for(const phase of ['extract','audit'])for(const parent of new Set(plan.targets.filter(t=>t.phase===phase).map(t=>t.parentUnitId)))if(plan.targets.filter(t=>t.phase===phase&&t.parentUnitId===parent).every(t=>accepted.has(t.targetKey)))counts[phase]=(counts[phase]||0)+1;
 return {originalCounts:plan.baseCounts,combinedRegistrationCounts:counts,totalSourceUnits:plan.totalSourceUnits,registeredTargets:plan.targets.filter(t=>accepted.has(t.targetKey)).length,totalTargets:plan.targets.length,blocked:plan.blocked,limit:'Combined source disposition across recorded model/protocol runs; not semantic accuracy or full-task verification.'};
}
export const sameUnits=(a,b)=>canonical(a.map(u=>({id:u.id,text:u.text,sourceId:u.sourceId,page:u.page??null})))===canonical(b.map(u=>({id:u.id,text:u.text,sourceId:u.sourceId,page:u.page??null})));
