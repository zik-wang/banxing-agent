import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WebWorkspace} from '../v8-web/server.mjs';
import {Continuity} from '../v8-tools/continuity.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {MoneyTools} from '../v8-tools/money-tools.mjs';
import {handoffMoney} from '../v8-tools/handoff-money.mjs';

async function fixture(t,{calculate=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'money-handoff-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const w=new WebWorkspace({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'OFFLINE_NO_REQUESTS'}});
 const c=w.conversation(w.newConversation().id);w.upload(c.id,'synthetic.txt',Buffer.from('设备人民币1.25亿元；安装人民币360万元；服务人民币48000元。'));
 const refs=[c.files[0].ref],request='核算合成金额并保留依据',turnId=randomUUID(),id=randomUUID();
 const cfg={directory:path.join(root,'worker'),python:process.execPath,request,inputClassification:'private',continuity:{spaceRoot:w.space.root,projectId:c.workspaceId,workItemId:c.workItemId,interactionId:turnId,selectedInputs:refs,selectedResult:null}};
 const continuity=new Continuity(cfg),docs=new DocumentTools({...cfg,inputs:[]}),extras={artifacts:new Map()},records={sources:new Map(),records:new Map()};
 continuity.bind({docs,extras,records});
 const assetId=[...docs.assets.keys()][0],plan={asset_ids:[assetId],operation:'sum',operands:[{value:'1.25',unit:'亿元',currency:'CNY',quote:'设备人民币1.25亿元'},{value:'360',unit:'万元',currency:'CNY',quote:'安装人民币360万元'},{value:'48000',unit:'元',currency:'CNY',quote:'服务人民币48000元'}]};
 let receipt;if(calculate)receipt=await continuity.wrap(new MoneyTools(docs,new TextTools(docs)).tools())[0].execute(plan,{});
 const final=continuity.finish({state:'answered',verifiedArtifacts:[]});
 const route={id,sourceBotId:'general',targetBotId:'finance',reviewerBotId:'general',reviewRequired:true,refs,request,reviewFocus:'核对来源与金额',state:'worker_queued'};c.assistantRoutes=[route];
 const turn={id:turnId,runId:final.runId,resultRef:final.resultRef,assistantRoute:{id,phase:'work'},status:'answered',answer:'B摘要故意写999元；复核必须使用实际回执。',artifacts:[]};
 const args={projectId:c.workspaceId,workItemId:c.workItemId,runId:turn.runId,turnId,request,refs};
 const context=()=>{const profile={directory:path.join(root,'review'),continuity:{}};w.routing.configure(c,{botSnapshot:{id:'general'}},profile,{assistantRoute:{id,phase:'verify'}});return profile.interactionContext.assistantHandoff.workerReceipt;};
 return {w,c,continuity,docs,receipt,route,turn,args,context};
}
test('actual MoneyTools operation/checkpoint -> route settlement -> A context preserves receipt and domains',async t=>{
 const f=await fixture(t);f.w.routing.afterSettle(f.c,f.turn);
 assert.equal(f.route.state,'review_queued');assert.equal(f.c.pending.length,1);
 const evidence=f.context().moneyEvidence;assert.equal(evidence.state,'source_and_arithmetic_bound');
 const r=evidence.receipts[0];assert.deepEqual(r.receipt,f.receipt);assert.equal(r.receipt.results[0].amount,'128648000.00');assert.equal(r.receipt.results[0].unit,'元');
 assert.equal(r.binding.runId,f.turn.runId);assert.equal(r.binding.turnId,f.turn.id);assert.equal(r.digests.planJson,r.receipt.planSha256);assert.equal(r.digests.sourceJsonString,r.receipt.sourceSha256);
 assert(!JSON.stringify(evidence).includes('999元'));assert(!JSON.stringify(evidence).includes('设备人民币1.25亿元；安装人民币360万元；服务人民币48000元。'));
 // Reconfiguration is safe and does not enqueue another review or alter receipt IDs.
 assert.deepEqual(f.context().moneyEvidence,evidence);assert.equal(f.c.pending.length,1);
});
test('no receipt remains explicitly unverified through actual route entry',async t=>{
 const f=await fixture(t,{calculate:false});f.w.routing.afterSettle(f.c,f.turn);
 assert.equal(f.context().moneyEvidence.state,'unverified');assert.deepEqual(f.context().moneyEvidence.receipts,[]);
});
test('alien run, task, work, project, interaction and excluded source cannot be forwarded',async t=>{
 const f=await fixture(t);for(const field of ['runId','request','workItemId','projectId','turnId']){
  const r=handoffMoney(f.w.space,{...f.args,[field]:'alien'});assert.equal(r.state,'unverified',field);assert.deepEqual(r.receipts,[]);
 }
 assert.equal(handoffMoney(f.w.space,{...f.args,refs:[]}).state,'unverified');
 f.w.space.exclude(f.args.projectId,f.args.workItemId,f.args.refs);
 // configure enforces conversation exclusions in addition to the collector's scope checks.
 f.w.routing.afterSettle(f.c,f.turn);assert.throws(()=>f.context(),/EXCLUDED/);
});
test('mismatched completed plan and modified tool result are rejected, not prose fallback',async t=>{
 const f=await fixture(t),state=f.w.space.load(),op=Object.values(state.operations).find(o=>o.tool==='calculate_money');
 f.w.space.tx(s=>s.operations[Object.keys(s.operations).find(k=>s.operations[k].operationId===op.operationId)].args.operands[0].value='1.26');
 assert.equal(handoffMoney(f.w.space,f.args).state,'unverified');
});
test('checkpoint money amount tampering and later route receipt tampering stay unverified',async t=>{
 const f=await fixture(t);f.w.routing.afterSettle(f.c,f.turn);
 f.route.workerReceipt.moneyEvidence.receipts[0].receipt.results[0].amount='1.00';
 assert.deepEqual(f.context().moneyEvidence.issues,['MONEY_EVIDENCE_CHANGED']);
 const run=f.w.space.load().runs[f.turn.runId],bundle=JSON.parse(f.w.space.read(f.args.projectId,run.checkpoint));
 bundle.results.find(r=>r.method==='money_calculation').moneyReceipt.results[0].amount='2.00';
 const ref=f.continuity.saveRef('checkpoint',Buffer.from(JSON.stringify(bundle)),{bundle:true});
 f.w.space.tx(s=>s.runs[f.turn.runId].checkpoint=ref);
 assert.equal(handoffMoney(f.w.space,f.args).state,'unverified');
});
test('another producer checkpoint cannot substitute for the settled worker checkpoint',async t=>{
 const f=await fixture(t),run=f.w.space.load().runs[f.turn.runId];
 const ref=f.w.space.put({projectId:f.args.projectId,workItemId:f.args.workItemId,kind:'checkpoint',bytes:f.w.space.read(f.args.projectId,run.checkpoint),parents:f.args.refs,metadata:{bundle:true,producerRunId:'another-run'}});
 f.w.space.tx(s=>s.runs[f.turn.runId].checkpoint=ref);
 assert.deepEqual(handoffMoney(f.w.space,f.args).issues,['CHECKPOINT_PRODUCER_MISMATCH']);
});
test('completed operation receipt tampering is rejected even when checkpoint is intact',async t=>{
 const f=await fixture(t);
 f.w.space.tx(s=>{const op=Object.values(s.operations).find(o=>o.tool==='calculate_money');op.result.receiptId='MONEY-forged';});
 assert.deepEqual(handoffMoney(f.w.space,f.args).issues,['MONEY_RECEIPT_OR_PLAN_CHANGED']);
});
test('legacy worker without a run ID queues review but never asserts verified money',async t=>{
 const f=await fixture(t);delete f.turn.runId;f.w.routing.afterSettle(f.c,f.turn);
 assert.equal(f.route.state,'review_queued');assert.deepEqual(f.context().moneyEvidence.issues,['WORKER_RUN_UNAVAILABLE']);
});

