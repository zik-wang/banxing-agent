import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {contentHash,atomicJson,beginVerification,createAnalysisAudit} from '../recovery/reliability.mjs';
import {buildSemanticSnapshot,saveSemanticSnapshot,loadSemanticSnapshot,semanticFolder} from './semantic-audit.mjs';
import {verifyRelation,counterEvidence} from './semantic-relations.mjs';
import {semanticContract} from './semantic-contract.mjs';
import {readReviews,reviewMetrics,grantReview,submitReview,saveGoldAnnotation,adjudicateGold} from './semantic-review.mjs';
import {writeArtifact,resolveArtifact} from '../documents/artifacts.mjs';
import {validateServiceUrl} from '../integrations/intranet.mjs';
import {bindLiteralSpan} from './semantic-binding.mjs';
import {inferenceProfile} from '../integrations/inference-config.mjs';
import {deliverSemanticLayers} from './semantic-delivery.mjs';
export function prepareSemantic(workspace,taskId){return saveSemanticSnapshot(workspace.store,buildSemanticSnapshot(workspace.store,taskId));}
function results(store,id){const root=path.join(semanticFolder(store,id),'runs');return fs.existsSync(root)?fs.readdirSync(root).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'))):[];}
export function semanticView(workspace,taskId){const s=loadSemanticSnapshot(workspace.store,taskId);if(!s)return {taskId,prepared:false};const records=readReviews(workspace.store,taskId);return {...s,prepared:true,reviews:records,metrics:reviewMetrics(s,records),runs:results(workspace.store,taskId)};}
export function startSemantic(workspace,taskId){
 if(workspace.active.size||workspace.recognizing.size||workspace.harness.active.size)throw Error('助手正在处理其他任务，请稍候');
 const s=loadSemanticSnapshot(workspace.store,taskId)||prepareSemantic(workspace,taskId),existing=results(workspace.store,taskId);
 if(existing.some(r=>r.status==='completed'))return workspace.store.state.jobs.find(j=>j.id===existing.find(r=>r.status==='completed').jobId);
 const previousCalls=existing.reduce((n,r)=>n+(r.providerRequests||0),0);if(previousCalls>=4)throw Error('本任务P3累计4次请求上限已到；不无限重试');
 const connection=workspace.harness.modelConnection();validateServiceUrl(new URL(connection.baseUrl).origin);if(!workspace.harness.directory?.intranetOnly||workspace.harness.directory.status().publicCloudEnabled)throw Error('本轮仅使用公司内网27B');
 // Rebuild before inference to detect changed source scope/raw files, but never
 // overwrite the frozen audit or any previous raw candidates.
 if(buildSemanticSnapshot(workspace.store,taskId).sourceCheckpointHash!==s.sourceCheckpointHash)throw Error('来源变化，停止沿用语义快照');
 const base=workspace.store.state.jobs.find(j=>j.id===taskId),job={id:randomUUID(),scenarioId:base.scenarioId,title:'语义核查：'+base.title,goal:base.goal,rules:base.rules,options:{semanticParentId:taskId},dataScope:structuredClone(base.dataScope),authorization:'只读原授权材料；分批核查语义、条件和表格原子要求；只新增独立交付，保留人工待核。',createdAt:new Date().toISOString(),status:'queued',trace:[],artifacts:[],checks:[],warnings:[],actions:[],evidence:[],summary:'语义核查已排队；不自动确认原候选。'};
 workspace.store.state.jobs.unshift(job);const controller=new AbortController();workspace.active.set(job.id,controller);workspace.store.save();void run(workspace,job,s,controller,previousCalls);return job;
}
async function run(w,job,s,controller,previousCalls){
 const store=w.store,run={jobId:job.id,parentTaskId:s.taskId,snapshotHash:s.snapshotHash,startedAt:new Date().toISOString(),status:'running',providerRequests:0,batches:[],modelFindings:[],atoms:[],relations:[],counterEvidence:[],newInformation:[],errors:[]},file=path.join(semanticFolder(store,s.taskId),'runs',job.id+'.json');
 const save=()=>{run.providerRequests=job.reliability?.providerRequests||0;atomicJson(file,run);store.save();};
 const log=(type,label,detail)=>{job.trace.push({type,label,detail,at:new Date().toISOString()});store.save();};
 job.status='running';job.startedAt=run.startedAt;
 try{
  const files=s.sourceFiles.map(ref=>store.state.workspaceFiles.find(f=>f.id===ref.id));beginVerification(store,job,files,w.harness);
  // Small text-only targeted tasks still need the same persisted call auditing.
  if(!job.reliability)job.reliability={runId:randomUUID(),quality:'not_evaluated',analysisSessions:0,providerRequests:0,maxProviderRequests:4,modelCalls:[],issues:[],gates:[]};
  job.reliability.maxProviderRequests=Math.min(4-previousCalls,job.reliability.maxProviderRequests);save();
  const groups=[];for(let i=0;i<s.candidates.length;i+=10)groups.push(s.candidates.slice(i,i+10));
  for(const group of groups){
   if(run.providerRequests+previousCalls>=4)break;controller.signal.throwIfAborted();
   const idset=new Set(group.flatMap(c=>c.sourceUnitIds)),units=s.sourceUnits.filter(u=>idset.has(u.id)),focus=units.map(u=>u.id);
   const instruction='你是局部语义反证与原子要求核查员。只检查focus来源，不宣称全文无遗漏。核查候选是否越过原文：成员/负责人、验收/截止、范围排除、条件和例外、事实/业务推断、单侧事实/跨版本变化。表格一行可含多项要求；末列否未绑定表头时不得推断为不支持。输出checks每个候选一项（candidateId用下面原id）；找原子遗漏输出atoms，最多24项，quote必须逐字原文，unitId必须真实。conditions/exceptions不明用null。不要输出confirmed。没有反证只能not_found_not_proof。候选清单：'+JSON.stringify(group.map(c=>({candidateId:c.candidateId,claim:c.originalClaim})))+'。已有规则atoms只作对照，不是gold：'+JSON.stringify(s.atomic.atoms.filter(a=>a.sourceUnitIds.some(id=>idset.has(id))).map(a=>({source:a.sourceUnitIds,text:a.object}))) ;
   const shape=JSON.stringify({checks:[{candidateId:'真实id',status:'supported_candidate|partially_supported|contradicted|insufficient_evidence',reason:'理由',evidence:[{unitId:'真实id',quote:'逐字证据'}],condition:null,exception:null,scope:null,counterEvidence:'not_found_not_proof 或具体反证'}],atoms:[{unitId:'真实id',quote:'最小逐字片段',subject:'原文主体或null',predicate:'明确关系或null',object:'原文客体或null',condition:null,exception:null}]});
   const args={kind:'p3-semantic-counter-evidence',instruction,shape,documents:[{id:s.taskId,name:'授权局部语义与原子核查',focusIds:focus,units:units.map(u=>({...u,target:true}))}],recoveryRequest:()=>{if((job.reliability.providerRequests||0)+previousCalls>=4)throw Error('P3累计请求预算耗尽');}};
   let reused=null;
   for(const previous of results(store,s.taskId).filter(r=>r.jobId!==job.id).reverse())for(const prior of previous.batches||[]){const folder=path.join(store.directory,'reliability',previous.jobId,'calls'),cf=path.join(folder,prior.modelCallId+'.json'),pf=path.join(folder,prior.modelCallId+'-parsed.json');if(!fs.existsSync(cf)||!fs.existsSync(pf))continue;const c=JSON.parse(fs.readFileSync(cf,'utf8'));if(c.status==='succeeded'&&c.inputHash===contentHash(args.documents)&&c.promptHash===contentHash({instruction:args.instruction,shape:args.shape})&&contentHash(c.inference?.profile||{})===contentHash(inferenceProfile(w.harness.modelConnection()))){reused={call:c,raw:JSON.parse(fs.readFileSync(pf,'utf8')),originalTaskId:previous.jobId};break;}}
   const audit=reused?{id:reused.call.id,submitted(){},finish(){}}:createAnalysisAudit(store,job,args),batch={modelCallId:audit.id,origin:reused?'offline_validator_recompute':'new_inference',originalTaskId:reused?.originalTaskId||job.id,focusIds:focus,candidateIds:group.map(c=>c.candidateId),startedAt:new Date().toISOString(),status:'running',errors:[]};run.batches.push(batch);save();
   try{
    const raw=reused?reused.raw:await w.analyze({...args,audit,signal:controller.signal,onEvent:log});audit.submitted(raw);audit.finish();
    const checks=Array.isArray(raw?.checks)?raw.checks:[],atoms=Array.isArray(raw?.atoms)?raw.atoms:[],seen=new Set();
    const bind=e=>bindLiteralSpan(e,units);
    for(const c of checks){if(!group.some(g=>g.candidateId===c.candidateId)||seen.has(c.candidateId)||!['supported_candidate','partially_supported','contradicted','insufficient_evidence'].includes(c.status)||typeof c.reason!=='string'||!c.reason.trim()||!Array.isArray(c.evidence)||!c.evidence.length||!c.evidence.every(bind)){batch.errors.push({candidateId:c.candidateId,code:'INVALID_SEMANTIC_PROTOCOL_OR_CITATION'});continue;}seen.add(c.candidateId);run.modelFindings.push({...c,evidence:c.evidence.map(bind),modelCallId:audit.id,model_agreed:c.status==='supported_candidate',independently_verified:false,productionStatus:'needs_human_review'});}
    for(const c of group)if(!seen.has(c.candidateId))batch.errors.push({candidateId:c.candidateId,code:'MISSING_OR_INVALID_CHECK'});
    if(atoms.length>24)batch.errors.push({code:'ATOM_OUTPUT_LIMIT',actual:atoms.length,retainedInRaw:true});
    for(const a of atoms.slice(0,24)){const bound=bind(a);if(!bound){batch.errors.push({code:'INVALID_ATOM_SPAN'});continue;}const u=units.find(u=>u.id===a.unitId),id='MA'+contentHash({unitId:a.unitId,quote:a.quote,call:audit.id}).slice(0,24);run.atoms.push({...a,atomId:id,sourceUnitIds:[a.unitId],atomType:/支持|提供|需|应|必须|不得/.test(bound.quote)?'requirement':'other',exactEvidenceRefs:[bound],extractionMethod:'qwen-local-atomic-omission-audit',validationStatus:'candidate',issues:['model_generated_atom_set_not_exhaustive'],modelCallId:audit.id,independently_verified:false});if(a.subject&&a.predicate&&a.object){const r=verifyRelation({...a,evidenceRefs:[a.unitId]},units);run.relations.push({...r,atomId:id,modelCallId:audit.id});run.counterEvidence.push(counterEvidence(r,units));}}
    run.newInformation.push({modelCallId:audit.id,origin:batch.origin,validCandidateChecks:seen.size,newAtomicSpans:run.atoms.filter(a=>a.modelCallId===audit.id).length,notCorrectnessProof:true});batch.status=batch.errors.length?'partial':'returned';
   }catch(e){audit.finish(e);batch.status='failed';batch.errors.push({code:e.code||'MODEL_FAILURE',message:e.message});run.errors.push({batch:audit.id,message:e.message});}
   batch.finishedAt=new Date().toISOString();save();
  }
  run.status=run.batches.every(b=>b.status==='returned')&&run.batches.length===groups.length?'completed':'partial';
  run.contract=semanticContract({scenarioId:s.scenarioId,candidates:s.candidates,atoms:s.atomic.atoms,inputComplete:true,targetsProcessed:!!s.coverage&&s.coverage.registeredTargets===s.coverage.totalTargets,deliveryReadback:true});
  const json=writeArtifact(store,job,'语义核查与原子事实.json',Buffer.from(JSON.stringify({...run,originalSnapshot:s},null,2)));
  const md=['# 语义核查结果',`原任务：${s.taskId}`,`候选 ${s.candidates.length}，规则发现原子 ${s.atomic.atoms.length}，模型原子候选 ${run.atoms.length}。`,`真实请求 ${job.reliability.providerRequests}，模型再次支持不等于独立确认。`,'业务目标状态：partial；未核实业务推断继续保留。',...s.candidates.map(c=>`## ${c.candidateId}\n${c.originalClaim}\n语义：${c.semanticStatus}；任务范围：${c.taskScopeStatus}\n${c.evidence.map(e=>`${e.sourceName||e.name} / ${e.unitId} / 页${e.page??'未知'}\n> ${e.quote}`).join('\n')}`),'## 模型局部核查（仍需人工）',...run.modelFindings.map(f=>`${f.candidateId} ${f.status}：${f.reason}`),'## 未解决范围',...s.limits,'表格列网格、合并表头及真实语义完整性未证实。'];
  const markdown=writeArtifact(store,job,'语义核查与待核.md',Buffer.from(md.join('\n\n'))),read=JSON.parse(resolveArtifact(store,job.id,json.id).bytes);
  if(read.originalSnapshot.originalCandidateHash!==s.originalCandidateHash||read.originalSnapshot.candidates.length!==s.candidates.length)throw Error('语义交付候选回读不一致');resolveArtifact(store,job.id,markdown.id);
  run.delivery={jsonArtifactId:json.id,markdownArtifactId:markdown.id,verified:true};run.contract=semanticContract({scenarioId:s.scenarioId,candidates:s.candidates,atoms:s.atomic.atoms,inputComplete:true,targetsProcessed:!!s.coverage&&s.coverage.registeredTargets===s.coverage.totalTargets,deliveryReadback:true});
  job.status='partial';job.summary=`局部语义核查：${s.candidates.length}候选、${run.atoms.length}模型原子候选；保留人工待核。`;job.reliability.quality='partial';job.options.semanticContract=run.contract;job.checks.push({label:'原候选与新语义交付回读一致；未自动确认语义',passed:true});
 }catch(e){run.status=controller.signal.aborted?'cancelled':'failed';run.errors.push({message:e.message});job.status=run.status;job.error=e.message;}
 finally{run.finishedAt=new Date().toISOString();job.finishedAt=run.finishedAt;save();w.active.delete(job.id);store.save();}
}
export function semanticGet(w,id){return semanticView(w,id);}
export function semanticPost(w,route,input,actor){if(route==='prepare')return prepareSemantic(w,input.taskId);if(route==='start')return startSemantic(w,input.taskId);if(route==='delivery')return deliverSemanticLayers(w,input.taskId);if(route==='authorize')return grantReview(w.store,input,actor);if(route==='review')return submitReview(w.store,input,actor);if(route==='gold-annotation')return saveGoldAnnotation(w.store,input,actor);if(route==='gold-adjudicate')return adjudicateGold(w.store,input,actor);throw Error('没有此语义操作');}
