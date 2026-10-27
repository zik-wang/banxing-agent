import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {combineDatasets,WorkbookTools} from '../v8-tools/workbook-tools.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';

test('column alignment, append, chosen-key dedup and conflicting values have distinct behavior',()=>{
 const a={sourceId:'a',sheet:'A',headerRow:1,headers:['id','amount'],rows:[['x',1],['y',2]]};
 const b={sourceId:'b',sheet:'B',headerRow:1,headers:['amount','id','note'],rows:[[1,'x','source'],[3,'z','source']]};
 const appended=combineDatasets([a,b]);assert.equal(appended.rows.length,4);assert.deepEqual(appended.headers,['id','amount','note']);assert.deepEqual(appended.rows[2],['x',1,'source']);
 const dedup=combineDatasets([a,b],{mode:'deduplicate',key_columns:['id']});assert.equal(dedup.rows.length,3);assert.deepEqual(dedup.rows[0],['x',1,'source']);assert.equal(dedup.provenance[0].length,2);
 const conflict=combineDatasets([a,{...b,rows:[[9,'x','different']]}],{mode:'deduplicate',key_columns:['id']});assert.equal(conflict.rows.length,3);assert.equal(conflict.conflicts.length,1);
 assert.throws(()=>combineDatasets([a,b],{mode:'deduplicate',key_columns:['note']}),e=>e.code==='INVALID_KEY');
});
test('follow-up preserves the prior user message verbatim and the same tool state',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v8-followup-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const h=new ToolHarness({directory:folder,tools:[]});const first=await runToolAgent({harness:h,request:'合并这个报表',initialMessages:[{role:'system',content:'test host metadata'}],next:async()=>({role:'assistant',content:'first'})});
 const next=await runToolAgent({harness:h,request:'你没有审查重复项目吗',initialMessages:first.messages,next:async messages=>{assert.deepEqual(messages.filter(m=>m.role==='user').map(m=>m.content),['合并这个报表','你没有审查重复项目吗']);return {role:'assistant',content:'second'};}});
 assert.equal(next.messages.filter(m=>m.role==='assistant').length,2);
});

const python=process.env.V8_PYTHON,input=process.env.V8_WORKBOOK_A,artifactModule=process.env.V8_ARTIFACT_MODULE;
test('actual XLSX can be read, exported with numeric amounts and independently read back',{skip:!python||!input||!artifactModule},async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v8-workbooks-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const d=new DocumentTools({directory:path.join(folder,'run'),inputs:[input],python});const e=new DocumentExtras(d,{artifactModule});const w=new WorkbookTools(d,e,{artifactModule});const h=new ToolHarness({directory:d.directory,tools:[...d.tools(),...e.tools(),...w.tools()],maxVisibleTools:20});
 const id=[...d.assets.keys()][0],inspected=await h.execute('inspect_material',{asset_id:id});assert.equal(inspected.data.kind,'workbook');
 const read=await h.execute('read_workbook',{asset_id:id,sheet:inspected.data.sheets[0].name});assert.equal(read.status,'ok');assert.equal(read.data.rowCount,25);
 const exported=await h.execute('export_table',{table_id:read.data.tableId,title:'copy'});assert.equal(exported.status,'ok',JSON.stringify(exported));
 const checked=await h.execute('validate_artifact',{artifact_id:exported.data.artifactId});assert.equal(checked.data.exportIntegrityPassed,true,JSON.stringify(checked));
 const actual=JSON.parse(fs.readFileSync(path.join(path.dirname(exported.data.path),'readback.json'),'utf8'));assert.equal(actual.sheets[0].rows.length,26);assert.equal(typeof actual.sheets[0].rows[1][7],'number');assert.equal(actual.sheets[0].rows[15][7],1362249.75);
});
