import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readingContext} from '../v8-tools/reading-context.mjs';
import {Continuity} from '../v8-tools/continuity.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {SourceRecordTools} from '../v8-tools/source-record-tools.mjs';
function fixture(results) {
  const a = {id:'a',name:'synthetic.pdf',sha256:'hash',pages:3};
  return {assets:new Map([['a',a]]), results:new Map(results.map(r=>[r.resultId,r])), asset:id=>{assert.equal(id,'a');return a;}};
}
const page=(id,page,answer='Synthetic source text')=>({resultId:id,assetId:'a',method:'pdf_text',page,answer});
test('index retains exact saved IDs and physical pages without asserting full coverage',()=>{
  const d=fixture([page('p1',1),page('p3',3)]),r=readingContext(d);
  assert.deepEqual(r.entries.map(e=>[e.resultId,e.physicalPage,e.totalPages]),[['p1',1,3],['p3',3,3]]);
  assert.equal(r.contentVerified,false);assert(!('fullDocumentRead' in r));
});
test('local-only, unrelated drafts, orphaned and stale text references are excluded',()=>{
  const d=fixture([{...page('private',1,'PRIVATE'),plannerReadable:false},
    {...page('draft',1,'DRAFT'),method:'submitted_draft'}, {...page('orphan',1),assetId:'absent'},
    {...page('stale',1),method:'text_range',binding:{sourceSha256:'old'}}]);
  assert.equal(readingContext(d).entries.length,0);
});
test('permission or source hash rejection is not swallowed and each original is checked once',()=>{
  const d=fixture([page('a1',1),page('a2',2)]);let calls=0;const original=d.asset;
  d.asset=id=>{calls++;return original(id);};readingContext(d);assert.equal(calls,1);
  d.asset=()=>{throw Error('RESOURCE_REVOKED');};assert.throws(()=>readingContext(d),/REVOKED/);
});
test('bounded index and excerpts explicitly disclose omitted content and do not mutate originals',()=>{
  const d=fixture([page('p1',1,'x'.repeat(1000)),page('p2',2,'y'.repeat(1000))]);
  const before=JSON.stringify([...d.results]);const r=readingContext(d,{maxChars:600,maxEvidenceChars:0});
  assert.equal(r.entries.length,1);assert.equal(r.omittedResults,1);assert.equal(r.indexComplete,false);
  assert.equal(r.entries[0].excerpt.length,180);assert.equal(r.entries[0].excerptTruncated,true);
  assert.equal(JSON.stringify([...d.results]),before);
});
test('saved text is restored exactly within a separate evidence budget; deferred text is explicit',()=>{
  const d=fixture([page('p1',1,'原文\r\n100 & 200'),page('p2',2,'long'.repeat(100))]);
  const r=readingContext(d,{maxEvidenceChars:20});
  assert.equal(r.entries[0].text,'原文\r\n100 & 200');
  assert.equal(r.entries[0].savedTextIncludedInFull,true);
  assert.equal(r.entries[1].savedTextIncludedInFull,false);
  assert.equal(r.entries[1].text,undefined);assert.equal(r.deferredTextResults,1);
  assert(r.evidenceChars<=20);assert.equal(r.contentVerified,false);
});
test('empty page remains visibly empty and text ranges retain original offsets',()=>{
  const d=fixture([page('empty',2,''),{...page('text',null,'abc'),method:'text_range',binding:{sourceSha256:'hash',start:10,end:13,lineStart:2,lineEnd:2}}]);
  const r=readingContext(d);assert.equal(r.entries[0].savedChars,0);
  assert.deepEqual(r.entries[1].range,{start:10,end:13,lineStart:2,lineEnd:2});
});
test('real checkpoint restore exposes a usable read_result reference without another original read',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reading-index-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input=path.join(root,'synthetic.txt');fs.writeFileSync(input,'Synthetic evidence only.\nSecond line.');
  const cfg={request:'read',executionRepair:true,inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'p',workItemId:'w'}};
  let seq=0;
  function open(mode='revise',resumeRunId){
    const c=new Continuity({...cfg,continuity:{...cfg.continuity,mode,resumeRunId}});
    const docs=new DocumentTools({directory:path.join(root,'run'+(++seq)),inputs:mode==='revise'?[input]:[],python:'python'});
    const extras=new DocumentExtras(docs,{}),texts=new TextTools(docs),records=new SourceRecordTools(docs,extras,texts);
    c.bind({docs,extras,records});return{c,docs,texts};
  }
  const first=open(),id=[...first.docs.assets.keys()][0];
  const read=await first.c.operation('read_text_range',{asset_id:id},()=>first.texts.read({asset_id:id}));
  const second=open('resume',first.c.runId),index=second.c.context().savedSourceReads;
  assert.equal(index.entries.length,1);assert.equal(index.entries[0].resultId,read.resultId);
  const result=await second.docs.tools().find(t=>t.name==='read_result').execute({result_id:read.resultId});
  assert.equal(result.text,read.text);assert.equal(result.nextOffset,null);
  assert.equal(fs.readFileSync(input,'utf8'),'Synthetic evidence only.\nSecond line.');
  assert.equal(Object.values(second.c.space.load().operations).filter(o=>o.tool==='read_text_range').length,1);
  const third=new Continuity({...cfg,continuity:{...cfg.continuity,workItemId:'other'}});
  assert.throws(()=>new Continuity({...cfg,continuity:{...cfg.continuity,workItemId:'other',mode:'resume',resumeRunId:first.c.runId}}),/SCOPE/);
});
