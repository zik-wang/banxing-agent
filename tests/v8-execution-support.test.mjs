import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ExecutionSupport,executionScope} from '../v8-tools/execution-support.mjs';
import {ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';
import {compactHistory} from '../v8-tools/draft-delivery.mjs';

const source={id:'s',sha256:'original-version'};
const scope=()=>executionScope({request:'authorized task',sources:[source]});
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'execution-support-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const support=new ExecutionSupport({directory,scopeKey:scope(),...options});
 const tools=[{name:'read_page',description:'Read authorized page',inputSchema:{type:'object',properties:{page:{type:'integer',minimum:1,maximum:3}},required:['page'],additionalProperties:false},execute:a=>({sourceId:'s',text:'page '+a.page+' '+ 'source content '.repeat(500)})},...support.tools()];
 const harness=new ToolHarness({directory,tools,maxCalls:40});harness.executionRepair=true;harness.executionSupport=support;
 return{directory,support,harness};
}

test('persisted receipt supports exact pointer recovery and restart without re-executing its source tool',async t=>{
 const x=fixture(t),read=await x.harness.execute('read_page',{page:1});
 const reopened=new ExecutionSupport({directory:x.directory,scopeKey:scope()});
 const first=reopened.read({call_id:read.callId,pointer:'/data/text',offset:0,length:13});
 assert.equal(first.text,read.data.text.slice(0,13));assert.equal(first.nextOffset,13);assert.equal(first.historicalReceipt,true);
 const found=reopened.read({call_id:read.callId,pointer:'/data/text',offset:0,length:20,query:'source content'});assert.equal(found.matched,undefined);assert.ok(found.start>0);
 assert.equal(x.harness.actualExecutions,1);
});

test('receipt lookup rejects traversal, unknown scopes, tampering and changed current source permissions',async t=>{
 let allowed=true;const x=fixture(t,{authorize:()=>{if(!allowed)throw Object.assign(Error('source changed'),{code:'ASSET_CHANGED'});}}),r=await x.harness.execute('read_page',{page:1});
 assert.throws(()=>x.support.read({call_id:'../receipts/secret'}),{code:'UNKNOWN_TOOL_RECEIPT'});
 const other=new ExecutionSupport({directory:x.directory,scopeKey:executionScope({request:'other task',sources:[source]})});
 assert.throws(()=>other.read({call_id:r.callId}),{code:'UNKNOWN_TOOL_RECEIPT'});
 allowed=false;assert.throws(()=>x.support.read({call_id:r.callId}),{code:'ASSET_CHANGED'});allowed=true;
 const file=path.join(x.support.receiptDirectory,r.callId+'.json'),stored=JSON.parse(fs.readFileSync(file));stored.receipt.data.text='tampered';fs.writeFileSync(file,JSON.stringify(stored));
 assert.throws(()=>x.support.read({call_id:r.callId}),{code:'TOOL_RECEIPT_CHANGED'});
});

test('local-only outputs cannot bypass cloud policy through historical receipts',async t=>{
 const x=fixture(t,{canRecover:()=>false}),r=await x.harness.execute('read_page',{page:1});
 const recovered=await x.harness.execute('read_tool_receipt',{call_id:r.callId});assert.equal(recovered.error.code,'LOCAL_ONLY_RESULT');assert.equal(recovered.data,undefined);
});

test('include_recent controls real state content without mutating the host snapshot',t=>{
 const snapshot={recentCalls:[{callId:'actual-call'}],artifacts:[]},x=fixture(t,{snapshot:()=>snapshot});
 assert.equal(x.support.state({include_recent:false}).recentCalls,undefined);
 assert.equal(x.support.state({include_recent:true}).recentCalls[0].callId,'actual-call');
 assert.equal(snapshot.recentCalls.length,1);
});

test('a plan copied from another task is rejected instead of restoring stale completion state',async t=>{
 const x=fixture(t);await x.harness.execute('update_plan',{steps:[{id:'p',step:'Read material',status:'pending'}]});
 const scopeKey=executionScope({request:'different request',sources:[source]}),other=new ExecutionSupport({directory:x.directory,scopeKey});
 fs.copyFileSync(x.support.planFile,other.planFile);
 assert.throws(()=>new ExecutionSupport({directory:x.directory,scopeKey}),{code:'PLAN_SCOPE_CHANGED'});
});

