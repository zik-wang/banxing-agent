import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {Continuity} from '../v8-tools/continuity.mjs';import {DocumentTools} from '../v8-tools/document-tools.mjs';import {DocumentExtras} from '../v8-tools/document-extras.mjs';import {TextTools} from '../v8-tools/text-tools.mjs';import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';import {SourceRecordTools} from '../v8-tools/source-record-tools.mjs';import {saveDraft,getDraft} from '../v8-tools/draft-delivery.mjs';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture(t){const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'v8-draft-persist-'));t.after(()=>{if(!path.resolve(root).startsWith(base+path.sep)||!path.basename(root).startsWith('v8-draft-persist-'))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true});});let sequence=0;const cfg={executionRepair:true,request:'synthetic offline report',inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'p',workItemId:'w'}};
 const open=(mode='revise',resumeRunId,workItemId='w')=>{const directory=path.join(root,'run'+(++sequence)),c=new Continuity({...cfg,directory,continuity:{...cfg.continuity,mode,resumeRunId,workItemId}}),d=new DocumentTools({directory,inputs:[],python:process.execPath});d.executionRepair=true;d.requestedFormats=['txt'];const e=new DocumentExtras(d),texts=new TextTools(d),out=new DeliveryTools(d,e,texts),records=new SourceRecordTools(d,e,texts);c.bind({docs:d,extras:e,records});return{c,d,e,out};};return{root,open};}
const args={title:'Synthetic draft',content:'Complete synthetic draft; no company material.',source_ids:[]};
function blockCheckpoint(x){const original=x.c.checkpoint.bind(x.c);x.c.checkpoint=()=>{throw Object.assign(Error('Synthetic checkpoint EPERM, no model request'),{code:'EPERM'});};return()=>{x.c.checkpoint=original;};}

test('checkpoint failure cannot create a new delivery, and retry really persists the retained draft',async t=>{
 const f=fixture(t),x=f.open(),old=x.out.register({title:'previous',filename:'previous.txt',bytes:Buffer.from('old synthetic delivery')}),oldSha=sha(old.path),unblock=blockCheckpoint(x);
 await assert.rejects(x.out.export({title:args.title,format:'txt',content:args.content}),e=>e.code==='EPERM'&&e.details?.locallySaved===true&&!!e.details?.draft_ref);assert.equal(x.e.artifacts.size,1);assert.equal(sha(old.path),oldSha);
 const file=fs.readdirSync(path.join(x.d.directory,'drafts')).find(n=>n.endsWith('.json')),draftPath=path.join(x.d.directory,'drafts',file),before=sha(draftPath);unblock();const recovered=saveDraft(x.d,args),checkpoint=x.c.space.load().runs[x.c.runId].checkpoint,bundle=JSON.parse(x.c.space.read('p',checkpoint));
 assert.ok(bundle.results.some(r=>r.resultId===recovered.resultId));assert.equal(sha(draftPath),before);assert.equal(x.e.artifacts.size,1);assert.equal(x.c.space.load().runs[x.c.runId].budget.modelRequests,0);
});

test('fresh authorized resume recovers a locally saved draft missing from the shared checkpoint',async t=>{
 const f=fixture(t),x=f.open(),old=x.out.register({title:'previous',filename:'previous.txt',bytes:Buffer.from('old synthetic result')}),before=sha(old.path),unblock=blockCheckpoint(x);assert.throws(()=>saveDraft(x.d,args),/EPERM/);unblock();const draft=[...x.d.results.values()].find(r=>r.method==='submitted_draft');
 // A damaged optional local cache must not erase the independently saved draft.
 fs.writeFileSync(path.join(x.d.directory,'state.json'),'{synthetic interrupted cache');
 const y=f.open('resume',x.c.runId);assert.equal(getDraft(y.d,draft.resultId).answer,args.content);assert.ok(y.c.context().currentDrafts.some(d=>d.draft_ref===draft.resultId));
 const exported=await y.out.export({title:'Recovered synthetic draft',format:'txt',draft_ref:draft.resultId});assert.equal(fs.readFileSync(exported.path,'utf8'),args.content);assert.equal(sha(old.path),before);assert.equal(y.c.space.load().runs[x.c.runId].budget.modelRequests,0);
});

test('an immutable draft file is reused after an in-memory cache miss instead of overwritten',async t=>{
 const f=fixture(t),x=f.open(),draft=saveDraft(x.d,args),file=path.join(x.d.directory,'drafts',draft.version+'.json'),before=sha(file);x.d.results.delete(draft.resultId);await new Promise(resolve=>setTimeout(resolve,20));const again=saveDraft(x.d,args);assert.equal(again.resultId,draft.resultId);assert.equal(again.createdAt,draft.createdAt);assert.equal(sha(file),before);
});

test('tampered persisted draft fails closed on resume and does not replace the old artifact',t=>{
 const f=fixture(t),x=f.open(),old=x.out.register({title:'previous',filename:'previous.txt',bytes:Buffer.from('old result')}),before=sha(old.path),draft=saveDraft(x.d,args),file=path.join(x.d.directory,'drafts',draft.version+'.json');const invalid=JSON.parse(fs.readFileSync(file));invalid.answer='tampered synthetic text';fs.writeFileSync(file,JSON.stringify(invalid));
 assert.throws(()=>f.open('resume',x.c.runId),e=>['DRAFT_MISSING_OR_CHANGED','DRAFT_RECORD_INVALID'].includes(e.code));assert.equal(sha(old.path),before);assert.equal(JSON.parse(fs.readFileSync(file)).answer,invalid.answer);
});

test('draft recovery does not expand a resume into another work item',t=>{
 const f=fixture(t),x=f.open();saveDraft(x.d,args);assert.throws(()=>f.open('resume',x.c.runId,'another-work'),/RESUME_SCOPE_DENIED/);
});

test('old atomic index temporary files never overwrite a newer state during draft recovery',t=>{
 const f=fixture(t),x=f.open(),unblock=blockCheckpoint(x);assert.throws(()=>saveDraft(x.d,args),/EPERM/);unblock();const temp=x.c.space.file+'.synthetic-stale.tmp';fs.writeFileSync(temp,JSON.stringify({...x.c.space.load(),syntheticMarker:'obsolete'}));const before=sha(temp);x.c.space.tx(s=>{s.syntheticMarker='newer committed state';});
 const y=f.open('resume',x.c.runId);assert.equal(y.c.space.load().syntheticMarker,'newer committed state');assert.equal(sha(temp),before);assert.equal(y.c.context().currentDrafts.length,1);
});

test('uncommitted draft temporary files stay visible as warnings and are never delivered',t=>{
 const f=fixture(t),x=f.open(),folder=path.join(x.d.directory,'drafts');fs.mkdirSync(folder);const temp=path.join(folder,'synthetic-interrupted.json.tmp');fs.writeFileSync(temp,'{"incomplete":');const before=sha(temp),y=f.open('resume',x.c.runId);
 assert.equal(y.e.artifacts.size,0);assert.equal(y.c.context().currentDrafts.length,0);assert.deepEqual(y.c.context().draftRecovery.uncommittedTemporaryFiles,['synthetic-interrupted.json.tmp']);assert.equal(sha(temp),before);
});
