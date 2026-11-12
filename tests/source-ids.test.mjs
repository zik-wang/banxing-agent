import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';
import {Continuity} from '../v8-tools/continuity.mjs';
import {saveDraft,getDraft} from '../v8-tools/draft-delivery.mjs';
import {resolveSourceIds} from '../v8-tools/source-ids.mjs';

const digest = b => createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'v8-source-id-'));
  t.after(()=>{if(path.dirname(fs.realpathSync(root))!==base||!path.basename(root).startsWith('v8-source-id-'))throw Error('Unsafe synthetic cleanup');fs.rmSync(root,{recursive:true,force:true});});
  const original=path.join(root,'synthetic-only.txt');fs.writeFileSync(original,'Synthetic supplier A; amount 42. No real business input.');
  let seq=0;
  const open=(resumeRunId,workItemId='case')=>{
    const directory=path.join(root,'run'+(++seq)),c=new Continuity({directory,executionRepair:true,request:'Synthetic source identity test',inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'test',workItemId,mode:resumeRunId?'resume':'revise',resumeRunId}});
    const d=new DocumentTools({directory,inputs:resumeRunId?[]:[original],python:process.execPath});d.executionRepair=true;d.requestedFormats=['md'];
    const extras=new DocumentExtras(d),texts=new TextTools(d),delivery=new DeliveryTools(d,extras,texts);
    c.bind({docs:d,extras,records:{sources:new Map(),records:new Map()},workbooks:{tables:new Map()}});
    const asset=[...d.assets.values()][0];return {c,d,extras,delivery,asset};
  };
  return {root,original,open,...open()};
}

test('save_draft accepts an already imported resource ID and delivers canonical source refs',async t=>{
  const x=fixture(t),before=digest(fs.readFileSync(x.original));
  const result=await x.delivery.tools().find(t=>t.name==='save_draft').execute({title:'Synthetic report',content:'# Synthetic report\nAmount 42.',source_ids:[x.asset.resourceRef.resourceId]});
  assert.deepEqual(result.sourceRefs,[{id:x.asset.id,sha256:x.asset.sha256}]);
  assert.deepEqual(result.sourceIds,[x.asset.id]);assert.equal(fs.readFileSync(result.path,'utf8'),'# Synthetic report\nAmount 42.');
  assert.equal(result.contentVerified,false);assert.equal(result.sourceContentVerified,false);assert.equal(digest(fs.readFileSync(x.original)),before);
  const draft=getDraft(x.d,result.draft_ref);assert.deepEqual(draft.sourceRefs,result.sourceRefs);
});

test('direct export and alias+asset duplicate references keep one canonical source',async t=>{
  const x=fixture(t);x.d.executionRepair=false;
  const out=await x.delivery.export({title:'Synthetic direct export',format:'md',content:'Synthetic preserved body',source_ids:[x.asset.resourceRef.resourceId,x.asset.id]});
  assert.deepEqual(out.sourceIds,[x.asset.id]);assert.equal(fs.readFileSync(out.path,'utf8'),'Synthetic preserved body');
});

test('canonical and alias draft paths share one persisted version and resume keeps references',async t=>{
  const x=fixture(t),args={title:'Synthetic',content:'Unchanged synthetic body'};
  const a=saveDraft(x.d,{...args,source_ids:[x.asset.id]});const file=path.join(x.d.directory,'drafts',a.version+'.json'),before=digest(fs.readFileSync(file));
  const b=saveDraft(x.d,{...args,source_ids:[x.asset.resourceRef.resourceId]});assert.equal(a.resultId,b.resultId);assert.equal(digest(fs.readFileSync(file)),before);
  const y=x.open(x.c.runId);assert.deepEqual(resolveSourceIds(y.d,[x.asset.resourceRef.resourceId]),a.sourceRefs);
  assert.deepEqual(getDraft(y.d,a.resultId).sourceRefs,a.sourceRefs);
  assert.throws(()=>x.open(x.c.runId,'different-task'),e=>e.code==='RESUME_SCOPE_DENIED');
});

test('unimported workspace resources and fabricated IDs remain unknown; no draft is written',t=>{
  const x=fixture(t),other=x.c.space.put({projectId:'test',workItemId:'case',kind:'original',bytes:Buffer.from('Synthetic other file')});
  for(const id of [other.resourceId,'invented-id'])assert.throws(()=>saveDraft(x.d,{title:'Synthetic',content:'Not delivered',source_ids:[id]}),e=>e.code==='UNKNOWN_ASSET');
  assert.equal(x.d.results.size,0);assert.equal(x.extras.artifacts.size,0);assert.equal(fs.existsSync(path.join(x.d.directory,'drafts')),false);
});

test('two imported revisions require explicit asset selection, not guessing latest',t=>{
  const x=fixture(t),ref=x.c.space.put({projectId:'test',workItemId:'case',kind:'original',bytes:Buffer.from('Second synthetic revision'),resourceId:x.asset.resourceRef.resourceId});
  const file=path.join(x.d.directory,'assets','second.txt');fs.writeFileSync(file,'Second synthetic revision');
  const a={...x.asset,id:'second-asset',sourceId:'second-asset',path:file,sha256:digest(fs.readFileSync(file)),resourceRef:ref};x.d.assets.set(a.id,a);
  assert.throws(()=>saveDraft(x.d,{title:'Synthetic',content:'Not delivered',source_ids:[ref.resourceId]}),e=>e.code==='AMBIGUOUS_SOURCE_ID'&&e.details.candidates.length===2);
  assert.deepEqual(resolveSourceIds(x.d,[x.asset.id]),[{id:x.asset.id,sha256:x.asset.sha256}]);
  assert.equal(x.extras.artifacts.size,0);
});

for(const kind of ['revoked','excluded','changed'])test(`alias preserves ${kind} source rejection and old delivery`,async t=>{
  const x=fixture(t),old=x.delivery.register({title:'Old',filename:'old.md',bytes:Buffer.from('Synthetic old delivery')}),before=digest(fs.readFileSync(old.path));
  if(kind==='revoked')x.c.space.revoke('test',x.asset.resourceRef);
  if(kind==='excluded')x.c.config.continuity.excludedInputs=[x.asset.resourceRef];
  if(kind==='changed')fs.writeFileSync(x.asset.path,'Synthetic changed bytes');
  const code={revoked:'RESOURCE_REVOKED',excluded:'RESOURCE_EXCLUDED_IN_CONVERSATION',changed:'ASSET_CHANGED'}[kind];
  await assert.rejects(x.delivery.export({title:'New',format:'md',content:'Not delivered',source_ids:[x.asset.resourceRef.resourceId]}),e=>e.code===code);
  assert.equal(digest(fs.readFileSync(old.path)),before);assert.equal(x.extras.artifacts.size,1);
});

test('unknown source inside a mixed valid list is never silently discarded',t=>{
  const x=fixture(t);assert.throws(()=>saveDraft(x.d,{title:'Synthetic',content:'Not delivered',source_ids:[x.asset.resourceRef.resourceId,'foreign-resource']}),e=>e.code==='UNKNOWN_ASSET');
  assert.equal(x.d.results.size,0);assert.equal(x.extras.artifacts.size,0);
});