test('completed plan steps require successful real business evidence and survive restart',async t=>{
 const x=fixture(t);let r=await x.harness.execute('update_plan',{steps:[{id:'read',step:'Read source',status:'completed'}]});assert.equal(r.error.code,'PLAN_EVIDENCE_REQUIRED');
 const metadata=await x.harness.execute('get_execution_state',{include_recent:true});assert.equal(metadata.status,'ok');
 r=await x.harness.execute('update_plan',{steps:[{id:'read',step:'Read source',status:'completed',evidence_call_ids:[metadata.callId]}]});assert.equal(r.error.code,'PLAN_EVIDENCE_REQUIRED');
 r=await x.harness.execute('update_plan',{steps:[{id:'read',step:'Read source',status:'completed',evidence_call_ids:[randomUUID()]}]});assert.equal(r.error.code,'UNKNOWN_TOOL_RECEIPT');
 const evidence=await x.harness.execute('read_page',{page:1});
 r=await x.harness.execute('update_plan',{steps:[{id:'read',step:'Read source',status:'completed',evidence_call_ids:[evidence.callId]},{id:'write',step:'Write result',status:'pending'}]});assert.equal(r.status,'ok');assert.equal(r.data.contentVerified,false);
 const reopened=new ExecutionSupport({directory:x.directory,scopeKey:scope()});assert.equal(reopened.state().plan.steps[0].evidence_call_ids[0],evidence.callId);
 assert.throws(()=>reopened.update({steps:[],expected_version:0}),{code:'PLAN_VERSION_CHANGED'});
});

test('plan state cannot inflate useful results or erase a repeated-source evidence boundary',async t=>{
 const x=fixture(t);for(let i=0;i<4;i++)await x.harness.execute('read_page',{page:1});
 const streak=x.harness.evidenceProgress.streak,noProgress=x.harness.noProgress,usable=x.harness.usableResults;
 await x.harness.execute('update_plan',{steps:[{id:'p',step:'Consider next step',status:'in_progress'}]});
 await x.harness.execute('get_execution_state',{include_recent:true});
 assert.equal(x.harness.evidenceProgress.streak,streak);assert.ok(x.harness.noProgress>noProgress);assert.equal(x.harness.usableResults,usable);
});

test('invalid arguments return the actual registered schema without invoking the handler',async t=>{
 const x=fixture(t),bad=await x.harness.execute('read_page',{page:'one'});assert.equal(bad.error.code,'INVALID_ARGUMENT');
 assert.equal(bad.error.recovery.tool_schema.inputSchema.properties.page.type,'integer');assert.equal(x.harness.actualExecutions,0);
 const repeated=await x.harness.execute('read_page',{page:'one'});assert.equal(repeated.error.code,'REPEATED_FAILURE_LIMIT');assert.equal(repeated.error.recovery.retryable_without_change,false);
 assert.equal((await x.harness.execute('read_page',{page:1})).status,'ok');assert.equal(x.harness.actualExecutions,1);
 const unknown=await x.harness.execute('made_up_tool',{});assert.equal(unknown.error.code,'UNKNOWN_TOOL');assert.ok(unknown.error.recovery.available_tools.includes('read_page'));
});

test('compacted results retain protocol pairs and a working tool-receipt recovery instruction',async t=>{
 const x=fixture(t),messages=[];for(let page=1;page<=3;page++){const r=await x.harness.execute('read_page',{page});messages.push({role:'assistant',tool_calls:[{id:'c'+page}]},{role:'tool',tool_call_id:'c'+page,content:JSON.stringify(r)});}
 compactHistory(messages,x.directory,{receiptReader:'read_tool_receipt',maxRetainedChars:1000});assert.equal(messages.length,6);
 const compressed=JSON.parse(messages[1].content);assert.equal(compressed.contextReceipt.retrieve.tool,'read_tool_receipt');
 const recovered=await x.harness.execute('read_tool_receipt',{...compressed.contextReceipt.retrieve.arguments,pointer:'/data/text',length:100});
 assert.equal(recovered.status,'ok');assert.match(recovered.data.text,/page 1/);assert.ok(recovered.data.nextOffset);
});

