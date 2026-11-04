import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {ExecutionSupport,executionScope} from '../v8-tools/execution-support.mjs';import {ToolHarness} from '../v8-tools/harness.mjs';import {compactHistory} from '../v8-tools/draft-delivery.mjs';import {preferredDocumentTools} from '../v8-tools/tool-preferences.mjs';
const key=executionScope({request:'Compare four authorized sources',sources:[{id:'s',sha256:'frozen'}]});
function fixture(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-control-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const support=new ExecutionSupport({directory,scopeKey:key,...options});return{directory,support};}
function source(support,name){const r={callId:randomUUID(),tool:'read_source_records',status:'ok',data:{sourceId:name,sourceSha256:'frozen-'+name,records:Array.from({length:100},(_,i)=>({id:name+i,value:'source '+i+' '+'x'.repeat(700)})),totalRecords:115,nextOffset:100}};support.observe(r);return r;}

test('interleaved receipt pagination survives restart and an explicit rewind without resetting its continuation',t=>{
 const x=fixture(t),a=source(x.support,'A'),b=source(x.support,'B');
 x.support.read({call_id:a.callId,offset:0,length:12000});x.support.read({call_id:b.callId,offset:0,length:12000});x.support.read({call_id:a.callId,offset:12000,length:12000});
 const rewind=x.support.read({call_id:a.callId,offset:0,length:12000});assert.equal(rewind.recoveryProgress.repeatedRange,true);assert.equal(rewind.recoveryProgress.nextUnreadOffset,24000);assert.equal(rewind.text,JSON.stringify(a).slice(0,12000));assert.equal(rewind.nextOffset,12000);
 const reopened=new ExecutionSupport({directory:x.directory,scopeKey:key});assert.equal(reopened.recoveryHint(a).arguments.offset,24000);assert.equal(reopened.recoveryHint(b).arguments.offset,12000);
 assert.equal(reopened.state({include_recent:false}).receiptRecovery.length,2);
});

test('compacted original receipts refresh their cursor and keep record and text offsets distinct',t=>{
 const x=fixture(t),a=source(x.support,'A'),messages=[{role:'assistant',tool_calls:[{id:'a'}]},{role:'tool',tool_call_id:'a',content:JSON.stringify(a)},...['b','c'].map(id=>({role:'tool',tool_call_id:id,content:'{}'}))];
 x.support.read({call_id:a.callId,offset:0,length:12000});compactHistory(messages,x.directory,{maxRetainedChars:1000,receiptReader:'read_tool_receipt',recoveryHint:r=>x.support.recoveryHint(r)});
 let visible=JSON.parse(messages[1].content);assert.equal(visible.contextReceipt.retrieve.arguments.offset,12000);assert.equal(visible.data.sourcePagination.nextOffset,100);assert.equal(visible.data.sourcePagination.unit,'registered source records');
 x.support.read({call_id:a.callId,offset:12000,length:12000});compactHistory(messages,x.directory,{receiptReader:'read_tool_receipt',recoveryHint:r=>x.support.recoveryHint(r)});visible=JSON.parse(messages[1].content);assert.equal(visible.contextReceipt.retrieve.arguments.offset,24000);assert.equal(visible.contextReceipt.recoveryProgress.receiptTextFullyReturned,false);
});

test('query type feedback preserves the real error and suggests a scoped literal correction',async t=>{
 const x=fixture(t),a=source(x.support,'A'),h=new ToolHarness({directory:x.directory,tools:x.support.tools()});h.executionRepair=true;h.executionSupport=x.support;
 const failed=await h.execute('read_tool_receipt',{call_id:a.callId,query:2025,length:1000});assert.equal(failed.error.code,'INVALID_ARGUMENT');assert.equal(h.actualExecutions,0);assert.deepEqual(failed.error.recovery.suggested_arguments,{call_id:a.callId,query:'2025',length:1000});assert.match(failed.error.recovery.next_action,/do not restart/i);
 const corrected=await h.execute('read_tool_receipt',failed.error.recovery.suggested_arguments);assert.equal(corrected.status,'ok');assert.equal(corrected.data.matched,false);
});

