import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ToolHarness,runToolAgent,chatApi} from '../v8-tools/harness.mjs';
import {DocumentTools,imageQuality} from '../v8-tools/document-tools.mjs';

function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'v8-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }
const shape={type:'object',properties:{value:{type:'integer',minimum:1,maximum:10}},required:['value'],additionalProperties:false};
test('large tool registries expose discovery first and activate only a bounded subset',async t=>{
 const tools=Array.from({length:50},(_,i)=>({name:'utility_'+i,description:'general helper '+i,inputSchema:shape,execute:async a=>a}));
 const h=new ToolHarness({directory:fixture(t),tools,maxVisibleTools:8});assert.deepEqual(h.listTools().map(t=>t.name),['discover_tools']);
 const r=await h.execute('discover_tools',{query:'',offset:0});assert.equal(r.data.tools.length,6);assert.equal(r.data.nextOffset,6);assert.equal(h.listTools().length,7);
 await h.execute('discover_tools',{query:'utility_49'});assert(h.listTools().some(t=>t.name==='utility_49'));assert(h.listTools().length<=8);
 assert.equal((await h.execute('utility_49',{value:3})).data.value,3);
});
test('schema errors do not reach the handler; unrelated tools use the same harness',async t=>{
 let effects=0;const h=new ToolHarness({directory:fixture(t),tools:[{name:'count',description:'Count',inputSchema:shape,execute:async a=>{effects++;return a;}}]});
 assert.equal((await h.execute('count',{value:2,arbitrary:true})).error.code,'INVALID_ARGUMENT');
 assert.equal((await h.execute('count',{value:0})).error.code,'INVALID_ARGUMENT');
 assert.equal(effects,0);assert.equal((await h.execute('count',{value:3})).data.value,3);assert.equal(effects,1);
});
test('tool budget stops further effects and cancellation is explicit',async t=>{
 let effects=0;const ac=new AbortController();const h=new ToolHarness({directory:fixture(t),signal:ac.signal,maxCalls:1,tools:[{name:'count',inputSchema:shape,execute:async()=>++effects}]});
 await h.execute('count',{value:1});assert.equal((await h.execute('count',{value:1})).error.code,'CALL_BUDGET_EXHAUSTED');assert.equal(effects,1);
 ac.abort();assert.equal((await h.execute('count',{value:1})).error.code,'CANCELLED');
});
test('MCP result adapter exposes errors as errors, without changing tools',async t=>{
 const h=new ToolHarness({directory:fixture(t),tools:[]});const r=await h.mcpCall('missing',{});assert.equal(r.isError,true);assert.equal(r.structuredContent.error.code,'UNKNOWN_TOOL');
});
test('agent loop returns errors to the policy and allows a different next tool',async t=>{
 const h=new ToolHarness({directory:fixture(t),tools:[{name:'alternative',description:'generic',inputSchema:shape,execute:async a=>a}]});let calls=0;
 const result=await runToolAgent({harness:h,request:'test',next:async messages=>{
  calls++;if(calls===1)return {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'missing',arguments:'{}'}}]};
  if(calls===2){assert.equal(JSON.parse(messages.at(-1).content).error.code,'UNKNOWN_TOOL');return {role:'assistant',content:null,tool_calls:[{id:'c2',type:'function',function:{name:'alternative',arguments:'{"value":2}'}}]};}
  assert.equal(JSON.parse(messages.at(-1).content).data.value,2);return {role:'assistant',content:'finished'};
 }});assert.equal(result.calls,2);assert.equal(result.contentVerified,false);
});
test('synthetic repeated output and length are flagged, not certified',()=>{
 const q=imageQuality(Array(20).fill('>80 >80 >80 >80').join('\n'),'length');assert(q.warnings.includes('REPETITIVE_OUTPUT'));assert(q.warnings.includes('OUTPUT_TRUNCATED'));assert.equal(q.contentVerified,false);
 assert(imageQuality('','stop').warnings.includes('EMPTY_OUTPUT'));
});
test('provider thinking settings are opt-in and truncated raw receipts survive failure',async t=>{
 const folder=fixture(t),sent=[];
 const fetchImpl=async (_url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{role:'assistant',content:''}}],usage:{completion_tokens:7000,completion_tokens_details:{reasoning_tokens:7000}}}),{status:200});};
 await assert.rejects(chatApi({baseUrl:'http://fixture.invalid/v1',model:'fixture',fetchImpl,logDirectory:folder})([],[],new AbortController().signal),e=>e.code==='MODEL_OUTPUT_TRUNCATED');
 assert.equal('chat_template_kwargs' in sent[0],false);
 await assert.rejects(chatApi({baseUrl:'http://fixture.invalid/v1',model:'fixture',enableThinking:false,maxTokens:7000,fetchImpl,logDirectory:folder})([],[],new AbortController().signal),e=>e.code==='MODEL_OUTPUT_TRUNCATED');
 assert.equal(sent[1].chat_template_kwargs.enable_thinking,false);assert.equal(sent[1].max_tokens,7000);
 const receipts=fs.readdirSync(folder).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8')));assert.equal(receipts.length,2);assert(receipts.every(r=>r.response.usage.completion_tokens_details.reasoning_tokens===7000));
});
test('PDF input is rejected locally before making any vision network request',async t=>{
 const root=fixture(t),pdf=path.join(root,'source.pdf');fs.writeFileSync(pdf,'%PDF-1.7\n');let posts=0;
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[pdf],python:process.execPath,fetchImpl:async()=>{posts++;throw Error('should not call');}});
 const h=new ToolHarness({directory:docs.directory,tools:docs.tools()});const id=[...docs.assets.keys()][0];
 const r=await h.execute('vision_extract',{asset_id:id,question:'read'});assert.equal(r.error.code,'INPUT_TYPE_UNSUPPORTED');assert.equal(r.error.details.origin,'local_preflight');assert.equal(posts,0);
 assert.equal((await h.execute('inspect_material',{asset_id:'arbitrary'})).error.code,'UNKNOWN_ASSET');
});

