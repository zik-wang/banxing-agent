import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';
import {Continuity} from '../v8-tools/continuity.mjs';
import {WebWorkspace} from '../v8-web/server.mjs';
import {digest,ResourceSpace} from '../v8-tools/resource-space.mjs';
import {applyAdaptivePolicy} from '../v8-tools/execution-policy.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
const root=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'adaptive-'));t.after(async()=>{await new Promise(r=>setTimeout(r,50));assert(d.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(d,{recursive:true,force:true,maxRetries:5,retryDelay:20});});return d;};
const call=(name,args)=>({role:'assistant',tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('adaptive execution crosses former round/tool/discovery caps and still finishes by model decision',async t=>{
 const config=applyAdaptivePolicy({continuity:{}}),tools=Array.from({length:30},(_,i)=>({name:'read_part_'+i,description:'Read part '+i,inputSchema:{type:'object',properties:{page:{type:'integer'}}},execute:async a=>a}));
 const h=new ToolHarness({directory:root(t),tools,...config}),steps=140;let n=0;
 const r=await runToolAgent({harness:h,maxRounds:config.maxRounds,request:'Read a long document',next:async()=>++n<=steps?call(n%3?'read_part_0':'discover_tools',n%3?{page:n}:{query:'read_part_'+n%30}):{role:'assistant',content:'Finished after reading the required parts'}});
 assert.equal(r.status,'model_finished');assert.equal(r.termination,null);assert.equal(r.calls,140);assert.equal(r.metrics.modelRequests,141);assert(r.metrics.discoveryCalls>8);assert.equal(r.maxModelRounds,null);
});

test('adaptive ledger survives legacy cumulative limit and continues counting',t=>{
 const d=root(t),space=new ResourceSpace(path.join(d,'space'));space.project('p');space.work('p','w');
 const c=new Continuity(applyAdaptivePolicy({directory:d,request:'Read',continuity:{spaceRoot:space.root,projectId:'p',workItemId:'w'}}));
 for(let i=0;i<125;i++){c.spend('model');c.spend('tool');}
 const b=c.space.load().runs[c.rootId].budget;assert.equal(b.modelRequests,125);assert.equal(b.toolAttempts,125);assert.equal(b.maxModelRequests,null);assert.equal(b.maxToolAttempts,null);
});

test('unlimited loop honours cancellation and exposes tool errors for a different model choice',async t=>{
 const controller=new AbortController(),h=new ToolHarness({directory:root(t),tools:[],maxCalls:null,maxNoProgress:null,signal:controller.signal});let n=0;
 const r=await runToolAgent({harness:h,maxRounds:null,request:'Read',next:async()=>{if(++n===9)controller.abort();return call('missing',{});}});
 assert.equal(r.termination.reason,'cancelled');assert.equal(n,9);assert.equal(r.calls,8);assert(r.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).error.code==='UNKNOWN_TOOL'));
});

test('empty model answer is not mislabeled as budget exhaustion in adaptive mode',async t=>{
 const h=new ToolHarness({directory:root(t),tools:[],maxCalls:null});
 const r=await runToolAgent({harness:h,maxRounds:null,request:'Read',next:async()=>({role:'assistant',content:null})});
 assert.equal(r.termination.reason,'empty_model_answer');assert(!r.answer.includes('预算已耗尽'));
});

test('adaptive document pipeline has no hidden eight-image request cap',t=>{
 const docs=new DocumentTools({directory:path.join(root(t),'run'),inputs:[],python:process.env.V8_PYTHON||process.execPath,executionPolicy:{mode:'adaptive'}});
 assert.equal(docs.maxVisionCalls,Infinity);
});

