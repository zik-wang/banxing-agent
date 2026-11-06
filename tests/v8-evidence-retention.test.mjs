import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {compactHistory} from '../v8-tools/draft-delivery.mjs';
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v8-retained-evidence-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
function receipt(id,text,{version='v1',start=0}={}){return {role:'tool',tool_call_id:id,content:JSON.stringify({callId:id,tool:'read_text_range',status:'ok',data:{sourceId:id,sourceSha256:version,start,end:start+text.length,text,quote:text,nextOffset:null,contentVerified:false}})};}
test('three-source synthesis retains actual evidence beyond the last two tools',t=>{
 const dir=setup(t),messages=['A','B','C'].map(id=>receipt(id,id.repeat(12000)));messages.push({role:'tool',content:'{}'},{role:'tool',content:'{}'});
 compactHistory(messages,dir,{evidenceBudgetChars:120000});
 for(let i=0;i<3;i++){const r=JSON.parse(messages[i].content);assert.equal(r.data.text,['A','B','C'][i].repeat(12000));assert.equal(r.data.quote,undefined);assert.equal(r.data.contentVerified,false);assert.equal(r.contextReceipt,undefined);}
 assert.equal(fs.readdirSync(path.join(dir,'context-receipts')).length,3);
});
test('duplicate receipt compacts but source versions and distinct spans remain visible',t=>{
 const dir=setup(t),one=receipt('source','x'.repeat(3000)),duplicate=structuredClone(one),other=receipt('source','x'.repeat(3000),{version:'v2'}),span=receipt('source','x'.repeat(3000),{start:3000});duplicate.tool_call_id='repeat';
 const messages=[one,duplicate,other,span,{role:'tool',content:'{}'},{role:'tool',content:'{}'}];compactHistory(messages,dir,{evidenceBudgetChars:30000});
 assert(JSON.parse(one.content).contextReceipt);for(const x of [duplicate,other,span])assert.equal(JSON.parse(x.content).data.text.length,3000);
});
test('over-budget evidence stays recoverable on disk; untouched fresh replies remain verbatim',t=>{
 const dir=setup(t),messages=['A','B','C'].map(id=>receipt(id,id.repeat(20000)));messages.push({role:'tool',content:'{}'},{role:'tool',content:'{}'});const fresh=messages[2].content;
 compactHistory(messages,dir,{seenThrough:2,evidenceBudgetChars:25000});assert.equal(messages[2].content,fresh);
 const r=JSON.parse(messages[0].content);assert(r.contextReceipt);const full=JSON.parse(fs.readFileSync(path.join(dir,'context-receipts',r.contextReceipt.sha256+'.json')));assert.equal(full.data.text,'A'.repeat(20000));
});
