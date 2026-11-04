// Finite operator QA entry. Never run through sf-turn run: the candidate
// transport acquires its one shared request-level slot itself.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createChatApi} from '../v8-tools/model-transport.mjs';
import {apiKeyFor} from '../v8-tools/provider-config.mjs';
import {calculateMoney} from '../v8-tools/money-calculator.mjs';
import {PROMPT_VERSION,REVIEW_SYSTEM,validateReceiptReview} from './t2-receipt-verification.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),hash=value=>createHash('sha256').update(value).digest('hex');
const here=path.dirname(fileURLToPath(import.meta.url)),shared=path.resolve(here,'../../local-progress');
const {assertDispatchAllowed}=await import(pathToFileURL(path.join(shared,'control.mjs')).href);
const {withSiliconflowSlot}=await import(pathToFileURL(path.join(shared,'sf-turn.mjs')).href);
const {base}=await import(pathToFileURL(path.join(shared,'core.mjs')).href);
const [preflightPath,operatorPath,output]=process.argv.slice(2);
if(!preflightPath||!operatorPath||!output)throw Error('Usage: node scripts/t2-real-receipt-verify.mjs PREVIOUS_PREFLIGHT EXISTING_OPERATOR_PROFILE NEW_OUTPUT_DIRECTORY');
if(process.env.AFK_SILICONFLOW_WORKER||process.env.V8_SF_PROCESS_TEST||process.env.V8_TEST_LOOPBACK_ONLY)throw Error('NESTED_OR_TEST_CONTEXT_FORBIDDEN');
if(process.env.V8_SF_WORKER_ID&&process.env.V8_SF_WORKER_ID!=='worker-02')throw Error('WORKER_ID_MISMATCH');
if(process.env.V8_SF_SLOT_MODULE&&path.resolve(process.env.V8_SF_SLOT_MODULE)!==path.join(shared,'sf-turn.mjs'))throw Error('ALTERNATE_SLOT_MODULE_FORBIDDEN');
assertDispatchAllowed();
const preflight=read(preflightPath),operator=read(operatorPath),chat=operator.chat;
if(preflight.worker_id!=='worker-02'||preflight.classification!=='existing authorized synthetic')throw Error('PREFLIGHT_SCOPE_MISMATCH');
if(chat.provider!==preflight.model.provider||chat.baseUrl!==preflight.model.endpoint||chat.model!==preflight.model.model||chat.baseUrl!=='https://api.siliconflow.cn/v1')throw Error('APPROVED_MODEL_CONFIGURATION_CHANGED');
const casesBytes=fs.readFileSync(preflight.caseReference.path),financeBytes=fs.readFileSync(preflight.financeResultReference.path);
if(hash(casesBytes)!==preflight.caseReference.sha256||hash(financeBytes)!==preflight.financeResultReference.sha256)throw Error('REFERENCED_ARTIFACT_CHANGED');
const sourceCase=JSON.parse(casesBytes).find(c=>c.id===preflight.caseId);
const archived=JSON.parse(financeBytes).results.find(r=>r.caseId===preflight.caseId&&r.arm==='finance_collaboration');
if(sourceCase.kind!=='synthetic'||hash(sourceCase.source)!==preflight.sourceSha256||hash(sourceCase.request)!==preflight.requestSha256)throw Error('INPUT_SCOPE_OR_HASH_MISMATCH');
const receipt=calculateMoney(sourceCase.source,archived.finance.plan);
if(receipt.receiptId!==preflight.calculator.receiptId)throw Error('CALCULATOR_RECEIPT_CHANGED');
const getQueue=async()=>{const response=await fetch(base+'/api/siliconflow',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('SHARED_QUEUE_STATUS_UNAVAILABLE');return response.json();};
const queueBefore=await getQueue();
if(!queueBefore.dispatch_allowed||queueBefore.awaiting_drain_workers?.length)throw Error('SHARED_QUEUE_BARRIER_NOT_OPEN');
if(queueBefore.active||queueBefore.waiting?.length||queueBefore.cooldown_remaining_ms>0)throw Error('SHARED_QUEUE_BUSY_DEFER_WITHOUT_POLLING');
const apiKey=apiKeyFor(chat);if(typeof apiKey!=='string'||!apiKey.trim())throw Error('EXISTING_CREDENTIAL_NOT_AVAILABLE');
assertDispatchAllowed();fs.mkdirSync(output,{recursive:false});
const messages=[{role:'system',content:REVIEW_SYSTEM},{role:'user',content:JSON.stringify({scope:'prospective independent verification of archived host-orchestrated finance output; no production route completion implied',source:sourceCase.source,sourceSha256:preflight.sourceSha256,request:sourceCase.request,financePlan:archived.finance.plan,calculatorReceipt:receipt,archivedClaims:archived.output.claims})}];
fs.writeFileSync(path.join(output,'input-messages.json'),JSON.stringify(messages,null,2));
const result={status:'STARTING',scope:'prospective finite archived finance receipt verification',promptVersion:PROMPT_VERSION,promptSha256:hash(JSON.stringify(messages)),sourceSha256:preflight.sourceSha256,requestSha256:preflight.requestSha256,model:{provider:chat.provider,baseUrl:chat.baseUrl,model:chat.model,maxTokens:chat.maxTokens,enableThinking:chat.enableThinking,topP:chat.topP??'provider default',temperature:0.1,maxAttempts:1},queueBefore,slotReceipts:[],httpAttempts:0,queueLayerCount:1,expectedCNY:preflight.calculator.expectedCNY,calculatorActualCNY:receipt.results[0].amount,productionABtoAComplete:false,originalPromptByteIdenticalProven:false,startedAt:new Date().toISOString()};
result.modelConfigFingerprint=hash(JSON.stringify(result.model));
const save=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));save();
// The callback below observes the lease; it does not acquire a second lease.
const queue={workerId:'worker-02',withSlot:(worker,fn,options)=>withSiliconflowSlot(worker,async lease=>{result.slotReceipts.push({worker,requestId:lease.request_id,leaseId:lease.lease_id,grantedAt:new Date().toISOString()});save();return fn(lease);},options)};
const api=createChatApi({...chat,apiKey,maxAttempts:1,logDirectory:path.join(output,'model-responses'),siliconflowQueue:queue,onAttempt:()=>{assertDispatchAllowed();if(result.httpAttempts>=1)throw Error('SINGLE_VERIFY_HTTP_BUDGET_EXHAUSTED');result.httpAttempts++;save();}});
try{
 const message=await api(messages,[]);fs.writeFileSync(path.join(output,'model-message.json'),JSON.stringify(message,null,2));
 const content=message?.content;if(typeof content!=='string')throw Error('REVIEW_CONTENT_MISSING');
 const parsed=JSON.parse(content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));
 result.businessVerification=validateReceiptReview(parsed,{sourceSha256:preflight.sourceSha256,source:sourceCase.source,receipt});
 result.actualClaims=parsed.claims||null;result.decision=parsed.decision;result.status=result.businessVerification.passed?'FINITE_RECEIPT_VERIFY_PASSED':'FINITE_RECEIPT_VERIFY_NOT_PASSED';
}catch(e){result.status='STOPPED_WITH_ERROR';result.error={code:e.code||null,message:String(e.message).split(apiKey).join('[REDACTED]'),httpStatus:e.details?.httpStatus||e.status||null};}
finally{
 result.finishedAt=new Date().toISOString();result.metrics=api.metrics();
 try{result.queueAfter=await getQueue();}catch{result.queueAfterUnavailable=true;}
 const files=fs.existsSync(path.join(output,'model-responses'))?fs.readdirSync(path.join(output,'model-responses')).filter(n=>/\.\d\d\.json$/.test(n)):[];
 result.providerReceipts=files.map(name=>{const file=path.join(output,'model-responses',name),r=read(file);return {file:name,sha256:hash(fs.readFileSync(file)),requestId:r.requestId,httpStatus:r.httpStatus,usage:r.response?.usage||null,queueTiming:r.sfQueue||null,elapsedMs:r.elapsedMs};});
 save();
}
console.log(JSON.stringify({status:result.status,httpAttempts:result.httpAttempts,slotCount:result.slotReceipts.length,passed:result.businessVerification?.passed??false,errorCode:result.error?.code||null,resultPath:path.join(output,'result.json')}));
if(result.status!=='FINITE_RECEIPT_VERIFY_PASSED')process.exitCode=1;