const python=process.env.V8_PYTHON,pdf=process.env.V8_TEST_PDF;
test('real PDF render and split recover from an injected API 413, with provenance', {skip:!python||!pdf},async t=>{
 const root=fixture(t);let posts=0;
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[pdf],python,vision:{baseUrl:'http://fixture.invalid/v1',model:'fixture'},fetchImpl:async()=>{
  posts++;return posts===1?new Response(JSON.stringify({error:'image too large'}),{status:413}):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'fixture response, not a live model'}}]}),{status:200});
 }});
 const h=new ToolHarness({directory:docs.directory,tools:docs.tools()});const id=[...docs.assets.keys()][0];
 const inspected=await h.execute('inspect_material',{asset_id:id});assert.equal(inspected.data.pages,156);
 const a=await h.execute('render_pdf_page',{asset_id:id,page:12}),b=await h.execute('render_pdf_page',{asset_id:id,page:13});
 assert.equal(a.status,'ok');assert.equal(b.status,'ok');assert.notEqual(a.data.sha256,b.data.sha256);assert.equal(b.data.page,13);
 const large=await h.execute('vision_extract',{asset_id:a.data.id,question:'read'});assert.equal(large.error.code,'INPUT_TOO_LARGE');assert.equal(large.error.details.origin,'upstream_api');
 const split=await h.execute('split_image',{asset_id:a.data.id,tile_width:1000,tile_height:1000,overlap:80});assert.equal(split.status,'ok');assert.equal(split.data.tiles.length,6);
 assert.equal(Math.max(...split.data.tiles.map(x=>x.rootBox[2])),a.data.width);assert.equal(Math.max(...split.data.tiles.map(x=>x.rootBox[3])),a.data.height);
 const successful=await h.execute('vision_extract',{asset_id:split.data.tiles[0].id,question:'read'});assert.equal(successful.status,'ok');assert.equal(successful.data.page,12);assert.equal(successful.data.quality.contentVerified,false);
 assert.equal(posts,2);assert.equal((await h.execute('processing_status',{})).data.files[0].pagesWithReturnedText.length,1);
});
