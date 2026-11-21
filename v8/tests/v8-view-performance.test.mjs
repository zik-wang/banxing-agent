import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ResourceSpace,digest} from '../v8-tools/resource-space.mjs';
import {WebWorkspace} from '../v8-web/server.mjs';

function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'v8-view-perf-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function countIndexReads(space,fn){const original=fs.readFileSync;let count=0;fs.readFileSync=function(file,...args){if(String(file)===space.file)count++;return original.call(this,file,...args);};try{return {value:fn(),count};}finally{fs.readFileSync=original;}}
function workspace(t){return new WebWorkspace({dataRoot:directory(t),chat:{provider:'intranet',baseUrl:'http://10.255.255.1:1/v1',model:'offline-test'},python:process.execPath});}

test('nested synchronous reads share one index, and the next request reloads it',t=>{
 const s=new ResourceSpace(directory(t));s.project('p');
 const measured=countIndexReads(s,()=>s.withReadSnapshot(()=>{const a=s.load();assert.equal(a,s.load());s.withReadSnapshot(()=>assert.equal(a,s.load()));return a;}));
 assert.equal(measured.count,1);assert.notEqual(s.load(),measured.value);
});
test('a thrown view cannot leak its cached snapshot into later access checks',t=>{
 const s=new ResourceSpace(directory(t));s.project('p');const ref=s.put({projectId:'p',workItemId:'w',kind:'original',bytes:Buffer.from('data')});
 assert.throws(()=>s.withReadSnapshot(()=>{s.check('p',ref);throw Error('view failed');}),/view failed/);
 new ResourceSpace(s.root).revoke('p',ref);
 assert.throws(()=>s.withReadSnapshot(()=>s.check('p',ref)),{code:'RESOURCE_REVOKED'});
});
test('a write inside a read scope starts from disk and invalidates its snapshot',t=>{
 const s=new ResourceSpace(directory(t));s.project('p');const other=new ResourceSpace(s.root);
 s.withReadSnapshot(()=>{s.load();other.project('external');s.project('internal');assert.ok(s.load().projects.external);assert.ok(s.load().projects.internal);});
 assert.ok(other.load().projects.external);assert.ok(other.load().projects.internal);
});
test('a full conversation view reads the index once while preserving attachments and artifacts',t=>{
 const w=workspace(t),c=w.newConversation();
 for(let i=0;i<3;i++)w.upload(c.id,'input'+i+'.txt',Buffer.from('offline synthetic input '+i));
 const file=path.join(w.root,'result.txt');fs.writeFileSync(file,'offline synthetic result');
 const a={artifactId:'22222222-2222-4222-8222-222222222222',path:file,sha256:digest(fs.readFileSync(file)),title:'result',readbackPassed:true};
 const ref=w.space.put({projectId:w.workspaceId,workItemId:c.id,kind:'artifact',bytes:fs.readFileSync(file),metadata:{artifactId:a.artifactId}});
 const result=w.space.put({projectId:w.workspaceId,workItemId:c.id,kind:'result',bytes:Buffer.from(JSON.stringify({tables:[],artifacts:[{record:a}]})),parents:[ref]});
 w.state.conversations[c.id].turns.push({id:'33333333-3333-4333-8333-333333333333',status:'completed',request:'synthetic test',answer:'done',artifacts:[a],resultRef:result});
 const measured=countIndexReads(w.space,()=>w.view(c.id));
 assert.equal(measured.count,1);assert.equal(measured.value.files.length,3);assert.equal(measured.value.turns[0].localFiles[0].available,true);assert.equal(measured.value.turns[0].canSelect,true);
 w.space.revoke(w.workspaceId,ref);
 const after=w.view(c.id);assert.equal(after.turns[0].localFiles[0].available,false);assert.equal(after.turns[0].canSelect,false);
});
test('attachment removal, cross-workspace access and changed download bytes remain blocked',t=>{
 const w=workspace(t),c=w.newConversation();w.upload(c.id,'input.txt',Buffer.from('original'));const f=w.conversation(c.id).files[0];
 assert.equal(w.view(c.id).files.length,1);w.space.revoke(w.workspaceId,f.ref);assert.equal(w.view(c.id).files.length,0);
 assert.throws(()=>w.space.withReadSnapshot(()=>w.space.read('alien',f.ref)),{code:'RESOURCE_SCOPE_DENIED'});
 const file=path.join(w.root,'result.txt');fs.writeFileSync(file,'good');const hash=digest('good');assert.equal(w.verifiedPath(file,hash),file);fs.writeFileSync(file,'changed');assert.throws(()=>w.verifiedPath(file,hash),/文件内容已变化/);
});

function pollContext(){const source=fs.readFileSync(new URL('../v8-web/app.js',import.meta.url),'utf8');const start=source.indexOf('let pollInFlight=false;'),end=source.indexOf("document.addEventListener('visibilitychange'",start);assert.ok(start>=0&&end>start);const timers=[],context=vm.createContext({document:{hidden:false},busy:false,setTimeout:(fn,ms)=>timers.push({fn,ms})});vm.runInContext(source.slice(start,end),context);return {context,timers,source};}
test('slow polling is single-flight even when manual refresh and timer overlap',async()=>{
 const {context}=pollContext();let release,started=0;context.pollConversation=()=>{started++;return new Promise(r=>{release=r;});};
 const first=context.poll();await context.poll();await context.poll();assert.equal(started,1);release();await first;
 context.pollConversation=async()=>{started++;};await context.poll();assert.equal(started,2);
});
test('polling schedules after completion, slows idle tabs, and pauses hidden tabs',async()=>{
 const {context,timers,source}=pollContext();let calls=0,release;context.pollConversation=()=>{calls++;return new Promise(r=>{release=r;});};
 const tick=context.pollingTick();assert.equal(timers.length,0);release();await tick;assert.equal(timers.at(-1).ms,10000);
 context.pollConversation=async()=>{calls++;};context.busy=true;await context.pollingTick();assert.equal(timers.at(-1).ms,1400);
 context.document.hidden=true;const before=calls;await context.pollingTick();assert.equal(calls,before);assert.equal(timers.at(-1).ms,30000);assert.ok(!source.includes('setInterval(poll,1400)'));
});
test('a failed refresh releases the in-flight guard for the next attempt',async()=>{
 const {context}=pollContext();context.pollConversation=async()=>{throw Error('offline synthetic network error');};await assert.rejects(context.poll(),/network error/);
 let called=false;context.pollConversation=async()=>{called=true;};await context.poll();assert.equal(called,true);
});
