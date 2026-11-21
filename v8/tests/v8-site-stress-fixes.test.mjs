import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {WebWorkspace,createWebServer} from '../v8-web/server.mjs';import {ResourceSpace,digest} from '../v8-tools/resource-space.mjs';import {ManagedWorkspace} from '../v8-tools/managed-workspace.mjs';import {LocalFileActions} from '../v8-web/local-files.mjs';import {BoundedFileAccess} from '../v8-web/file-access.mjs';import {turnIntent} from '../v8-tools/turn-intent.mjs';import {settleDelivery} from '../v8-tools/delivery-settlement.mjs';
function root(t){const r=fs.mkdtempSync(path.join(os.tmpdir(),'v8-site-fixes-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));return r;}
function setup(t){const config={dataRoot:root(t),externalWorkspace:true,workspaceId:'external-iteracompute',initialModelMode:'cloud',chat:{provider:'iteracompute',baseUrl:'https://api.iteracompute.com/v1',model:'synthetic',apiKey:'SYNTHETIC_NOT_REAL'},contractReview:{enabled:false}};return new WebWorkspace(config);}
function seed(w,c,origin,answer='SYNTHETIC_CANARY_NO_NETWORK'){const t={id:randomUUID(),request:'合成历史',answer,status:'answered',artifacts:[],createdAt:new Date().toISOString(),...(origin?{modelConnection:{mode:origin,provider:origin==='cloud'?'iteracompute':'intranet'}}:{})};c.turns.push(t);w.save();return t;}
function blockSpawn(w){let n=0;w.spawnRun=()=>{n++;throw Error('TEST_UNEXPECTED_SPAWN');};return ()=>n;}
const cloud=w=>{const s=w.connections.view();if(s.active!=='cloud')w.connections.update({mode:'cloud',expectedRevision:s.revision});};

test('QA-01 pure internal history is blocked in ordinary, edit, delete-prefix and multilevel forks before dispatch',async t=>{
 const w=setup(t),a=w.newConversation(),c=w.conversation(a.id);c.networkOrigin='intranet';const privateTurn=seed(w,c,'intranet'),tail=seed(w,c,'intranet'),count=blockSpawn(w);
 const f=await w.flow.fork(c.id,{turnId:privateTurn.id});const g=await w.flow.fork(f.id,{turnId:privateTurn.id});
 for(const id of [c.id,f.id,g.id])await assert.rejects(w.start(id,{message:'继续',fileIds:[],useConversationFiles:false}),/内网材料|内网上下文/);
 await assert.rejects(w.flow.fork(c.id,{turnId:tail.id,operation:'edit',message:'修改后继续'}),/内网材料|内网上下文/);
 const deleted=await w.flow.fork(c.id,{turnId:tail.id,operation:'delete'});await assert.rejects(w.start(deleted.id,{message:'继续',useConversationFiles:false}),/内网材料|内网上下文/);assert.equal(count(),0);
});
test('QA-01 cancelling private attachment selection cannot clear internal textual provenance',async t=>{
 const w=setup(t),v=w.newConversation(),c=w.conversation(v.id);w.connections.update({mode:'intranet',expectedRevision:1});w.upload(c.id,'合成内网附件.txt',Buffer.from('SYNTHETIC_PRIVATE_FILE'));const p=seed(w,c,'intranet');c.fileScope=[];cloud(w);const f=await w.flow.fork(c.id,{turnId:p.id});const count=blockSpawn(w);await assert.rejects(w.start(f.id,{message:'只继续说话',fileIds:[],useConversationFiles:false}),/内网/);assert.equal(count(),0);
});
test('QA-01 a clean deletion branch and public prefix do not inherit an unrelated mutable internal label',async t=>{
 const w=setup(t),a=w.newConversation(),c=w.conversation(a.id),pub=seed(w,c,'cloud','SYNTHETIC_PUBLIC'),priv=seed(w,c,'intranet');c.networkOrigin='intranet';
 const child=await w.flow.fork(c.id,{turnId:priv.id,operation:'delete'});assert.doesNotThrow(()=>w.connections.guard(w.conversation(child.id),[],null,'公开任务'));assert.equal(child.turns.length,1);
 const empty=await w.flow.fork(c.id,{turnId:pub.id,operation:'delete'});assert.equal(empty.turns.length,0);assert.doesNotThrow(()=>w.connections.guard(w.conversation(empty.id),[],null,'公开任务'));
});
test('QA-01 unknown legacy origins and cloud answers carrying internal dependencies are blocked',async t=>{
 const w=setup(t),a=w.newConversation(),c=w.conversation(a.id),old=seed(w,c,null);c.networkOrigin='cloud';assert.throws(()=>w.connections.guard(c,[],null,'继续'),/内网/);
 old.modelConnection={mode:'cloud'};old.historyProvenance={version:1,origin:'cloud',dependencies:[{origin:'intranet',conversationId:'synthetic-source',turnId:'synthetic-turn'}]};assert.throws(()=>w.connections.guard(c,[],null,'继续'),/内网/);
 w.connections.update({mode:'intranet',expectedRevision:1});assert.doesNotThrow(()=>w.connections.guard(c,[],null,'继续'));
});
test('QA-01 group inherited responses have the same outbound privacy gate',async t=>{
 const w=setup(t),v=w.groups.create({name:'合成群',participantIds:['general','finance']}),c=w.conversation(v.id);seed(w,c,'intranet');const count=blockSpawn(w);await assert.rejects(w.start(c.id,{message:'继续讨论',recipientBotId:'general',useConversationFiles:false}),/内网/);assert.equal(count(),0);
});
const records={guardPresentation:text=>({text,corrections:[],ambiguous:[]})};
async function settlement(t,request,{old=false,fail=false,missing=false}={}){const d=root(t),p=path.join(d,'actual.xlsx');fs.writeFileSync(p,'synthetic bytes; not an XLSX business test');const a={artifactId:'same-id',title:'synthetic',path:p,sha256:digest(fs.readFileSync(p))},extras={artifacts:new Map(missing?[]:[['same-id',a]]),initialArtifactIds:new Set(old?['same-id']:[]),inspect:async()=>({exportIntegrityPassed:digest(fs.readFileSync(p))===a.sha256})};const run={status:fail?'failed':'model_finished',...(fail?{termination:{reason:'model_error'}}:{})};return settleDelivery({docs:{directory:d,turnIntent:turnIntent(request)},extras,records},fail?'尚未执行任务':'已生成文件。',run);}
test('QA-02 implicit merging requires delivery and ordinary answers retain only new verified files',async t=>{
 assert.equal(turnIntent('合并这个报表').kind,'create_file');const r=await settlement(t,'合并这个报表');assert.equal(r.verifiedArtifacts.length,1);
 const implicit=await settlement(t,'你没有审查重复项目吗');assert.equal(implicit.verifiedArtifacts.length,1);
 const old=await settlement(t,'你好',{old:true});assert.equal(old.verifiedArtifacts.length,0);assert.equal(old.otherVerifiedArtifacts.length,1);
});
test('QA-02 explicit answer-only, retrieval and partial failure remain distinct',async t=>{
 const r=await settlement(t,'共有多少条，直接回答，不要再生成文件',{old:true});assert.equal(r.verifiedArtifacts.length,0);assert.equal(r.outcome,'answered');
 const existing=await settlement(t,'把刚才文件再发我',{old:true});assert.equal(existing.verifiedArtifacts[0].artifactId,'same-id');assert.equal(existing.verifiedArtifacts[0].generation,'existing');
 const partial=await settlement(t,'合并这个报表',{fail:true});assert.equal(partial.verifiedArtifacts.length,1);assert.equal(partial.outcome,'partial');assert.equal(partial.requirementsSatisfied,false);
 const none=await settlement(t,'合并这个报表',{fail:true,missing:true});assert.equal(none.verifiedArtifacts.length,0);assert.equal(none.requirements.find(x=>x.key==='requested_delivery').status,'unmet');
});
test('QA-03 metadata snapshot does not read blobs; revocation, file tampering and version changes still apply on access',async t=>{
 const d=root(t),space=new ResourceSpace(path.join(d,'space')),m=new ManagedWorkspace(space,'test');space.work('test','work');const r=m.importOriginal({name:'test.txt',bytes:Buffer.from('synthetic original'),conversationId:'c',workItemId:'work'}),actions=new LocalFileActions({root:d,space,managed:m,workspaceId:'test'});
 const snapshot=space.load();let loads=0;const load=space.load.bind(space);space.load=()=>{loads++;return load();};const page=m.list({},snapshot);actions.describeResource(r.resourceId,r.revisionId,snapshot);assert.equal(loads,0);assert.equal(page.total,1);
 const access=new BoundedFileAccess(),out=await access.resource(space,'test',r.resourceId,r.revisionId);assert.equal(digest(out.bytes),snapshot.resources[r.resourceId].revisions[r.revisionId].hash);
 fs.writeFileSync(path.resolve(space.root,space.check('test',r).metadata.managedPath),'modified by synthetic test');await assert.rejects(access.resource(space,'test',r.resourceId,r.revisionId),/内容已变化/);
 space.revoke('test',r);assert.equal(m.list().total,0);assert.throws(()=>actions.describeResource(r.resourceId,r.revisionId,space.load()),/REVOKED/);await assert.rejects(access.resource(space,'test',r.resourceId,r.revisionId),/REVOKED/);
});
test('QA-03 bounded file queue rejects overload and removes cancelled queued requests',async()=>{
 const a=new BoundedFileAccess({concurrency:1,maxQueued:1});let release;const first=a.run(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));const c=new AbortController(),queued=a.run(()=>assert.fail('cancelled work must not run'),c.signal);await assert.rejects(a.run(()=>{}),e=>e.status===503);c.abort();await assert.rejects(queued,e=>e.status===499);assert.equal(a.queue.length,0);release();await first;
});
test('QA-03 async list reads one index and rejects an in-flight revocation instead of returning stale grants',async t=>{
 const w=setup(t),c=w.newConversation();w.upload(c.id,'synthetic.txt',Buffer.from('synthetic metadata'));const f=w.conversation(c.id).files[0];let loads=0;const load=w.space.load.bind(w.space);w.space.load=()=>{loads++;return load();};
 const clean=await w.workspaceListing({});assert.equal(clean.resources.length,1);assert.equal(loads,1);
 const describe=w.localActions.describeResourceAsync.bind(w.localActions);let release,entered;
 const ready=new Promise(r=>entered=r);w.localActions.describeResourceAsync=async(...args)=>{entered();await new Promise(r=>release=r);return describe(...args);};
 const pending=w.workspaceListing({});await ready;w.space.revoke(w.workspaceId,f.ref);release();await assert.rejects(pending,/读取期间发生变化/);assert.equal(w.activeWorkspaceReads,0);assert.equal((await w.workspaceListing({})).resources.length,0);
 w.activeWorkspaceReads=8;await assert.rejects(w.workspaceListing({}),e=>e.status===503);w.activeWorkspaceReads=0;
});
