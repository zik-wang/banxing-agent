import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomic} from '../v8-tools/resource-space.mjs';
import {chatApi,validate} from '../v8-tools/harness.mjs';
import {modelFailure} from '../v8-tools/model-failure.mjs';
import {authorizeModelInput,loadModelCredentials} from './model-access.mjs';
import {loadReviewProfile,detectReviewType,profileScope} from './profiles.mjs';
import {contextSchema} from './schema.mjs';
import {compactResponseSchema,compactCrossSchema,compactVerifySchema,acceptCompactSubmission,acceptCompactVerification} from './compact-protocol.mjs';
import {fingerprint,requestIntent} from './protocol.mjs';
import {rulesCheck,wholeRef} from './rules.mjs';
import {evidenceIndex,bindEvidence} from './evidence.mjs';
import {groupReportIssues} from './grouping.mjs';
import {runLocalReview} from './local-review.mjs';
import {learningHints} from './learning.mjs';
import {exportReport} from './report.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
export function batchEvidence(units,maxChars=9000,maxUnits=100){const groups=[];let group=[],size=0;for(const u of units){if(group.length&&(size+u.raw_text.length>maxChars||group.length>=maxUnits)){groups.push(group);group=[];size=0;}group.push(u);size+=u.raw_text.length;}if(group.length)groups.push(group);return groups;}
const modelUnits=units=>units.map(u=>({id:u.id,text:u.raw_text,file_id:u.file_id,clause:u.clause_label,page:u.page,table_id:u.table_id,row:u.row,cell:u.cell}));
export function planReviewBudget({baselineBatches,crossBatches,maxCalls,recoveryReserve=1}){
 const phases={baseline:baselineBatches,cross:crossBatches,counter:1,recovery:recoveryReserve};
 return {maxCalls,phases,minimumWithoutRecovery:baselineBatches+crossBatches+1,plannedTotal:Object.values(phases).reduce((a,b)=>a+b,0),fits:baselineBatches+crossBatches+1<=maxCalls,policy:'One independent scan of each raw batch across loaded topics; cross/counter reserved before recovery. Insufficient budgets yield explicit pending scope, never larger limits.'};
}
export function candidateEvidenceScope(units,candidates,{profile,allIfUnder=32000}={}){
 if(units.reduce((n,u)=>n+u.raw_text.length,0)<=allIfUnder)return {units,selection:'full_original',unselectedIds:[]};
 const wanted=new Set(candidates.flatMap(f=>[...(f.evidence_refs||[]),...(f.counter_evidence_refs||[])].map(e=>e.unit_id))),patterns=[/担保|保函|例外|除非|除外|但|优先|生效|退款|解除|终止|起算|披露|适用范围|定义/,...(profile?.cross_checks||[]).map(c=>new RegExp(c.pattern))];
 const indices=new Set();units.forEach((u,i)=>{if(wanted.has(u.id)||patterns.some(p=>p.test(u.raw_text))){indices.add(i);if(i)indices.add(i-1);if(i+1<units.length)indices.add(i+1);}});
 return {units:units.filter((_,i)=>indices.has(i)),selection:'candidate_refs_plus_neighbors_and_global_safeguard_patterns',unselectedIds:units.filter((_,i)=>!indices.has(i)).map(u=>u.id),meaning:'Explicit retrieval scope; lexical retrieval may miss semantic variants. Not full-document counter-evidence proof.'};
}