// Host queue/real resource transactions; model and worker output are explicit fixtures.
async function workflow(t,plan){
 const d=root(t),w=new WebWorkspace({dataRoot:d,chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'OFFLINE_FIXTURE'}}),c=w.conversation(w.newConversation().id);w.upload(c.id,'public.txt',Buffer.from('public fixture'));
 const ref=c.files[0].ref,profiles=[];
 w.spawnRun=(_bin,args)=>{const p=JSON.parse(fs.readFileSync(args[1],'utf8'));profiles.push(p);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  queueMicrotask(()=>{fs.mkdirSync(p.directory,{recursive:true});const decision=plan(p,profiles.length,{w,c,ref}),handoff=decision?.bot,answer='Explicit offline worker result';
   if(handoff)fs.writeFileSync(path.join(p.directory,'assistant-handoff.json'),JSON.stringify({id:randomUUID(),sourceTurnId:p.continuity.interactionId,sourceBotId:p.botPolicy.id,targetBotId:handoff,reason:'Another colleague fits this task',reviewFocus:'Check the actual result',reviewRequired:decision.review!==false,reviewerBotId:decision.reviewer||p.botPolicy.id,requestHash:digest(p.request),refs:decision.refs||[ref],projectId:c.workspaceId}));
   fs.writeFileSync(path.join(p.directory,'delivery-settlement.json'),JSON.stringify({answer,outcome:handoff?'partial':'answered',requirementsSatisfied:!handoff,verifiedArtifacts:[]}));
   fs.writeFileSync(path.join(p.directory,'agent-run.json'),JSON.stringify({answer,termination:handoff?{reason:'assistant_handoff_requested'}:null,metrics:{modelRequests:40}}));child.stdout.end();child.stderr.end();child.emit('close',0);
  });return child;};
 await w.start(c.id,{message:'Work with the appropriate colleague'});
 for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,15));if(!w.jobs.size&&!c.pending?.length)break;await w.flow.pump();}
 return {w,c,profiles,ref};
}

test('model can skip extra review; no hidden 24-call or 10-minute route budget',async t=>{
 const {c,profiles}=await workflow(t,(_p,n)=>n===1?{bot:'finance',review:false}:null);
 assert.deepEqual(profiles.map(p=>p.botPolicy.id),['general','finance']);assert.equal(c.assistantRoutes[0].state,'completed');assert.equal(c.assistantRoutes[0].expiresAt,undefined);
 for(const p of profiles){assert.equal(p.executionPolicy.mode,'adaptive');assert.equal(p.maxRounds,null);assert.equal(p.maxCalls,null);assert.equal(p.timeoutMs,null);}
});

test('model chooses a separate reviewer instead of mandatory return to source',async t=>{
 const {c,profiles}=await workflow(t,(_p,n)=>n===1?{bot:'finance',reviewer:'review'}:null);
 assert.deepEqual(profiles.map(p=>p.botPolicy.id),['general','finance','review']);assert.equal(c.assistantRoutes[0].state,'reviewed');assert.equal(c.assistantRoutes[0].contentVerified,false);
});

test('nested delegation returns receipts without delegating back to an ancestor',async t=>{
 const {c,profiles}=await workflow(t,(p,n)=>n===1?{bot:'finance'}:n===2?{bot:'review'}:null);
 assert.deepEqual(profiles.map(p=>p.botPolicy.id),['general','finance','review','finance','general']);
 assert(c.assistantRoutes.every(r=>r.state==='reviewed'));assert(c.assistantRoutes[0].workerReceipt.delegatedRouteId);
 assert(!profiles[1].assistantRouting.bots.some(b=>b.id==='general'));assert(!profiles[2].assistantRouting.bots.some(b=>['general','finance'].includes(b.id)));
});

test('cancel removes pending collaborators while retaining unrelated queued user messages',async t=>{
 const {w,c}=await workflow(t,()=>null);c.assistantRoutes=[{id:'a',state:'worker_queued'},{id:'b',state:'delegated'}];c.pending=[{id:'worker',assistantRoute:{id:'a'}},{id:'user'}];
 const r=w.cancel(c.id);assert.equal(r.cancelled,true);assert(c.assistantRoutes.every(r=>r.state==='cancelled'));assert.deepEqual(c.pending.map(t=>t.id),['user']);
});

test('a forged delegation cannot include an unrelated workspace original',async t=>{
 const {c,profiles}=await workflow(t,(_p,n,{w,c})=>n===1?{bot:'finance',refs:[w.space.put({projectId:c.workspaceId,workItemId:'unrelated',kind:'original',bytes:Buffer.from('not selected for this task'),metadata:{name:'unrelated.txt'}})]}:null);
 assert.equal(profiles.length,1);assert.equal(c.turns[0].status,'failed');assert.match(c.turns[0].error,/SCOPE_EXPANSION/);assert(!c.assistantRoutes?.length);
});
