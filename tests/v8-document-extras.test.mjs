import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ToolHarness} from '../v8-tools/harness.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
const python=process.env.V8_PYTHON,pdf=process.env.V8_SMALL_PDF,artifactModule=process.env.V8_ARTIFACT_MODULE;
function setup(t) {
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v8-extras-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const docs=new DocumentTools({directory:path.join(folder,'run'),inputs:[pdf],python});
 const extras=new DocumentExtras(docs,{artifactModule});
 const h=new ToolHarness({directory:docs.directory,tools:[...docs.tools(),...extras.tools()]});
 return {docs,extras,h,id:[...docs.assets.keys()][0]};
}
test('real PDF text retains invoice leading zeros and page boundaries',{skip:!python||!pdf},async t=>{
 const {h,id}=setup(t);const r=await h.execute('extract_pdf_text',{asset_id:id,page:1});
 assert.equal(r.status,'ok');assert(r.data.text.includes('000277511'));assert.equal(r.data.totalPages,1);assert.equal(r.data.contentVerified,false);
 assert.equal((await h.execute('extract_pdf_text',{asset_id:id,page:2})).error.code,'PAGE_OUT_OF_RANGE');
});
test('nested schemas and ragged matrices fail before workbook creation',{skip:!python||!pdf},async t=>{
 const {h,id,extras}=setup(t);const payload={title:'test',sheets:[{name:'sheet',headers:['A'],rows:[['x']]}],source_refs:[{asset_id:id,page:1}]};
 const bad=structuredClone(payload);bad.sheets[0].rows[0][0]={unexpected:'object'};
 assert.equal((await h.execute('export_xlsx',bad)).error.code,'INVALID_ARGUMENT');
 const ragged=structuredClone(payload);ragged.sheets[0].rows[0].push('extra');
 assert.equal((await h.execute('export_xlsx',ragged)).error.code,'RAGGED_TABLE');assert.equal(extras.artifacts.size,0);
});
test('real XLSX readback preserves zeros, source symbols and literal formulas; tampering fails',{skip:!python||!pdf||!artifactModule},async t=>{
 const {h,id,extras}=setup(t);
 const r=await h.execute('export_xlsx',{title:'字段保真专项',sheets:[{name:'清单',headers:['原文','日期','备注'],rows:[['000277511','2025','=1+1'],['Revenue and benefits','30/11/2033 & 31/03/2024','配对待核'],['CareDirector & Liquidlogic Childrens System (LCS)','','原文保留']]}],source_refs:[{asset_id:id,page:1}]});
 assert.equal(r.status,'ok',JSON.stringify(r));const checked=await h.execute('validate_artifact',{artifact_id:r.data.artifactId});
 assert.equal(checked.status,'ok',JSON.stringify(checked));assert.equal(checked.data.exportIntegrityPassed,true,JSON.stringify(checked));assert.equal(checked.data.contentVerified,false);
 fs.appendFileSync(extras.artifacts.get(r.data.artifactId).path,'tampered');
 assert.equal((await h.execute('validate_artifact',{artifact_id:r.data.artifactId})).error.code,'ARTIFACT_CHANGED');
});
