import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {getSupplementBase,buildSupplementPlan,supplementCoverage,SUPPLEMENT_VERSION} from './supplement-plan.mjs';
import {registeredEvidence,reusableEvidence,supplementRequestAccounting} from './supplement-evidence.mjs';
import {validateSupplement} from './targeted-recovery.mjs';
import {atomicJson,contentHash,beginVerification,createAnalysisAudit} from './reliability.mjs';
import {writeArtifact,resolveArtifact,makeZip} from '../documents/artifacts.mjs';
import {readOriginal} from '../workspace/workspace-files.mjs';
import {validateServiceUrl} from '../integrations/intranet.mjs';
import {modelConfigFingerprint} from '../integrations/inference-config.mjs';
const now=()=>new Date().toISOString(),root=(store,id)=>path.join(store.directory,'supplements',id),read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const errorRecord=e=>({code:e?.code||'SUPPLEMENT_FAILED',message:String(e?.message||e).slice(0,800)});
function assertIntranet(harness){const c=harness.modelConnection(),url=new URL(c.baseUrl);validateServiceUrl(url.origin);if(harness.directory?.status?.().publicCloudEnabled||!harness.directory?.intranetOnly)throw Error('此补查入口仅允许全公司内网部署');return c;}
function save(workspace,job,state){
 state.updatedAt=now();state.accounting=supplementRequestAccounting(workspace.store,state.plan);state.coverage=supplementCoverage(state.plan,state.rows);
 const left=state.targets.filter(t=>t.status!=='registered'),eligible=left.some(t=>t.status!=='blocked'&&t.attemptCount<state.plan.policy.maxAttemptsPerTarget);
 const budget=state.accounting.protocolRequests>=state.plan.policy.maxProtocolRequests||state.accounting.cumulativeRequests>=state.plan.policy.maxCumulativeRequests;
 const deliveryRecovery=!state.delivery?.verified&&['failed','cancelled','interrupted'].includes(job.status);
 const hasReusable=left.length>0&&state.plan.groups.some(g=>g.targets.some(t=>left.some(u=>u.targetKey===t.targetKey))&&reusableEvidence(registeredEvidence(workspace.store,state.plan.baseTaskId),state.plan,g));
 state.canResume=(left.length>0&&eligible&&!budget)||deliveryRecovery||hasReusable;
 state.stopReason=deliveryRecovery?'delivery_recovery_required':left.length===0&&!state.plan.blocked.length?'supplement_disposition_complete':hasReusable&&budget?'registered_evidence_available':budget?'cumulative_budget_exhausted':!eligible?'blocked_or_attempts_exhausted':'remaining_targets';
 const file=path.join(root(workspace.store,job.id),'checkpoint.json');atomicJson(file,state);
 job.supplement={version:SUPPLEMENT_VERSION,baseTaskId:state.plan.baseTaskId,parentTaskId:state.parentTaskId,planHash:state.plan.planHash,checkpointSha256:contentHash(fs.readFileSync(file)),coverage:state.coverage,accounting:state.accounting,canResume:state.canResume,stopReason:state.stopReason,deliveryVerified:state.delivery?.verified===true,newProviderRequests:job.reliability?.providerRequests||0,importedReceipts:state.receipts.filter(r=>r.origin.kind==='registered-evidence').length,candidateCount:state.candidates.length,failedTargets:left.filter(t=>t.status==='failed').length,unresolvedTargets:left.length+state.plan.blocked.length};
 workspace.store.save();
}
function event(workspace,job,state,type,data={}){fs.mkdirSync(root(workspace.store,job.id),{recursive:true});fs.appendFileSync(path.join(root(workspace.store,job.id),'events.jsonl'),JSON.stringify({at:now(),taskId:job.id,type,...data})+'\n');save(workspace,job,state);}
function accept(state,phase,validation,origin){
 for(const row of validation.accepted){
  const target=state.targets.find(t=>t.id===row.id&&t.phase===phase);if(!target||target.status==='registered')continue;
  const receiptId=contentHash({phase,row,origin});state.rows.push({...row,phase,receiptId,origin});target.status='registered';target.lastError=null;
  for(const claim of row.claims){const evidence=claim.evidence.map(ref=>{const unit=[...state.plan.targets,...state.plan.groups.flatMap(g=>g.context)].find(u=>u.id===ref.unitId);return {...ref,sourceId:unit?.sourceId,sourceName:state.plan.sourceFiles.find(f=>f.id===unit?.sourceId)?.name};}),identity=contentHash({unitId:row.id,phase,text:claim.text,evidence}),duplicate=state.candidates.find(c=>c.identity===identity);state.candidates.push({id:receiptId+'-'+state.candidates.length,identity,...claim,evidence,sourceUnitId:row.id,phase,origin,duplicateOf:duplicate?.id||null,status:'needs_semantic_confirmation',claimValidity:'not_verified'});}
 }
}
async function deliver(workspace,job,state,base,originalCheckpoint){
 const inherited=originalCheckpoint.payload.candidates||originalCheckpoint.payload.items||[];
 if(contentHash(inherited)!==state.plan.legacyCandidateHash)throw Error('原候选哈希已变化');
 const parentArtifacts=base.artifacts.map(a=>({jobId:base.id,...a}));
 const rawEntries=[];
 for(const a of state.attempts){const folder=path.join(workspace.store.directory,'reliability',a.taskId||job.id,'calls'),callFile=path.join(folder,a.modelCallId+'.json');if(!fs.existsSync(callFile))throw Error('补查原始调用记录缺失');const call=read(callFile),prefix='原始过程/'+(a.taskId||job.id)+'/'+a.modelCallId;for(const suffix of ['.json','-input.json','-parsed.json']){const file=path.join(folder,a.modelCallId+suffix);if(fs.existsSync(file))rawEntries.push([prefix+suffix,fs.readFileSync(file)]);}if(call.harnessSession?.file)rawEntries.push([prefix+'-session.jsonl',fs.readFileSync(path.join(workspace.store.directory,'harness-sessions',path.basename(call.harnessSession.file)))]);}
 for(const r of registeredEvidence(workspace.store,base.id).filter(r=>state.receipts.some(s=>s.origin.modelCallId===r.call.id)))rawEntries.push(['已存真实回执/'+contentHash(r.call.id)+'.json',Buffer.from(JSON.stringify(r,null,2))]);
 const unresolved=[...state.targets.filter(t=>t.status!=='registered').map(t=>({phase:t.phase,unitId:t.id,status:t.status,reason:t.lastError})),...state.plan.blocked,...state.rows.filter(r=>r.disposition==='uncertain').map(r=>({phase:r.phase,unitId:r.id,reason:r.reason})),...state.candidates.map(c=>({candidateId:c.id,reason:'needs_semantic_confirmation'}))];
 const manifest={version:SUPPLEMENT_VERSION,taskId:job.id,baseTaskId:base.id,parentTaskId:state.parentTaskId,baseCheckpointSha256:state.plan.baseCheckpointSha256,planHash:state.plan.planHash,coverage:state.coverage,accounting:state.accounting,originalTaskStatus:base.status,originalQuality:base.reliability?.quality||'partial',inheritedCandidates:inherited,inheritedCandidateHash:state.plan.legacyCandidateHash,supplementCandidates:state.candidates,dispositions:state.rows,receipts:state.receipts,rawAttemptRecords:state.attempts,rawEvidenceManifest:rawEntries.map(([name,bytes])=>({name,sha256:contentHash(bytes)})),unresolved,parentArtifacts,claimValidity:'not_verified',businessTaskComplete:false};
 const body=Buffer.from(JSON.stringify(manifest,null,2)),lines=['# 原任务与补查结果','',`原任务：${base.id}；补查子任务：${job.id}。`,`原阶段提取 ${state.plan.baseCounts.extract}/${state.plan.totalSourceUnits}，复核 ${state.plan.baseCounts.audit}/${state.plan.totalSourceUnits}。`,`累计多协议处置提取 ${state.coverage.combinedRegistrationCounts.extract}/${state.plan.totalSourceUnits}，复核 ${state.coverage.combinedRegistrationCounts.audit}/${state.plan.totalSourceUnits}；不能解释为准确率。`,`本子任务新增请求 ${job.reliability?.providerRequests||0}；原链及补查累计请求 ${state.accounting.cumulativeRequests}。`,`旧候选 ${inherited.length} 条完整保留在JSON与交付包；补查候选 ${state.candidates.length} 条仍待语义确认。`,'','## 补查候选与逐字证据',''];
 for(const c of state.candidates){lines.push(`### ${c.id}`,c.text,'状态：待语义核实。引用可定位不代表结论正确。',...c.evidence.map(e=>`来源 ${e.unitId} / 页 ${e.page??'未知'} / 父片段 ${e.parentUnitId}\n\n> ${e.quote.replaceAll('\n','\n> ')}`),'');}
 lines.push('## 未解决问题','',...unresolved.map(r=>'- '+JSON.stringify(r)),'','## 原交付物','',...parentArtifacts.map(a=>`- ${a.name}：SHA256 ${a.sha256}；交付包中完整保留。`),'','原件、旧候选、旧失败尝试及原任务状态均未反写。跨模型/协议的登记汇总不是独立模型正确性证明。');
 const markdown=Buffer.from(lines.join('\n'));
 const jsonArtifact=writeArtifact(workspace.store,job,'原任务与补查完整结果.json',body),mdArtifact=writeArtifact(workspace.store,job,'补查结果与待核.md',markdown);
 const entries=[['原任务与补查完整结果.json',body],['补查结果与待核.md',markdown],...rawEntries];
 for(const a of base.artifacts)entries.push(['原交付/'+a.id+'-'+a.name,resolveArtifact(workspace.store,base.id,a.id).bytes]);
 const zipBytes=await makeZip(entries),zip=writeArtifact(workspace.store,job,'原交付与补查完整包.zip',zipBytes),archive=await JSZip.loadAsync(resolveArtifact(workspace.store,job.id,zip.id).bytes);
 for(const [name,bytes]of entries){const member=archive.file(name);if(!member||contentHash(await member.async('nodebuffer'))!==contentHash(bytes))throw Error('补查交付包回读失败：'+name);}
 const readback=JSON.parse(resolveArtifact(workspace.store,job.id,jsonArtifact.id).bytes);
 if(contentHash(readback.inheritedCandidates)!==state.plan.legacyCandidateHash||contentHash(readback.supplementCandidates)!==contentHash(state.candidates)||readback.businessTaskComplete!==false)throw Error('补查交付候选或状态回读失败');
 state.delivery={jsonArtifactId:jsonArtifact.id,markdownArtifactId:mdArtifact.id,zipArtifactId:zip.id,verified:true,entries:entries.length};
 job.workResult={kind:'source-supplement',manifestArtifactId:jsonArtifact.id,inheritedCandidateHash:state.plan.legacyCandidateHash,inheritedCandidateCount:inherited.length,supplementCandidateCount:state.candidates.length,businessTaskComplete:false};
 job.checks.push({label:'原候选完整保留、补查候选JSON和原交付ZIP逐文件回读通过',passed:true});
}
export function startSupplement(workspace,input){
 const selection=getSupplementBase(workspace.store,input);if(selection.existing)return selection.existing;
 if(workspace.active.size||workspace.recognizing.size||workspace.harness.active.size)throw Error('助手正在处理上一项请求，请稍候或停止');
 assertIntranet(workspace.harness);
 const {base,previous,files,checkpoint}=selection,plan=buildSupplementPlan(workspace.store,selection);
 if(!plan.targets.length&&!plan.blocked.length)throw Error('原任务没有未处置目标；不重复分析全文');
 if(input.planHash&&input.planHash!==plan.planHash)throw Error('补查计划已经变化，请刷新页面');
 let state;
 if(previous.supplement){
  if(!previous.supplement.canResume&&!(previous.status==='interrupted'&&!previous.supplement.deliveryVerified))return previous;
  const file=path.join(root(workspace.store,previous.id),'checkpoint.json');if(contentHash(fs.readFileSync(file))!==previous.supplement.checkpointSha256)throw Error('补查检查点哈希不一致');
  state=read(file);if(state.version!==SUPPLEMENT_VERSION||state.plan.planHash!==plan.planHash)throw Error('补查来源、规则或协议变化，不能沿用旧进度');state=structuredClone(state);
 }else{
  const evidence=registeredEvidence(workspace.store,base.id);
  state={version:SUPPLEMENT_VERSION,plan,targets:plan.targets.map(t=>({...t,status:'pending',attemptCount:evidence.filter(r=>r.phase===t.phase&&r.targets.some(u=>u.id===t.id)).reduce((n,r)=>n+r.call.requests,0),lastError:null})),rows:[],candidates:[],receipts:[],attempts:[],createdAt:now()};
 }
 state.parentTaskId=previous.id;state.priorDelivery=state.delivery||null;state.delivery=null;
 for(const t of state.targets)if(t.status==='running'){t.status='needs_recovery';t.lastError={code:'PROCESS_INTERRUPTED',message:'旧窗口中断，未补造成功'};}
 const job={id:randomUUID(),scenarioId:base.scenarioId,title:'补查：'+base.title,goal:base.goal,rules:base.rules,options:{supplementProtocol:plan.protocol},dataScope:structuredClone(base.dataScope),authorization:'沿用原任务文件范围，读取已存回执或按新协议核对剩余目标；只写新的子任务交付，不修改原件与旧结果。',status:'queued',createdAt:now(),trace:[],artifacts:[],checks:[],warnings:[],actions:[],evidence:[],summary:'已排入受控补查；原任务保留。',error:null};
 workspace.store.state.jobs.unshift(job);const controller=new AbortController();workspace.active.set(job.id,controller);save(workspace,job,state);
 void executeSupplement(workspace,job,state,base,files,checkpoint,controller,input.preferEvidence!==false);return job;
}
export async function executeSupplement(workspace,job,state,base,files,checkpoint,controller,preferEvidence){
 const signal=controller.signal,store=workspace.store;job.status='running';job.startedAt=now();
 const log=(label,detail='')=>{job.trace.push({type:'supplement',label,detail,at:now()});store.save();};
 try{
  beginVerification(store,job,files,workspace.harness);
  for(const t of state.targets.filter(t=>t.deterministicHeader&&t.status!=='registered'))accept(state,t.phase,{accepted:[{id:t.id,disposition:'background',reason:'全文严格匹配“招标文件+项目编号+页码”页眉规则；仅作元信息处置',claims:[]}]},{kind:'deterministic-layout-rule',version:'strict-procurement-page-header-1'});
  const evidence=registeredEvidence(store,base.id);
  for(const group of state.plan.groups){
   signal.throwIfAborted();const remaining=group.targets.filter(g=>state.targets.find(t=>t.targetKey===g.targetKey).status!=='registered');if(!remaining.length)continue;
   const receipt=preferEvidence?reusableEvidence(evidence,state.plan,group):null;
   if(receipt){
    const validation=validateSupplement(receipt.raw,group.targets,group.context),origin={kind:'registered-evidence',modelCallId:receipt.call.id,originalTaskId:receipt.call.taskId,profile:receipt.call.profile,newProviderRequests:0};
    accept(state,group.phase,validation,origin);state.receipts.push({phase:group.phase,groupId:group.id,origin,validation});event(workspace,job,state,'evidence_revalidated',{modelCallId:receipt.call.id});log('回读已存真实补查回执',`${group.phase} ${validation.handledCount}/${group.targets.length}；新增请求0`);continue;
   }
   const accounting=supplementRequestAccounting(store,state.plan),available=remaining.filter(g=>state.targets.find(t=>t.targetKey===g.targetKey).attemptCount<state.plan.policy.maxAttemptsPerTarget);
   if(!available.length||accounting.protocolRequests>=state.plan.policy.maxProtocolRequests||accounting.cumulativeRequests>=state.plan.policy.maxCumulativeRequests)continue;
   const policy=checkpoint.policy;if(policy.roundTimeMs-(Date.now()-Date.parse(job.startedAt))<policy.requestWindowMs+policy.deliveryReserveMs){state.windowStopped=true;break;}
   assertIntranet(workspace.harness);for(const f of files)readOriginal(store,f);
   const modelFingerprint=modelConfigFingerprint(workspace.harness.modelConnection());
   const shape=JSON.stringify({rows:[{id:'真实目标id',disposition:'candidate 或 background 或 uncertain',reason:'必填简短理由',claims:[{text:'保留条件、例外、范围的原子事实或要求',evidence:[{unitId:'真实id',quote:'逐字短引文'}]}]}]});
   const instruction='每个focusId恰好一行，不能漏id。背景background和不确定uncertain的claims必须为[]，候选candidate逐条列claims。只引逐字原文，每个claim必须包含当前目标证据，可附context证据。网页按钮、公告元信息不构成需求变化。断句、表头、条件、例外、范围不明留待核，不猜人物日期或业务影响。表格末列“否”不可擅自解释为功能不支持。'+(group.phase==='audit'?'独立复核：只看原文，不接收第一遍候选或处置结果。':'');
   const args={kind:'targeted-supplement',instruction,shape,documents:[{id:base.id,name:'原任务未处置目标补查',focusIds:available.map(t=>t.id),units:[...available.map(t=>({...t,target:true})),...group.context.map(t=>({...t,contextOnly:true}))]}],recoveryRequest:()=>{const a=supplementRequestAccounting(store,state.plan);if(a.protocolRequests>=state.plan.policy.maxProtocolRequests||a.cumulativeRequests>=state.plan.policy.maxCumulativeRequests)throw Object.assign(Error('补查累计真实请求预算耗尽'),{code:'PROVIDER_BUDGET'});}};
   const audit=createAnalysisAudit(store,job,args),attempt={id:randomUUID(),taskId:job.id,phase:group.phase,groupId:group.id,modelCallId:audit.id,modelFingerprint,targetUnitIds:available.map(t=>t.id),startedAt:now(),status:'running'};state.attempts.push(attempt);
   for(const t of available){const stage=state.targets.find(x=>x.targetKey===t.targetKey);stage.attemptCount++;stage.status='running';}event(workspace,job,state,'batch_started',{attemptId:attempt.id});
   let raw,error,validation;
   try{
    raw=await workspace.analyze({...args,signal,audit,onEvent:(type,label,detail)=>log(label,detail)});signal.throwIfAborted();audit.submitted(raw);audit.finish();validation=validateSupplement(raw,available,group.context);
    const origin={kind:'new-inference',modelCallId:audit.id,taskId:job.id,modelFingerprint,newProviderRequests:1};accept(state,group.phase,validation,origin);state.receipts.push({phase:group.phase,groupId:group.id,origin,validation});attempt.status='returned';
   }catch(e){error=e;audit.finish(e);attempt.status='failed';attempt.error=errorRecord(e);}
   attempt.finishedAt=now();
   for(const t of available){const stage=state.targets.find(x=>x.targetKey===t.targetKey);if(stage.status!=='registered'){stage.status=stage.attemptCount>=state.plan.policy.maxAttemptsPerTarget?'failed':'needs_recovery';stage.lastError=error?errorRecord(error):{code:'INVALID_OR_MISSING_DISPOSITION',message:'原始返回已保留；目标/引用校验未通过'};}}
   event(workspace,job,state,'batch_finished',{attemptId:attempt.id,errors:validation?.errors||[],error:error?errorRecord(error):null});if(signal.aborted)throw signal.reason||error;
  }
  for(const f of files)readOriginal(store,f);save(workspace,job,state);await deliver(workspace,job,state,base,checkpoint);
  job.status='partial';job.summary=`补查处置 ${state.coverage.registeredTargets}/${state.coverage.totalTargets} 个子目标；新增候选 ${state.candidates.length} 条仍待语义核实。原任务与旧交付已完整保留。`;job.nextTrigger=state.canResume?'可继续尚未登记的补查目标':'语义/业务问题仍需核实；不得据处置登记宣称业务完成。';
  job.reliability.quality='partial';job.reliability.execution='finished';job.reliability.gates=[{id:'supplement-disposition',outcome:state.coverage.registeredTargets===state.coverage.totalTargets?'pass':'fail'},{id:'delivery-readback',outcome:'pass'},{id:'semantic-correctness',outcome:'not_verified'}];
 }catch(error){
  job.error=String(error.message||error).slice(0,800);job.status=signal.aborted||job.status==='cancelled'?'cancelled':'failed';job.reliability&&(job.reliability.quality=job.status==='cancelled'?'cancelled':'failed');event(workspace,job,state,'execution_failed',{error:errorRecord(error)});
 }finally{job.finishedAt=now();try{save(workspace,job,state);}finally{workspace.active.delete(job.id);store.save();}}
}
