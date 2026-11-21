import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {combineDatasets,WorkbookTools} from '../v8-tools/workbook-tools.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {ResultTools} from '../v8-tools/result-tools.mjs';
import {ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';

test('column alignment, append, chosen-key dedup and conflicting values have distinct behavior',()=>{
 const a={sourceId:'a',sheet:'A',headerRow:1,headers:['id','amount'],rows:[['x',1],['y',2]]};
 const b={sourceId:'b',sheet:'B',headerRow:1,headers:['amount','id','note'],rows:[[1,'x','source'],[3,'z','source']]};
 const appended=combineDatasets([a,b]);assert.equal(appended.rows.length,4);assert.deepEqual(appended.headers,['id','amount','note']);assert.deepEqual(appended.rows[2],['x',1,'source']);
 const dedup=combineDatasets([a,b],{mode:'deduplicate',key_columns:['id']});assert.equal(dedup.rows.length,3);assert.deepEqual(dedup.rows[0],['x',1,'source']);assert.equal(dedup.provenance[0].length,2);
 const conflict=combineDatasets([a,{...b,rows:[[9,'x','different']]}],{mode:'deduplicate',key_columns:['id']});assert.equal(conflict.rows.length,3);assert.equal(conflict.conflicts.length,1);
 assert.throws(()=>combineDatasets([a,b],{mode:'deduplicate',key_columns:['note']}),e=>e.code==='INVALID_KEY');
});
test('append_new preserves base rows, aligns explicit aliases, and separates changes and missing keys',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v8-append-new-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const docs={directory:folder,results:new Map(),save(){}};
 const books=new WorkbookTools(docs,{});
 const date={kind:'excel_temporal',serial:45000,numberFormat:'yyyy-mm-dd',display:'2023-03-15T00:00:00'};
 const base={id:'base',sourceId:'a',sheet:'A',headerRow:1,headers:['id','supplier','date'],rows:[['a','old',date],['a','second',null]]};
 const incoming={id:'incoming',sourceId:'b',sheet:'B',headerRow:3,headers:['vendor name','date',' id '],rows:[
  ['old',{...date,numberFormat:'mm/dd/yyyy'},'a'],['changed',null,'a'],
  ['new1',date,'b'],['new2',null,'b'],['new1',date,'b'],['unassigned',null,null]
 ]};
 books.tables.set(base.id,base);books.tables.set(incoming.id,incoming);
 const args={table_ids:[base.id,incoming.id],mode:'append_new',key_columns:['id']};
 assert.throws(()=>books.merge(args),e=>e.code==='APPEND_NEW_SCHEMA');
 const result=books.merge({...args,column_aliases:[{incoming_column:'vendor\u00a0name',base_column:'supplier'}]});
 const merged=books.tables.get(result.tableId);
 assert.deepEqual(merged.rows,[...base.rows,['b','new1',date],['b','new2',null]]);
 assert.deepEqual(merged.reviewRows,[['a','changed',null],[null,'unassigned',null]]);
 assert.deepEqual(merged.conflicts.map(r=>r.incoming[0].row),[5,9]);
 assert.equal(result.removedRows,2);
 assert.equal(result.reviewRows,2);
 assert.equal(base.rows.length,2);
 const edited=new ResultTools(docs,{},books).revise({table_id:result.tableId,operations:[
  {kind:'add_column',column:'reviewed',value:{kind:'boolean',boolean:false}}
 ]});
 assert.deepEqual(books.tables.get(edited.tableId).reviewRows,[['a','changed',null,false],[null,'unassigned',null,false]]);
 assert.equal(merged.reviewRows[0].length,3);
});

test('worksheet reader trims empty outside columns but refuses to drop unnamed data',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v8-worksheet-layout-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const rows=[['title'],[null,'ID','Amount',null],[null,'x',12.5,null],[null,null,null,null],[null,'y',2,null]];
 const docs={directory:folder,results:new Map(),save(){},asset:()=>({id:'a',kind:'workbook',path:'workbook.xlsx'}),async inspect(){},
  async worker(job){assert.equal(job.sheet,'Data');return {sheets:[{name:'Data',rows,formulas:[]}]};}};
 const books=new WorkbookTools(docs,{});
 const args={asset_id:'a',sheet:'Data',header_row:2};
 const read=await books.read(args,{});
 const table=books.tables.get(read.tableId);
 assert.deepEqual(table.headers,['ID','Amount']);
 assert.deepEqual(table.rows,[['x',12.5],['y',2]]);
 assert.deepEqual(table.provenance.map(p=>p[0].row),[3,5]);
 rows[4][3]='unlabelled';
 await assert.rejects(books.read(args,{}),e=>e.code==='INVALID_HEADERS');
});

test('append-new validation returns full sheet counts without exposing a pagination loop',async()=>{
 const docs={workbookTools:{tables:new Map([['t',{mode:'append_new'}]])}};
 const extras=Object.create(DocumentExtras.prototype);
 extras.docs=docs;
 extras.artifacts=new Map([['a',{tableId:'t',sha256:'hash',expected:[
  {name:'合并报表',raw:[['ID'],['a'],['b']]},{name:'待核',raw:[['ID'],['c']]}
 ]}]]);
 const full={exportIntegrityPassed:true,resultId:'full-readback',nextOffset:5000};
 extras.inspect=async()=>full;
 const receipt=await extras.validateDelivery({artifact_id:'a'},{});
 assert.deepEqual(receipt.checkedSheets,[{name:'合并报表',dataRows:2,columns:1},{name:'待核',dataRows:1,columns:1}]);
 assert.equal(receipt.exportIntegrityPassed,true);
 assert.equal(receipt.resultId,undefined);
 full.exportIntegrityPassed=false;
 assert.equal(await extras.validateDelivery({artifact_id:'a'},{}),full);
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
