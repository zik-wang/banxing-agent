import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {modelFailure,retryAfterSeconds} from '../v8-tools/model-failure.mjs';
import {chatApi,ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';
import {settleDelivery} from '../v8-tools/delivery-settlement.mjs';
import {runContractReview} from '../contract-review/harness.mjs';
import {WebWorkspace} from '../v8-web/server.mjs';

const msgs=[{role:'user',content:'Explicit synthetic transport test; no business content.'}];
const busy=()=>Response.json({error:{message:'IteraCompute capacity is temporarily exhausted',code:'provider_rate_limit'}},{status:429,headers:{'retry-after':'37'}});
function root(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'v8-model-feedback-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
const makeApi=(fetchImpl,extra={})=>chatApi({provider:'iteracompute',baseUrl:'https://synthetic.invalid/v1',model:'synthetic',fetchImpl,retryDelaysMs:[0,0],...extra});

test('historical capacity receipt is diagnosed without rewriting old evidence',()=>{
 const f=modelFailure({code:'MODEL_HTTP_ERROR',message:'Planning model HTTP 429',details:{responsePreview:JSON.stringify({error:{message:'IteraCompute capacity is temporarily exhausted',code:'provider_rate_limit'}})}});
 assert.equal(f.kind,'capacity');assert.equal(f.httpStatus,429);assert(f.message.includes('容量暂时不足'));
});

test('429 has one actual attempt, structured feedback and bounded Retry-After',async t=>{
 const dir=root(t),logs=path.join(dir,'model-responses');let calls=0;
 const api=makeApi(async()=>{calls++;return busy();},{logDirectory:logs});
 await assert.rejects(api(msgs,[],new AbortController().signal),e=>e.code==='MODEL_HTTP_ERROR'&&e.failure.kind==='capacity'&&e.failure.retryAfterSeconds===37&&!!e.failure.requestId);
 assert.equal(calls,1);assert.equal(api.metrics().retries,0);
 const p=JSON.parse(fs.readFileSync(path.join(dir,'model-responses','request-status.state')));assert.equal(p.state,'failed');assert.equal(p.failure.kind,'capacity');assert.equal(fs.readdirSync(logs).filter(n=>n.endsWith('.json')).length,1);
 assert.equal(retryAfterSeconds('not a date'),null);assert.equal(retryAfterSeconds('9999999'),86400);assert.equal(retryAfterSeconds(new Date(60000).toUTCString(),10000),50);
});

test('safe UI classification distinguishes service, account, auth and connection errors',()=>{
 for(const [status,kind]of [[429,'rate_limit'],[402,'quota'],[401,'authentication'],[403,'authentication'],[503,'unavailable'],[500,'http_error']]){
  const f=modelFailure({code:'MODEL_HTTP_ERROR',message:'Planning model HTTP '+status,details:{responsePreview:'<script>raw hostile body</script>'}});assert.equal(f.kind,kind);assert(!JSON.stringify(f).includes('<script>'));
 }
 assert.equal(modelFailure({code:'MODEL_REQUEST_TIMEOUT'}).kind,'timeout');assert.equal(modelFailure({code:'MODEL_NETWORK_ERROR'}).kind,'network');assert.equal(modelFailure({code:'MODEL_REQUEST_CANCELLED'}),null);
});

test('in-flight metadata exists before response and is cleared on success',async t=>{
 const dir=root(t),api=makeApi(async()=>{
  const s=JSON.parse(fs.readFileSync(path.join(dir,'model-responses','request-status.state')));assert.equal(s.state,'waiting_response');assert(s.requestId);assert(!JSON.stringify(s).includes('Explicit synthetic'));
  return Response.json({choices:[{message:{role:'assistant',content:'done'}}]});
 },{logDirectory:path.join(dir,'model-responses')});
 await api(msgs,[],new AbortController().signal);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'model-responses','request-status.state'))).state,'completed');
});

test('host request timeout is not misreported as a user cancellation',async t=>{
 const dir=root(t),signal=AbortSignal.timeout(30),api=makeApi(async(_u,o)=>new Promise((resolve,reject)=>{o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true});}),{timeoutMs:1000,logDirectory:path.join(dir,'model-responses')});
 await assert.rejects(api(msgs,[],signal),e=>e.code==='MODEL_REQUEST_TIMEOUT'&&e.failure.kind==='timeout');
 assert.equal(api.metrics().networkAttempts,1);assert.equal(api.metrics().retries,0);
});

