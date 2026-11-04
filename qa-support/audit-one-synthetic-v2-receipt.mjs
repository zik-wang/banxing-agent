// Read-only audit of one explicitly authorized synthetic evidence bundle.
// No credentials/configuration discovery, network, model request or production access.
// Usage: node <script> <repository> <authorized-evidence-root> <new-audit-directory>
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
const reportCommit='c30e33d1ce686c652f2bbc442314524b081d526c',candidate='f1d83df0d805529b8c0457acda279d2f3a2bfaee';
const allowedSource='5be70038ed3deef2307cf2e05ca7e89b79c199ecbaa6cdb44886357d708f5905',allowedRequest='a065ff5cf197dc6daf57a5a558ada4df15b4b632a7f4cae1486311577e4f998e';
const [repoArg,evidenceArg,outputArg]=process.argv.slice(2);
if(!repoArg||!evidenceArg||!outputArg)throw Error('Provide repository, authorized evidence root and new audit directory');
const repo=fs.realpathSync(repoArg),root=fs.realpathSync(evidenceArg),out=path.resolve(outputArg);
if(path.basename(root)!=='worker-02-t2-v2-real-verify-20261105-f9eb858c')throw Error('Evidence scope not authorized by this finite audit');
if(fs.existsSync(out)||out.startsWith(root+path.sep))throw Error('Do not overwrite evidence or modify the audited bundle');
fs.mkdirSync(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex'),git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:2*1024*1024});
const checks=[],files=[];let permissionBoundary;
const check=(name,condition)=>{checks.push({name,passed:!!condition});if(!condition)throw Object.assign(Error(name),{code:'EVIDENCE_INCONSISTENCY'});};
function guarded(relative){
 if(!/\.(?:json|state)$/.test(relative))throw Error('Only indexed JSON/state evidence allowed');
 const absolute=path.resolve(root,relative);
 if(!absolute.startsWith(root+path.sep)||fs.realpathSync(absolute)!==absolute)throw Error('Evidence path escape');
 const bytes=fs.readFileSync(absolute);if(bytes.length>1024*1024)throw Error('Unexpected evidence size');
 const text=bytes.toString('utf8');
 const deny=reason=>{permissionBoundary={file:relative,reason};throw Object.assign(Error('Stop reading this file: '+reason),{code:'PERMISSION_BOUNDARY'});};
 if(/\bsk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_./+-]{16,}/i.test(text))deny('credential-shaped bytes');
 const data=JSON.parse(text.replace(/^\uFEFF/,''));
 const walk=v=>{if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){
  if(/^(?:apiKey|authorization|accessToken|refreshToken|access_token|password|secret)$/i.test(k)&&typeof x==='string'&&x&&!/redacted|\*\*\*/i.test(x))deny('credential field');
  if(/classification/i.test(k)&&typeof x==='string'&&/private|confidential|company|internal/i.test(x))deny('private material classification');
  if(x&&typeof x==='object')walk(x);
 }};walk(data);files.push({path:relative,sha256:sha(bytes),bytes:bytes.length});return data;
}
function exactCents(value,unit){
 const scales={'元':1n,'万元':10000n,'亿元':100000000n},s=value.replaceAll('，','').replaceAll(',','');
 if(!/^-?\d+(?:\.\d+)?$/.test(s)||!Object.hasOwn(scales,unit))throw Error('Unsupported operand in this one-case audit');
 const negative=s.startsWith('-'),[whole,fraction='']=s.replace('-','').split('.'),denominator=10n**BigInt(fraction.length);
 const numerator=BigInt(whole+fraction)*scales[unit]*100n*(negative?-1n:1n);
 if(numerator%denominator!==0n)throw Error('This audit does not assume per-operand rounding for fractional cents');
 return numerator/denominator;
}
const amount=cents=>{const negative=cents<0n,n=negative?-cents:cents,s=String(n).padStart(3,'0');return(negative?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
const result={reportCommit,candidate,kind:'ONE_EXISTING_AUTHORIZED_SYNTHETIC_EXECUTION_AUDIT',newModelRequests:0,productionTouched:false,worker02WorktreeModified:false,checks,files};
try{
 const published=JSON.parse(git(['show',reportCommit+':docs/reports/2026-11-05-t2-v2-real-verify/results.json']).toString('utf8'));
 const frozen=guarded('frozen-conditions.json'),post=guarded('post-run-checks.json'),ready=guarded('fix-ready.json'),run=guarded('run/result.json');
 check('fixed_candidate_and_report',frozen.candidate===candidate&&post.candidate===candidate&&ready.fixedCandidate===candidate&&ready.commit===reportCommit);
 const messages=guarded('run/input-messages.json');check('two_message_input_type',Array.isArray(messages)&&messages.length===2&&messages[0].role==='system'&&messages[1].role==='user');
 const input=JSON.parse(messages[1].content);
 // Only this already-authorized synthetic text/request may pass beyond this gate.
 if(typeof input.source!=='string'||sha(input.source)!==allowedSource||typeof input.request!=='string'||sha(input.request)!==allowedRequest){permissionBoundary={file:'run/input-messages.json',reason:'source/request not the explicitly approved synthetic fingerprints'};throw Object.assign(Error('Unknown material: stop input processing'),{code:'PERMISSION_BOUNDARY'});}
 check('synthetic_source_and_request_fingerprints',input.sourceSha256===allowedSource&&run.sourceSha256===allowedSource&&run.requestSha256===allowedRequest&&frozen.sourceSha256===allowedSource&&frozen.requestSha256===allowedRequest);
 const promptHash=sha(JSON.stringify(messages));
 check('frozen_saved_run_and_public_prompt_match',[frozen,run,published,post,ready].every(x=>x.promptSha256===promptHash&&x.promptVersion==='t2-archived-finance-receipt-review-v2'));
 check('model_configuration_fingerprint_match',sha(JSON.stringify(run.model))===run.modelConfigFingerprint&&[frozen,published,post,ready].every(x=>x.modelConfigFingerprint===run.modelConfigFingerprint));
 check('frozen_model_exactly_matches_run_model',isDeepStrictEqual(frozen.model,run.model));
 check('model_and_request_cap',run.model.provider==='siliconflow'&&run.model.baseUrl==='https://api.siliconflow.cn/v1'&&run.model.model==='Qwen/Qwen3.8-27B'&&run.model.maxAttempts===1&&run.httpAttempts===1&&run.metrics.logicalRequests===1&&run.metrics.networkAttempts===1&&run.metrics.retries===0);
 const snapshot=path.join(out,'pure-code');
 for(const relative of ['scripts/t2-receipt-protocol-v2.mjs','scripts/t2-receipt-verification.mjs','v8-tools/money-calculator.mjs']){
  const target=path.join(snapshot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,git(['show',candidate+':'+relative]));
 }
 const fingerprints=frozen.files.map(entry=>{
  if(!/^(?:scripts|v8-tools)\/[a-zA-Z0-9_.-]+\.mjs$/.test(entry.file))throw Error('Unexpected frozen source reference');
  const bytes=git(['show',candidate+':'+entry.file]),lf=bytes.toString('utf8').replaceAll('\r\n','\n');
  const variants={gitBlob:sha(bytes),lf:sha(lf),crlf:sha(lf.replaceAll('\n','\r\n'))};
  const matched=Object.entries(variants).filter(([,hash])=>hash===entry.sha256).map(([domain])=>domain);
  check('frozen_code:'+entry.file,matched.length>0);return{file:entry.file,matchingRepresentations:matched};
 });
 const {calculateMoney}=await import(pathToFileURL(path.join(snapshot,'v8-tools/money-calculator.mjs')));
 const {buildReviewMessagesV2,validateIdentityEnvelope,validateReceiptReview}=await import(pathToFileURL(path.join(snapshot,'scripts/t2-receipt-protocol-v2.mjs')));
 const rebuilt=buildReviewMessagesV2({source:input.source,request:input.request,financePlan:input.financePlan,receipt:input.calculatorReceipt,archivedClaims:input.archivedClaims});
 check('messages_rebuilt_from_fixed_code_match_exactly',isDeepStrictEqual(rebuilt.messages,messages));
 check('five_domain_binding_in_same_saved_input',validateIdentityEnvelope({source:input.source,financePlan:input.financePlan,receipt:input.calculatorReceipt},input.sourceIdentity).passed&&isDeepStrictEqual(input.sourceIdentity,run.sourceIdentity)&&isDeepStrictEqual(input.sourceIdentity,rebuilt.identity));
 check('frozen_calculator_receipt_id',frozen.receiptId===input.calculatorReceipt.receiptId);
 check('one_indexed_provider_receipt',run.providerReceipts.length===1&&run.slotReceipts.length===1&&run.queueLayerCount===1);
 const reference=run.providerReceipts[0];
 if(!/^[a-f0-9-]{36}\.01\.json$/.test(reference.file))throw Error('Unexpected provider receipt reference');
 const providerRelative='run/model-responses/'+reference.file,provider=guarded(providerRelative),providerHash=files.find(f=>f.path===providerRelative).sha256;
 check('provider_receipt_hash_matches_index_and_publication',providerHash===reference.sha256&&providerHash===published.providerReceiptSha256&&providerHash===post.providerReceiptSha256);
 check('same_transport_request_id',provider.requestId===reference.requestId&&reference.file===provider.requestId+'.01.json'&&provider.attempt===1&&provider.phase==='complete'&&provider.networkRequestAttempted===true);
 check('complete_response_parses_to_logged_object',typeof provider.responseRaw==='string'&&isDeepStrictEqual(JSON.parse(provider.responseRaw),provider.response));
 const response=provider.response,message=guarded('run/model-message.json'),choice=response.choices?.[0];
 check('same_provider_message_and_model',typeof response.id==='string'&&!!response.id&&response.model===run.model.model&&provider.model===run.model.model&&provider.provider===run.model.provider&&isDeepStrictEqual(choice?.message,message));
 check('supplier_success_and_nontruncated_completion',provider.httpStatus===200&&reference.httpStatus===200&&choice.finish_reason==='stop'&&provider.sfQueue.bodyFullyConsumed===true&&reference.queueTiming.bodyFullyConsumed===true);
 check('usage_is_same_receipt',isDeepStrictEqual(response.usage,reference.usage)&&isDeepStrictEqual(response.usage,published.usage)&&response.usage.prompt_tokens+response.usage.completion_tokens===response.usage.total_tokens&&response.usage.total_tokens===3003);
 check('no_model_tools_in_frozen_input_log_or_output',Array.isArray(frozen.tools)&&frozen.tools.length===0&&Array.isArray(provider.visibleTools)&&provider.visibleTools.length===0&&!(message.tool_calls?.length)&&provider.messageCount===messages.length);
 const status=guarded('run/model-responses/request-status.state');
 check('same_completed_request_status',status.requestId===provider.requestId&&status.state==='completed'&&status.attempt===1);
 const start=Date.parse(run.startedAt),end=Date.parse(run.finishedAt),providerStart=Date.parse(provider.startedAt),grant=Date.parse(run.slotReceipts[0].grantedAt);
 check('execution_timestamps_consistent',Number.isFinite(start)&&Number.isFinite(end)&&start<=grant&&grant<=providerStart&&providerStart+provider.elapsedMs<=end+1000&&providerStart>=start);
 check('timings_match_and_are_separate',provider.sfQueue.queueWaitMs===reference.queueTiming.queueWaitMs&&provider.sfQueue.queueWaitMs===post.queueWaitMs&&provider.sfQueue.supplierRequestMs===post.supplierRequestMs&&provider.sfQueue.supplierRequestMs===reference.queueTiming.supplierRequestMs);
 check('queue_completion_consistent_but_not_business_proof',run.queueAfter.active===null&&run.queueAfter.granted_total-run.queueBefore.granted_total===1&&run.queueAfter.released_total-run.queueBefore.released_total===1);
 const review=JSON.parse(message.content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));
 const host=validateReceiptReview(review,{source:input.source,financePlan:input.financePlan,receipt:input.calculatorReceipt,identity:input.sourceIdentity});
 check('actual_model_verdict_is_verified',review.decision==='verified'&&run.decision===review.decision&&published.modelDecision===review.decision);
 check('deterministic_host_validation_matches_recorded_result',host.passed&&isDeepStrictEqual(host,run.businessVerification)&&published.businessPassed===host.passed&&post.businessPassed===host.passed);
 const receipt=calculateMoney(input.source,input.financePlan);
 check('recomputed_calculator_matches_supplied_receipt',isDeepStrictEqual(receipt,input.calculatorReceipt));
 check('three_selected_operands',receipt.bindings.length===3&&review.operand_checks.length===3&&receipt.operation==='sum');
 const seen=new Set(),operands=[];let total=0n;
 for(const row of review.operand_checks){
  const b=receipt.bindings[row.index];check('unique_operand_index:'+row.index,Number.isInteger(row.index)&&!!b&&!seen.has(row.index));seen.add(row.index);
  check('operand_bound_to_exact_source_and_receipt:'+row.index,row.supported===true&&['value','unit','currency','quote'].every(k=>row[k]===b[k])&&input.source.slice(b.start,b.end)===b.quote&&b.currency==='CNY'&&(!b.direction||b.direction==='add'));
  const cents=exactCents(row.value,row.unit);total+=cents;
  check('independent_unit_conversion:'+row.index,amount(cents)===row.yuan_value&&row.yuan_value===post.convertedYuan[row.index]);
  operands.push({index:row.index,value:row.value,unit:row.unit,currency:row.currency,yuanValue:row.yuan_value,quoteSha256:sha(row.quote),sourceSpan:{start:b.start,end:b.end}});
 }
 check('three_exact_cny_conversions',operands.map(o=>o.yuanValue).join('|')==='125000000.00|3600000.00|48000.00');
 check('independent_total_and_final_receipt_reference',amount(total)==='128648000.00'&&receipt.results[0].amount===amount(total)&&review.receiptId===receipt.receiptId&&review.sourceSha256===allowedSource&&review.claims.length===1&&review.claims[0].receiptId===receipt.receiptId&&review.claims[0].currency==='CNY'&&review.claims[0].amount===amount(total)&&isDeepStrictEqual(review.claims,run.actualClaims));
 check('model_reported_no_missing_components_only',Array.isArray(review.missing_components)&&review.missing_components.length===0);
 const v1path='docs/reports/2026-11-05-t2-real-verify/results.json';
 check('v1_public_evidence_blob_unchanged',git(['rev-parse','23d342172e724997fb4232e53bfae31ff95d6b22:'+v1path]).toString().trim()===git(['rev-parse',reportCommit+':'+v1path]).toString().trim());
 const v1data=JSON.parse(git(['show',reportCommit+':'+v1path]).toString('utf8'));
 check('v1_not_verified_remains',v1data.status==='FINITE_RECEIPT_VERIFY_NOT_PASSED'&&v1data.modelDecision==='rejected');
 const domains=['sourceRawUtf8','sourceJsonStringUtf8','financePlanJson','calculatorReceiptJson','receiptCoreJson'];
 const domainMentions=domains.filter(name=>review.explanation.includes(name));
 result.status='CONSISTENT_FINITE_SYNTHETIC_EXECUTION';
 result.promptSha256=promptHash;result.modelConfigFingerprint=run.modelConfigFingerprint;result.providerReceiptSha256=providerHash;
 result.ids={transportRequestId:provider.requestId,providerCompletionId:response.id,calculatorReceiptId:receipt.receiptId,queueRequestId:run.slotReceipts[0].requestId,leaseId:run.slotReceipts[0].leaseId};
 result.execution={startedAt:run.startedAt,finishedAt:run.finishedAt,model:response.model,httpStatus:provider.httpStatus,finishReason:choice.finish_reason,usage:response.usage,visibleTools:provider.visibleTools,queueWaitMs:provider.sfQueue.queueWaitMs,supplierRequestMs:provider.sfQueue.supplierRequestMs,bodyFullyConsumed:true};
 result.codeFingerprints=fingerprints;result.operands=operands;result.independentTotalCNY=amount(total);
 result.propositions={modelVerified:true,hostRulesPassed:true,hostFiveDomainInputBindingVerified:true,modelExplicitFiveDomainExplanation:'UNVERIFIED',exactDomainNamesInExplanation:domainMentions,overallSourceCompleteness:'UNVERIFIED',historicalCauseUniqueness:'UNVERIFIED',productionABtoA:'UNVERIFIED',userAcceptance:false};
 result.limits=['Local saved evidence and fixed-code consistency, not signed vendor attestation of input bytes or weights.','No inference from lease settlement alone to business success.','Model missing_components=[] is a model report, not a proof that unknown materials have no omissions.','Raw source, messages and full model content remain in the authorized original bundle; audit output contains metadata only.','Original v1 provider response not re-read; its public failure evidence is preserved.'];
}catch(error){result.status=error.code==='PERMISSION_BOUNDARY'?'BLOCKED_PERMISSION_BOUNDARY':'EVIDENCE_NEEDS_REVIEW';result.error={code:error.code||error.name,message:error.message};if(permissionBoundary)result.permissionBoundary=permissionBoundary;process.exitCode=1;}
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,checksPassed:checks.filter(c=>c.passed).length,checksFailed:checks.filter(c=>!c.passed).length,error:result.error,newModelRequests:0,promptSha256:result.promptSha256,totalCNY:result.independentTotalCNY,propositions:result.propositions}));
