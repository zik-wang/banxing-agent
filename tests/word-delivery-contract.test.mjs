import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';

const configured=!!process.env.V8_PYTHON&&!!process.env.V8_DOCX_MODULE;
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'word-delivery-contract-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const inputs=['a.txt','b.txt'].map(name=>{const f=path.join(root,name);fs.writeFileSync(f,'合成来源，金额尚未确认。');return f;});
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs,python:process.env.V8_PYTHON});
 docs.executionRepair=true;docs.requestedFormats=['docx'];
 const extras=new DocumentExtras(docs,{docxModule:process.env.V8_DOCX_MODULE}),delivery=new DeliveryTools(docs,extras,new TextTools(docs));
 return{docs,extras,delivery};
}

test('repeated Word export returns the same real file even after package timestamps would change',{skip:!configured},async t=>{
 const x=setup(t),args={title:'合成简报',format:'docx',content:'仅核对工具保存，不作为真实业务结论。'};
 const first=await x.delivery.export(args);
 await new Promise(resolve=>setTimeout(resolve,1100));
 const second=await x.delivery.export(args);
 assert.equal(second.artifactId,first.artifactId);assert.equal(second.path,first.path);
 assert.equal(second.recoveredReceipt,true);assert.equal(second.exportIntegrityPassed,true);
 assert.equal(x.extras.artifacts.size,1);
});

test('changed content or different authorized sources retain independent Word versions',{skip:!configured},async t=>{
 const x=setup(t),ids=[...x.docs.assets.keys()],base={title:'同名报告',format:'docx',content:'保留独立业务事项。'};
 const a=await x.delivery.export({...base,source_ids:[ids[0]]});
 const b=await x.delivery.export({...base,source_ids:[ids[1]]});
 const c=await x.delivery.export({...base,content:'修订后仍须保留原版本。',source_ids:[ids[0]]});
 assert.equal(new Set([a.artifactId,b.artifactId,c.artifactId]).size,3);
 assert.equal(x.extras.artifacts.size,3);assert.ok(fs.existsSync(a.path));
});

test('a changed saved Word is reported rather than overwritten by repeated export',{skip:!configured},async t=>{
 const x=setup(t),args={title:'原文件保护',format:'docx',content:'合成保护测试。'};
 const first=await x.delivery.export(args);fs.writeFileSync(first.path,'人工改变后的内容');
 await assert.rejects(x.delivery.export(args),e=>e.code==='ARTIFACT_CHANGED');
 assert.equal(fs.readFileSync(first.path,'utf8'),'人工改变后的内容');assert.equal(x.extras.artifacts.size,1);
});

test('Word length includes its real title and preserves an oversized submitted draft',{skip:!configured},async t=>{
 const x=setup(t);x.docs.turnIntent={length:{maxChars:11}};
 const args={title:'摘要',format:'docx',content:'一二三四五六七八九十'};
 await assert.rejects(x.delivery.export(args),e=>e.code==='DOCUMENT_LENGTH_LIMIT'&&e.details.actualChars===12&&!!e.details.draft_ref);
 assert.equal(x.extras.artifacts.size,0);
 assert.ok([...x.docs.results.values()].some(r=>r.method==='submitted_draft'&&r.answer===args.content));
 x.docs.turnIntent.length.maxChars=12;
 const valid=await x.delivery.export(args);assert.equal(valid.exportIntegrityPassed,true);
 x.docs.turnIntent.length.maxChars=11;
 await assert.rejects(x.delivery.export(args),e=>e.code==='DOCUMENT_LENGTH_LIMIT');
 assert.equal(x.extras.artifacts.size,1);
});

test('table cells count toward the same document length boundary',{skip:!configured},async t=>{
 const x=setup(t);x.docs.turnIntent={length:{maxChars:8}};
 x.docs.workbookTools={tables:new Map([['t',{headers:['项目','金额'],rows:[['甲',100]]}]])};
 await assert.rejects(x.delivery.export({title:'表',format:'docx',table_ids:['t']}),e=>e.code==='DOCUMENT_LENGTH_LIMIT'&&e.details.actualChars===9);
 assert.equal(x.extras.artifacts.size,0);
});