test('agent stops after provider capacity error, retaining existing verified delivery',async t=>{
 const dir=root(t),p=path.join(dir,'retained.txt');fs.writeFileSync(p,'synthetic saved output');let calls=0;
 const artifact={artifactId:'saved',title:'已生成文本',path:p,sha256:'fixture-hash',kind:'text'},extras={initialArtifactIds:new Set(),artifacts:new Map([['saved',artifact]]),inspect:async()=>({exportIntegrityPassed:fs.readFileSync(p,'utf8')==='synthetic saved output'})};
 const docs={directory:dir,turnIntent:{kind:'create_file',formats:['txt']}};
 const harness=new ToolHarness({directory:dir,tools:[]}),api=makeApi(async()=>{calls++;return busy();});
 const r=await runToolAgent({harness,next:api,request:'synthetic failure after saved file',maxRounds:20,finalizeAnswer:(a,r)=>settleDelivery({docs,extras,records:{guardPresentation:text=>({text,corrections:[],ambiguous:[]})}},a,r)});
 assert.equal(calls,1);assert.equal(r.termination.error.failure.kind,'capacity');assert.equal(r.delivery.verifiedArtifacts.length,1);assert.equal(r.delivery.outcome,'partial');assert.equal(r.delivery.state,'partially_delivered');assert.equal(fs.readFileSync(p,'utf8'),'synthetic saved output');
});

test('contract special workflow does not retry capacity errors across topics or counter-review',{skip:!process.env.V8_PYTHON},async t=>{
 const dir=root(t);let calls=0;
 const next=makeApi(async()=>{calls++;return busy();});
 const r=await runContractReview({directory:path.join(dir,'review'),python:process.env.V8_PYTHON,chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'synthetic'},context:{contract_type:'equipment_purchase_cn',region:'中国大陆',stance:'buyer',stage:'pre_signing',guidance:''},inputs:[{role:'contract',path:path.resolve('tests/fixtures/contract-review/synthetic-equipment.docx')}],maxModelCalls:16,localReview:{enabled:false}},{next});
 assert.equal(calls,1);assert.equal(r.run.calls.length,1);assert.equal(r.run.model_failure.kind,'capacity');assert.equal(r.run.execution_status,'partial');assert(r.run.checks.every(c=>c.executionState!=='accepted'));assert(r.run.unresolved.some(x=>x.state==='service_unavailable'));assert(fs.existsSync(r.outputs.html));assert(fs.existsSync(r.outputs.text));
});

test('web API retains old-run diagnosis and exposes running request timing without raw model content',t=>{
 const dir=root(t),w=new WebWorkspace({dataRoot:path.join(dir,'data'),chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'synthetic'}}),c=w.newConversation(),own=w.conversation(c.id),d=path.join(dir,'run');fs.mkdirSync(d);
 const turn={id:'synthetic-turn',request:'synthetic test',status:'failed',directory:d,artifacts:[],termination:{reason:'model_error',error:{code:'MODEL_HTTP_ERROR',message:'Planning model HTTP 429',details:{responsePreview:'{"error":{"message":"capacity is temporarily exhausted"}}'}}}};own.turns.push(turn);
 assert.equal(w.view(c.id).turns.at(-1).serviceFailure.kind,'capacity');
 turn.status='running';fs.mkdirSync(path.join(d,'model-responses'));fs.writeFileSync(path.join(d,'model-responses','request-status.state'),JSON.stringify({state:'waiting_response',requestId:'synthetic-request',provider:'iteracompute',startedAt:new Date(Date.now()-40000).toISOString()}));
 let v=w.view(c.id).turns.at(-1);assert(v.progress.modelRequest.elapsedMs>=40000);assert.equal(v.progress.modelRequest.requestId,'synthetic-request');
 turn.status='failed';v=w.view(c.id).turns.at(-1);assert.equal(v.progress.modelRequest,undefined);
});

test('browser feedback separates capacity from timeout and does not hide verified files',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync('v8-web/model-feedback.js','utf8'),ctx);
 const esc=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=ctx.ModelFeedback.notice({id:'safe',canResume:true,artifacts:[{id:'saved'}],serviceFailure:modelFailure({message:'Planning model HTTP 429',details:{providerMessage:'capacity is temporarily exhausted'}})},esc);
 assert(html.includes('模型服务繁忙'));assert(html.includes('下方下载'));assert(html.includes('手动继续'));assert(!html.includes('Connection error'));
 assert.equal(ctx.ModelFeedback.waiting({status:'running',progress:{modelRequest:{elapsedMs:14000}}},esc),'');
 assert(ctx.ModelFeedback.waiting({status:'running',progress:{modelRequest:{provider:'iteracompute',elapsedMs:65000}}},esc).includes('1分5秒'));
 assert.equal(ctx.ModelFeedback.waiting({status:'failed',progress:{modelRequest:{elapsedMs:65000}}},esc),'');
});