test('small multi-source evidence remains visible after later tools without receipt recovery loops',async t=>{
 const x=fixture(t);let round=0;
 const tool=page=>({id:'page-'+page,type:'function',function:{name:'read_page',arguments:JSON.stringify({page})}});
 const result=await runToolAgent({harness:x.harness,request:'Compare all three authorized pages',maxRounds:4,next:async messages=>{
  round++;
  if(round===1)return{role:'assistant',tool_calls:[1,2,3].map(tool)};
  for(const page of [1,2,3])assert(messages.some(m=>m.role==='tool'&&m.content.includes('page '+page+' source content')),'already-read source '+page+' disappeared');
  if(round===2)return{role:'assistant',tool_calls:[{id:'state',type:'function',function:{name:'get_execution_state',arguments:'{"include_recent":false}'}}]};
  return{role:'assistant',content:'Comparison retains the three source qualifications.'};
 }});
 assert.equal(result.status,'model_finished');assert.equal(result.metrics.modelRequests,3);assert.equal(x.harness.history.filter(r=>r.tool==='read_tool_receipt').length,0);
 assert.equal(fs.existsSync(path.join(x.directory,'context-compaction.jsonl')),false);
});

test('over-budget compaction removes oldest seen payloads and recovers exact source text',async t=>{
 const x=fixture(t),messages=[];
 for(let i=0;i<7;i++){const r=await x.harness.execute('read_page',{page:1+i%3});messages.push({role:'assistant',tool_calls:[{id:'p'+i}]},{role:'tool',tool_call_id:'p'+i,content:JSON.stringify(r)});}
 const original=JSON.parse(messages[1].content);compactHistory(messages,x.directory,{receiptReader:'read_tool_receipt'});
 assert.equal(messages.length,14);assert(JSON.parse(messages[1].content).contextReceipt);assert(!JSON.parse(messages.at(-1).content).contextReceipt);
 assert(messages.filter(m=>m.role==='tool').reduce((n,m)=>n+m.content.length,0)<=48000);
 const hint=JSON.parse(messages[1].content).contextReceipt.retrieve;
 assert.equal(hint.arguments.pointer,'/data/text');
 const recovered=x.support.read({...hint.arguments,length:12000});assert.equal(recovered.text,original.data.text);
});

test('agent can use schema feedback to recover rather than replay an invalid call',async t=>{
 const x=fixture(t);let round=0;
 const run=await runToolAgent({harness:x.harness,request:'read page',maxRounds:4,next:async messages=>{
  round++;if(round===1)return{role:'assistant',tool_calls:[{id:'bad',function:{name:'read_page',arguments:'{"page":"1"}'}}]};
  if(round===2){assert.equal(JSON.parse(messages.at(-1).content).error.recovery.tool_schema.inputSchema.properties.page.type,'integer');return{role:'assistant',tool_calls:[{id:'good',function:{name:'read_page',arguments:'{"page":1}'}}]};}
  return{role:'assistant',content:'Read completed; source semantics remain unverified.'};
 }});assert.equal(run.status,'model_finished');assert.equal(x.harness.actualExecutions,1);assert.equal(run.calls,2);
});

test('production CLI registers execution support and returns host state through the real agent loop',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'execution-cli-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let requests=0;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
  let message;
  if(requests===1){const tool=body.tools.find(t=>t.function.name==='get_execution_state');assert.deepEqual(tool.function.parameters.required,['include_recent']);message={role:'assistant',tool_calls:[{id:'state-call',type:'function',function:{name:'get_execution_state',arguments:'{"include_recent":true}'}}]};}
  else{const state=JSON.parse(body.messages.at(-1).content);assert.equal(state.status,'ok');assert.equal(state.data.plan.version,0);assert.equal(state.data.metaOnly,true);message={role:'assistant',content:'实际执行状态已读取；没有生成业务文件。'};}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message,finish_reason:'stop'}]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const config={directory:path.join(directory,'run'),python:process.env.V8_PYTHON||process.execPath,request:'只回答执行状态，不生成文件。',inputs:[],executionRepair:true,chat:{provider:'intranet',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'test-fixture',maxAttempts:1,timeoutMs:5000},maxRounds:4,timeoutMs:15000};
 const file=path.join(directory,'operator.json');fs.writeFileSync(file,JSON.stringify(config));
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../v8-tools/run.mjs',import.meta.url)),file],{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(code):reject(Error(error)));});
 assert.equal(code,0);assert.equal(requests,2);const run=JSON.parse(fs.readFileSync(path.join(directory,'run/agent-run.json')));assert.equal(run.status,'model_finished');assert.equal(run.metrics.businessToolAttempts,1);
 const receiptDirs=fs.readdirSync(path.join(directory,'run/execution-support'));assert.equal(receiptDirs.length,1);assert.equal(fs.readdirSync(path.join(directory,'run/execution-support',receiptDirs[0],'receipts')).length,1);
});