test('a fully returned receipt points to its end rather than implicitly restarting from zero',t=>{
 const x=fixture(t),r={callId:randomUUID(),tool:'read_text_range',status:'ok',data:{text:'complete source'}};x.support.observe(r);x.support.read({call_id:r.callId,pointer:'/data/text'});const hint=x.support.recoveryHint(r);assert.equal(hint.arguments.offset,r.data.text.length);assert.equal(hint.progress.receiptTextFullyReturned,true);assert.equal(x.support.read(hint.arguments).text,'');assert.equal(x.support.read({...hint.arguments,offset:0}).text,r.data.text);
});

test('new recovery cursor metadata never makes an old slice new evidence',async t=>{
 const x=fixture(t),a=source(x.support,'A'),h=new ToolHarness({directory:x.directory,tools:x.support.tools()});h.executionRepair=true;h.executionSupport=x.support;
 await h.execute('read_tool_receipt',{call_id:a.callId,length:12000});await h.execute('read_tool_receipt',{call_id:a.callId,offset:12000,length:12000});const rewind=await h.execute('read_tool_receipt',{call_id:a.callId,offset:0,length:12000});assert.equal(rewind.evidenceProgress.unchanged,true);assert.equal(rewind.data.recoveryProgress.nextUnreadOffset,24000);
});

test('private policy, current authorization and saved cursor integrity still gate recovery metadata',t=>{
 let allowed=true,localOnly=false;const x=fixture(t,{authorize:()=>{if(!allowed)throw Object.assign(Error('changed'),{code:'ASSET_CHANGED'});},canRecover:()=>!localOnly}),a=source(x.support,'A');x.support.read({call_id:a.callId,length:100});localOnly=true;assert.equal(x.support.recoveryHint(a),null);assert.deepEqual(x.support.state({include_recent:false}).receiptRecovery,[]);assert.throws(()=>x.support.read({call_id:a.callId}),{code:'LOCAL_ONLY_RESULT'});localOnly=false;allowed=false;assert.throws(()=>x.support.recoveryHint(a),{code:'ASSET_CHANGED'});allowed=true;
 const file=path.join(x.support.directory,'receipt-progress.json'),saved=JSON.parse(fs.readFileSync(file));saved.entries[0].nextUnreadOffset=99999;fs.writeFileSync(file,JSON.stringify(saved));assert.throws(()=>new ExecutionSupport({directory:x.directory,scopeKey:key}),{code:'RECEIPT_PROGRESS_CHANGED'});
});

test('PDF choices change visible schemas without changing registered authority; expiry fact tools remain first',()=>{
 const names=['workspace_files','workspace_run','workspace_publish','update_plan','get_execution_state','read_tool_receipt','extract_pdf_text','search_document','read_text_range','save_draft','export_document','read_json_range','read_source_records','export_source_records','apply_patch_copy','read_artifact','validate_artifact'];const tools=names.map(name=>({name,description:name,inputSchema:{type:'object',properties:{}},execute:()=>({})}));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tool-authority-'));try{const prefix=names.slice(0,6),pdf=new ToolHarness({directory:dir,tools,preferredTools:[...prefix,...preferredDocumentTools([{kind:'pdf'}])]}),facts=new ToolHarness({directory:dir,tools,preferredTools:[...prefix,...preferredDocumentTools([{kind:'pdf'}],'expiry')]});const visible=pdf.listTools().map(t=>t.name);assert(visible.includes('extract_pdf_text')&&visible.includes('search_document'));assert(pdf.tools.has('read_source_records'));assert.equal(pdf.registryFingerprint,facts.registryFingerprint);assert(facts.listTools().some(t=>t.name==='read_source_records'));assert(facts.listTools().some(t=>t.name==='export_source_records'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