export async function runProfileReview(config,{next,signal,onProgress}={},helpers){
 const directory=path.resolve(config.directory),context={contract_type:'equipment_purchase_cn',stance:'buyer',region:'中国大陆',stage:'pre_signing',signing_date:'',signing_date_verified:false,guidance:'',...config.context};validate(contextSchema,context);
 const access=authorizeModelInput(config,context),chat=loadModelCredentials(config.chat),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.timeoutMs||900000),activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 fs.mkdirSync(directory,{recursive:false});fs.mkdirSync(path.join(directory,'originals'));
 const maxCalls=config.maxModelCalls??12,run={run_id:randomUUID(),version:'contract-profile-harness-3',protocol_version:'compact-quotes-1',context,model_access:access,started_at:new Date().toISOString(),execution_status:'partial',review_conclusion:'材料或执行范围不足',files:[],documents:[],checks:[],findings:[],unresolved:[],warnings:[],calls:[],http_attempts:[],stages:[],recovery:[],scope_ledger:[],retained_fragments:[],quarantined:[],candidate_ledger:[],policy:{available:false,version:'none',items:[]},legal_retrieval:{available:false,state:'unavailable',sources:[]},benchmark:{independent_gold_count:0,precision:null,recall:null},test_material_label:config.testMaterialLabel||'',request_intent:requestIntent(context.guidance)};
 let index=new Map(),units=[],profile,fatal=false;
 const save=()=>{run.elapsed_ms=Date.now()-started;atomic(path.join(directory,'review-state.json'),run);onProgress?.({run_id:run.run_id,calls:run.calls.length,execution_status:run.execution_status,stages:run.stages,checks:run.checks.map(c=>({id:c.id,status:c.status,execution_state:c.execution_state})),modelFailure:run.model_failure||null});};
 const stage=(name,state,detail)=>{run.stages.push({name,state,detail,at:new Date().toISOString()});save();};
 try{
  if(!config.python)throw Error('PYTHON_REQUIRED');
  if(!Array.isArray(config.inputs)||config.inputs.filter(i=>i.role==='contract').length!==1)throw Error('EXACTLY_ONE_PRIMARY_CONTRACT_REQUIRED');
  for(const [i,input]of config.inputs.entries()){
   if(!['contract','attachment'].includes(input.role))throw Error('INVALID_INPUT_ROLE');
   const bytes=fs.readFileSync(input.path),hash=sha(bytes),copy=path.join(directory,'originals',i+'-'+path.basename(input.path));
   if(bytes.length>30*1024*1024)throw Error('INPUT_SIZE_LIMIT');if(access.destination==='approved_external_test'&&!access.input_sha256.includes(hash))throw Error('EXTERNAL_INPUT_CHANGED_AFTER_APPROVAL');
   fs.writeFileSync(copy,bytes,{flag:'wx'});const f={file_id:'F'+hash.slice(0,20),sha256:hash,name:input.name||path.basename(input.path),role:input.role,parse_status:'pending'};run.files.push(f);
   try{const d=await helpers.parseDocument(config.python,copy,{maxPages:config.maxPages||600,maxChars:config.maxChars||1200000,signal:activeSignal});Object.assign(f,{parse_status:d.parse_status,warnings:d.warnings});run.documents.push({...d,name:f.name,role:input.role,attachment_label:input.label||''});}catch(e){f.parse_status='failed';run.unresolved.push({code:'PARSE_FAILED',file_id:f.file_id,detail:e.message});}
  }
  stage('parse_document','finished',run.files);
  const evidenceDocs=helpers.makeEvidence(run.documents);units=evidenceDocs.flatMap(d=>d.units).filter(u=>u.raw_text.trim());index=evidenceIndex(evidenceDocs);run.evidence_units=[...index.values()];run.comments=evidenceDocs.flatMap(d=>d.comments||[]);atomic(path.join(directory,'evidence-ledger.json'),{offset_unit:'unicode_code_points',units:run.evidence_units});
  const detected=detectReviewType(evidenceDocs.filter(d=>d.role==='contract').flatMap(d=>d.units.map(u=>u.raw_text)).join('\n'),{profileFile:config.reviewProfileFile});
  const profileType=config.autoDetectProfile?detected:context.contract_type;
  profile=loadReviewProfile(profileType,config.reviewProfileFile);context.contract_type=profile.contract_type;run.review_profile=profile;run.rule_version=profile.id+'@'+profile.version;
  run.checks=profile.checks.map(c=>({...c,check_id:c.id,execution_state:'not_run',executionState:'pending',status:null,reviewOutcome:null,explanation:'尚未执行',evidence_refs:[],inspected_unit_ids:[],uninspected_unit_ids:units.map(u=>u.id),unresolved_questions:[],partReceipts:[]}));
  run.scope=profileScope(evidenceDocs,context,profile);stage('scope_gate',run.scope.state,run.scope);if(run.scope.state!=='supported'){run.unresolved.push({code:'UNSUPPORTED_OR_UNKNOWN_DOCUMENT_SCOPE',detail:run.scope.reason});return finish();}
  if(profile.contract_type==='basic_cn')run.warnings.push({code:'BASIC_PROFILE_ONLY',detail:profile.scope_description});
  if(context.signing_date_verified&&!/^\d{4}-\d{2}-\d{2}$/.test(context.signing_date)){context.signing_date_verified=false;run.unresolved.push({code:'SIGNATURE_DATE_NOT_PROVIDED'});}
  if(config.policyFile){const bytes=fs.readFileSync(config.policyFile),p=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(!Array.isArray(p.items)||typeof p.version!=='string')throw Error('POLICY_SCHEMA_INVALID');run.policy={available:!!p.items.length,version:p.version,items:p.items,source_sha256:sha(bytes),scope:'operator-supplied enterprise guidance, not law'};}
  const ruleResult=rulesCheck(evidenceDocs,context);run.rule_result={...ruleResult,topic_candidates:profile.checks.map(c=>({check_id:c.id,matched_unit_ids:units.filter(u=>new RegExp(c.pattern).test(u.raw_text)).map(u=>u.id),state:'retrieval_candidates_not_reviewed'}))};
  const program=ruleResult.findings.map(f=>({...f,check_ids:f.check_ids.map(id=>profile.program_check_map[id]).filter(Boolean)}));run.unmapped_program_candidates=program.filter(f=>!f.check_ids.length);if(run.unmapped_program_candidates.length)run.unresolved.push({code:'PROGRAM_CANDIDATES_OUTSIDE_PROFILE',detail:'程序候选保留但本配置没有对应专题：'+run.unmapped_program_candidates.map(f=>f.finding_id).join('、')});const programCandidates=program.filter(f=>f.check_ids.length);stage('check_rules','finished',{facts:ruleResult.facts.length,candidates:programCandidates.length,withheldFromIndependentScan:true});
  const system=fs.readFileSync(path.join(here,'prompts/profile-review.txt'),'utf8');fs.writeFileSync(path.join(directory,'actual-system-prompt.txt'),system);run.prompt_sha256=sha(system);run.input_fingerprint=fingerprint({files:run.files,context,profile:profile.sha256,prompt:run.prompt_sha256,policy:run.policy.source_sha256||null,protocol:run.protocol_version,model:chat.model,provider:chat.provider});
  const batches=batchEvidence(units,config.maxBatchChars||9000),crossScope=candidateEvidenceScope(units,programCandidates,{profile,allIfUnder:config.maxContextChars||60000}),crossBatches=batchEvidence(crossScope.units,config.maxContextChars||60000,500);run.budget_plan=planReviewBudget({baselineBatches:batches.length,crossBatches:crossBatches.length,maxCalls});run.budget_plan.contextBudgetChars=config.maxContextChars||60000;run.cross_scope={selection:crossScope.selection,unselectedIds:crossScope.unselectedIds};stage('budget_plan','planned',run.budget_plan);
  const api=next||chatApi({...chat,maxAttempts:1,logDirectory:path.join(directory,'model-responses'),onAttempt:({requestId,attempt})=>{if(run.http_attempts.length>=maxCalls)throw Error('HTTP_ATTEMPT_BUDGET_EXHAUSTED');run.http_attempts.push({requestId,attempt});},...(chat.structuredMode==='forced_tool'?{fetchImpl:(url,options)=>fetch(url,{...options,body:JSON.stringify({...JSON.parse(options.body),tool_choice:{type:'function',function:{name:'submit_contract_review'}}})})}:{})});
  run.model={provider:chat.provider,id:chat.model,quantization:chat.quantization||'unknown',sampling:{temperature:0.1},max_tokens:chat.maxTokens||5000,enable_thinking:chat.enableThinking??'unknown',structured_constraint:chat.structuredMode||'auto_tool',inference_backend:chat.inferenceBackend||'unknown',chat_template:chat.chatTemplate||'unknown'};
  async function ask(name,payload,verify=false,reservedAfter=0,minimumReserve=0){
   let pending=(payload.checks||[]).map(c=>c.check_id),pendingFindings=payload.findings||[],pendingComments=payload.original_comments||[],recoveryErrors=[];const aggregate=verify?{decisions:[],comments:[],complete:false}:{checks:[],findings:[],complete:false};
   for(let attempt=0;attempt<2;attempt++){
    if(fatal||activeSignal.aborted||run.calls.length>=maxCalls-minimumReserve||Date.now()-started>(config.timeoutMs||900000)-(config.deliveryReserveMs??5000)||(attempt&&maxCalls-run.calls.length<=reservedAfter))break;
    const request=attempt?{...payload,...(verify?{findings:pendingFindings,original_comments:pendingComments}:{checks:payload.checks.filter(c=>pending.includes(c.check_id)),preserved_candidates_readonly:aggregate.findings}),recovery:{pendingIds:verify?pendingFindings.map(f=>f.finding_id):pending,errors:recoveryErrors,meaning:'Only retry failed targets; accepted siblings are immutable. A conflict requires both real clauses; otherwise use an appropriate non-conflict category or retain uncertainty.'}}:payload;
    const cross=payload.phase==='cross_clause_review',schema=structuredClone(verify?compactVerifySchema:cross?compactCrossSchema:compactResponseSchema);if(!verify&&!cross)schema.properties.checks.items.properties.check_id.enum=request.checks.map(c=>c.check_id);
    const entry={call_id:randomUUID(),stage:name,attempt,status:'running',input_sha256:fingerprint(request),input_chars:JSON.stringify(request).length,target_ids:verify?pendingFindings.map(f=>f.finding_id):pending,started_at:new Date().toISOString()};run.calls.push(entry);
    const scopeReceipt={stage:name,callId:entry.call_id,sentUnitIds:request.target_units.map(u=>u.id),returnedCheckIds:[],state:'request_prepared',meaning:'Prepared/sent scope is not semantic correctness or understanding.'};run.scope_ledger.push(scopeReceipt);
    if(attempt)run.recovery.push({stage:name,targets:entry.target_ids,status:'started'});
    const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify({context:{...context,guidance:run.request_intent.businessGuidance},profile:{id:profile.id,version:profile.version,coverage:profile.scope_description},policy:run.policy,legal_retrieval:run.legal_retrieval,...request})}];atomic(path.join(directory,entry.call_id+'.input.json'),{messages,schema});save();
    try{
     const reply=await api(messages,[{name:'submit_contract_review',description:'Return compact review dispositions and exact unit-ID/quote evidence; never count characters.',inputSchema:schema}],AbortSignal.any([activeSignal,AbortSignal.timeout(Math.min(chat.timeoutMs||180000,Math.max(1000,(config.timeoutMs||900000)-(Date.now()-started)-5000)))]));atomic(path.join(directory,entry.call_id+'.raw.json'),reply);
     const raw=helpers.decodeReply(reply),identity={run_id:run.run_id,call_id:entry.call_id,attempt,inputFingerprint:entry.input_sha256};
     const accepted=verify?acceptCompactVerification(raw,index,request.findings,request.original_comments,identity):acceptCompactSubmission(raw,{index,checkIds:request.checks.map(c=>c.check_id),targets:request.target_units.map(u=>u.id),identity,priorFindings:aggregate.findings,cross});
     atomic(path.join(directory,entry.call_id+'.item-receipt.json'),accepted);run.retained_fragments.push({stage:name,identity,accepted});entry.status=accepted.complete?'validated':'partial_validated';entry.errors=accepted.errors;recoveryErrors=accepted.errors;
     if(verify){aggregate.decisions.push(...accepted.decisions);aggregate.comments.push(...accepted.comments);pendingFindings=payload.findings.filter(f=>!aggregate.decisions.some(v=>v.finding_id===f.finding_id));pendingComments=payload.original_comments.filter(c=>!aggregate.comments.some(v=>v.comment_id===c.audit_id));}
     else{aggregate.checks.push(...accepted.checks);aggregate.findings.push(...accepted.findings);pending=accepted.pendingIds;Object.assign(scopeReceipt,accepted.scope_receipt,{state:accepted.complete?'disposed':'partial_disposition'});run.quarantined.push(...accepted.quarantine);}
     if(accepted.complete){aggregate.complete=true;if(attempt)run.recovery.at(-1).status='recovered';break;}
     if(verify?!pendingFindings.length&&!pendingComments.length:!pending.length)break;
    }catch(e){entry.status='failed';entry.error=e.message;recoveryErrors=[{code:e.message}];scopeReceipt.state='failed';scopeReceipt.error=e.message;const failure=modelFailure(e);if(failure){run.model_failure=failure;fatal=true;} }
    finally{entry.finished_at=new Date().toISOString();save();}
   }
   if(!aggregate.complete){run.unresolved.push({code:'STAGE_INCOMPLETE',stage:name,pendingIds:verify?[...pendingFindings.map(f=>f.finding_id),...pendingComments.map(c=>c.audit_id)]:pending});if(run.recovery.at(-1)?.stage===name&&run.recovery.at(-1).status==='started')run.recovery.at(-1).status='unresolved';}
   return aggregate;
  }
  const parts=new Map(profile.checks.map(c=>[c.id,[]]));
  for(const [i,batch]of batches.entries()){
   const result=await ask('baseline-'+i,{phase:'independent_topic_review',checks:profile.checks.map(c=>({...c,check_id:c.id})),target_units:modelUnits(batch),instruction:'独立审核本批原文；不参考程序或本地模型候选及批注。所有本批专题需明确处置。scope_complete和未处理列表只声明本批处置范围，宿主不把其当作理解正确的证明。'},false,(batches.length-i-1)+crossBatches.length+1,Math.min(Math.max(0,maxCalls-1),crossBatches.length+1));
   for(const c of result.checks)parts.get(c.check_id).push(c);for(const f of result.findings)run.findings.push({...f,finding_id:'M'+run.findings.length});stage('baseline-'+i,result.complete?'reviewed':'partially_reviewed',{sentUnitIds:batch.map(u=>u.id),returnedChecks:result.checks.map(c=>c.check_id)});
  }
  for(const c of run.checks){const p=parts.get(c.id);c.inspected_unit_ids=[...new Set(p.flatMap(v=>v.inspected_unit_ids))];c.uninspected_unit_ids=units.map(u=>u.id).filter(id=>!c.inspected_unit_ids.includes(id));c.execution_state=p.length===batches.length&&!c.uninspected_unit_ids.length?'reviewed':p.length?'partially_reviewed':'not_run';c.executionState=c.execution_state==='reviewed'?'accepted':'pending';c.status=c.execution_state==='reviewed'?(p.some(v=>v.status==='risk_found')?'risk_found':p.some(v=>v.status==='insufficient_evidence')?'insufficient_evidence':p.every(v=>v.status==='not_applicable')?'not_applicable':'no_issue_found'):null;c.reviewOutcome=c.status;c.evidence_refs=p.flatMap(v=>v.evidence_refs);c.explanation=p.map(v=>v.explanation).join('\n');c.unresolved_questions=p.flatMap(v=>v.unresolved_questions);c.partReceipts=p.map(v=>v.receipt);}
  // Only after independent discovery, expose program and optional local candidates.
  run.findings.push(...programCandidates);
  run.rsi={activeRevision:config.learningRules?.revision||null,rules:(config.learningRules?.rules||[]).map(r=>({id:r.id,version:r.version,testReceiptId:r.testReceiptId})),hints:learningHints(config.learningRules,units),policy:'Activated rules create source-bound candidates after independent review; deterministic example matches do not prove semantic improvement.'};
  for(const hint of run.rsi.hints){const id=profile.checks.some(c=>c.id===hint.check_id)?hint.check_id:profile.program_check_map[hint.check_id],u=index.get(hint.unit_id);if(id&&u)run.findings.push({finding_id:'H'+run.findings.length,check_ids:[id],category:'待确认',priority:'需关注',priority_reason:'已启用反馈规则提出候选，仍需原文复核',title:'反馈规则候选 '+hint.ruleId,evidence_refs:[wholeRef(u)],explanation:hint.guidance,interpretation_space:'字符串触发不是语义确认，需寻找保障和反例。',suggestion:'依据原文和反例再确认是否需要修改。',business_parameters:[],unresolved_questions:[],origin:'feedback_rule',level:'candidate_risk',source_rule:hint});}
  const local=config.localReview?.enabled?await runLocalReview(config,units,directory,{signal:activeSignal,phase:'pre',runner:config.localRunner}):{status:'disabled',rows:[],required:false};run.local_review={enabled:!!config.localReview?.enabled,pre:local,post:{status:'not_applicable',rows:[],reason:'候选交由27B定向复核；未重复运行相同局部模型冒充独立意见。'}};
  if(config.localReview?.enabled&&local.status!=='completed')run.warnings.push({code:'OPTIONAL_LOCAL_PLUGIN_INCOMPLETE',detail:local.error||local.status});
  for(const row of local.rows||[])if(row.status==='candidate_only'&&row.signal?.risk){const id=profile.local_signal_checks[row.signal.category];if(id&&index.has(row.unitId))run.findings.push({finding_id:'L'+run.findings.length,check_ids:[id],category:'待确认',priority:'需关注',priority_reason:'可选局部模型提出信号，尚未由完整原文确认',title:row.signal.category+'（本地候选）',evidence_refs:[{unit_id:row.unitId,start:row.start,end:row.end}],explanation:'本地模型仅在此局部片段提出风险信号；不能据此排除远处保障或例外。',interpretation_space:'需27B结合其他条款定向裁定。',suggestion:'结合原文、保障和例外确认是否需要修改。',unresolved_questions:[],business_parameters:[],origin:'local_model',level:'candidate_risk',source_local_row:row.id});}
  for(const [i,batch]of crossBatches.entries()){
   const result=await ask('cross-'+i,{phase:'cross_clause_review',checks:profile.checks.map(c=>({...c,check_id:c.id})),cross_checks:profile.cross_checks,existing_candidates_readonly:run.findings.map(f=>({finding_id:f.finding_id,title:f.title,check_ids:f.check_ids,evidence_refs:f.evidence_refs})),target_units:modelUnits(batch),selection:run.cross_scope,instruction:'检查义务、触发、期限、条件、例外和优先顺序。条款冲突须同时引用双方。只返回新增的跨条款发现，不重复已有候选；无需重复全部专题处置。只能对本次发送原文得出结论，不以摘要作证。'},false,crossBatches.length-i,Math.min(1,Math.max(0,maxCalls-1)));
   for(const f of result.findings)run.findings.push({...f,finding_id:'X'+run.findings.length});stage('cross-'+i,result.complete?'reviewed':'partially_reviewed',{sentUnitIds:batch.map(u=>u.id),selection:crossScope.selection});
  }
  run.candidate_ledger=run.findings.map(f=>({finding_id:f.finding_id,origin:f.origin,source_local_row:f.source_local_row||null,originalCandidate:structuredClone(f),disposition:'pending'}));
  const verifyScope=candidateEvidenceScope(units,run.findings,{profile,allIfUnder:config.maxContextChars||60000});run.counter_scope={selection:verifyScope.selection,unselectedIds:verifyScope.unselectedIds};
  const groups=[];for(let i=0;i<run.findings.length;i+=24)groups.push(run.findings.slice(i,i+24));if(!groups.length&&run.comments.length)groups.push([]);
  run.budget_plan.realizedCounterCalls=groups.length;run.budget_plan.remainingCallsAtCounter=Math.max(0,maxCalls-run.calls.length);run.budget_plan.counterFitsRemaining=groups.length<=run.budget_plan.remainingCallsAtCounter;
  run.verification={decisions:[],comments:[],complete:true};
  if(!groups.length)stage('counter_evidence_review','not_applicable','No retained candidates or original comments to decide; not a claim of no contract risk.');
  for(const [i,candidates]of groups.entries()){
   const selected=candidateEvidenceScope(units,candidates,{profile,allIfUnder:config.maxContextChars||60000});
   if(selected.units.reduce((n,u)=>n+u.raw_text.length,0)>(config.maxContextChars||60000)){run.unresolved.push({code:'COUNTER_EVIDENCE_CONTEXT_PENDING',findingIds:candidates.map(f=>f.finding_id),unprocessedUnitIds:selected.units.map(u=>u.id)});run.verification.complete=false;continue;}
   const result=await ask('counter-'+i,{phase:'counter_evidence_and_original_comments',findings:candidates,original_comments:i===0?run.comments:[],target_units:modelUnits(selected.units),selection:{method:selected.selection,unselectedIds:selected.unselectedIds},instruction:'对所有来源的每个候选主动寻找足以推翻的保障、条件与例外。not_supported必须引用实际反证；不足则uncertain。不得因27B或小模型未发现而删除候选。原批注不是独立新发现。'},true,groups.length-i-1);
   run.verification.decisions.push(...result.decisions);run.verification.comments.push(...result.comments);run.verification.complete&&=result.complete;stage('counter-'+i,result.complete?'reviewed':'partially_reviewed',{findings:candidates.map(f=>f.finding_id),selection:selected.selection});
  }
  for(const f of run.findings){f.counter_review=run.verification.decisions.find(v=>v.finding_id===f.finding_id);f.evidence=bindEvidence(index,f.evidence_refs);const ledger=run.candidate_ledger.find(c=>c.finding_id===f.finding_id);ledger.disposition=f.counter_review?.decision||'unresolved';ledger.receipt=f.counter_review?.receipt||null;}
  for(const comment of run.verification.comments)if(comment.duplicate_of_finding_id){const f=run.findings.find(f=>f.finding_id===comment.duplicate_of_finding_id);if(f)(f.addresses_comment_ids??=[]).push(comment.comment_id);}
  for(const c of run.checks){c.baselineStatus=c.status;c.findingRefs=run.findings.filter(f=>f.check_ids.includes(c.id)).map(f=>f.finding_id);if(c.execution_state==='reviewed'&&run.findings.some(f=>f.check_ids.includes(c.id)&&f.counter_review?.decision!=='not_supported')){c.status='risk_found';c.reviewOutcome='risk_candidate';}}
  stage('validate_review','finished',{exactEvidence:true,semanticCorrectness:'not independently adjudicated',coverage:'sent and disposed ranges only'});
  return finish();
 }catch(e){run.unresolved.push({code:e.code||'HARNESS_ERROR',detail:e.message});return finish();}finally{clearTimeout(timer);}
 function finish(){
  run.unfinished_checks=run.checks.filter(c=>c.execution_state!=='reviewed').map(c=>c.id);const parsed=run.documents.some(d=>d.units.some(u=>u.raw_text.trim()));
  run.execution_status=parsed?(run.files.some(f=>f.parse_status!=='parsed')||run.unfinished_checks.length||run.unresolved.length||!run.checks.length?'partial':'complete'):'failed';
  run.review_conclusion=run.findings.some(f=>f.counter_review?.decision!=='not_supported')?'存在候选风险，需结合材料和业务复核':run.execution_status==='complete'?'已列专题范围未发现重大候选风险，非可签结论':'材料或执行范围不足';
  run.raw_findings=structuredClone(run.findings);run.report_groups=groupReportIssues(run.findings,run.evidence_units||[]);run.grouping_counts={raw_candidates:run.findings.length,report_main_issues:run.report_groups.length,scorable_independent_propositions:null};
  const folder=path.join(directory,'model-responses'),receipts=fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))):[];
  run.token_usage={known_total_tokens:receipts.reduce((n,r)=>n+(r.response?.usage?.total_tokens||0),0),unknown_response_count:receipts.filter(r=>!r.response?.usage).length,total_tokens:receipts.length&&receipts.every(r=>r.response?.usage)?receipts.reduce((n,r)=>n+r.response.usage.total_tokens,0):null,cost:'unknown'};
  run.protocol_metrics={logical_calls:run.calls.length,http_attempts:next?null:run.http_attempts.length,first_pass_accepted:run.calls.filter(c=>!c.attempt&&c.status==='validated').length,first_pass_total:run.calls.filter(c=>!c.attempt).length,recoveries:run.recovery,preserved_findings:run.findings.length,test_type:next?'injected_offline':'real_provider'};
  save();const outputs=exportReport(run,directory);atomic(path.join(directory,'review-result.json'),run);return {run,outputs,directory};
 }
}
