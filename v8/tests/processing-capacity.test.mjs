import test from 'node:test';import assert from 'node:assert/strict';
import {PROCESSING_LIMITS as limits,scaledLimit,contextBudget} from '../src/runtime/processing-capacity.mjs';
import {inferenceProfile} from '../src/integrations/inference-config.mjs';
import {RECOVERY_POLICY,RecoverySession} from '../src/recovery/task-recovery.mjs';
import {SUPPLEMENT_POLICY} from '../src/recovery/supplement-plan.mjs';
import {POLICY as invoicePolicy} from '../src/invoices/invoice-stages.mjs';
import {DELIVERY_TABLE_LIMITS} from '../src/documents/file-delivery.mjs';
import {TEXT_PAGE_CHARS} from '../src/documents/attachment-text-view.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';
test('capacity 2.5x increases work without increasing concurrency or the provider window',()=>{
 assert.equal(limits.historyTurns,10);assert.equal(limits.historyAnswerChars,5000);
 assert.equal(limits.chatRounds,18);assert.equal(limits.chatToolCalls,30);
 assert.equal(limits.chatOutputTokens,8750);assert.equal(limits.visualOutputTokens,15000);
 assert.equal(limits.ocrPages,25);assert.equal(limits.audioSeconds,1250);assert.equal(TEXT_PAGE_CHARS,40000);
 assert.equal(limits.parallelTools,1);assert.equal(limits.analysisConcurrency,2);assert.equal(limits.adapterContextTokens,128000);
 assert.equal(DELIVERY_TABLE_LIMITS.columns,100);assert.equal(DELIVERY_TABLE_LIMITS.rows,3000);assert.equal(DELIVERY_TABLE_LIMITS.cells,30000);
});
test('capacity inference profile expands once and records base limits for replay',()=>{
 const input={provider:'intranet',inference:{max_output_tokens:6500,context_budget_tokens:28000,timeout_ms:180000}};
 const p=inferenceProfile(input);assert.equal(p.max_output_tokens,16250);assert.equal(p.context_budget_tokens,70000);assert.equal(p.timeout_ms,450000);
 const repeated=inferenceProfile({...input,inference:p});assert.deepEqual(repeated,p);
});
test('capacity a large configured budget stays within the real adapter context window',()=>{
 const p=inferenceProfile({inference:{max_output_tokens:12000,context_budget_tokens:128000}});
 assert.equal(p.max_output_tokens,30000);assert(p.context_budget_tokens+p.max_output_tokens+limits.contextReserveTokens<=p.context_window_tokens);
 assert.equal(contextBudget(320000,30000),89808);assert.equal(scaledLimit(0),0);assert.throws(()=>scaledLimit(-1));
});
test('capacity recovery, supplements and invoice work are bounded at expanded limits',()=>{
 assert.equal(RECOVERY_POLICY.maxCumulativeRequests,320);assert.equal(RECOVERY_POLICY.maxRequestsPerRound,30);assert.equal(RECOVERY_POLICY.concurrency,2);
 assert.equal(SUPPLEMENT_POLICY.maxProtocolRequests,10);assert.equal(SUPPLEMENT_POLICY.maxBatchCharacters,13750);
 assert.equal(invoicePolicy.maxPages,25);assert.equal(invoicePolicy.maxRequests,150);assert.equal(invoicePolicy.concurrency,1);assert.equal(invoicePolicy.maxRetries,5);
});

test('capacity actual chat assembly passes expanded history and budgets to the Harness',async t=>{
 const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,'v7-capacity-'));
 t.after(()=>{assert.equal(path.dirname(dir),root);assert(path.basename(dir).startsWith('v7-capacity-'));fs.rmSync(dir,{recursive:true,force:true});});
 const store=new Store(dir);store.state.conversations=[{id:'capacity-chat'}];store.state.jobs=[];store.state.workspaceFiles=[];
 const recoveryJob={id:'capacity-recovery',scenarioId:'08',startedAt:new Date().toISOString(),artifacts:[]};store.state.jobs.push(recoveryJob);
 const recovery=new RecoverySession({store,job:recoveryJob,units:[],identity:{scopeHash:'fixture',unitsHash:'fixture',modelConfigFingerprint:'fixture',promptVersions:{}}});
 assert.equal(recovery.policy.roundTimeMs,2250000);assert.equal(recovery.policy.requestWindowMs,450000);assert.equal(recovery.policy.deliveryReserveMs,37500);
 store.state.runs=Array.from({length:14},(_,i)=>({id:'history-'+i,conversationId:'capacity-chat',status:'done',kind:'chat',request:'HISTORY_REQUEST_'+i,answer:'HISTORY_ANSWER_'+i+' '+ 'x'.repeat(4400)+' WITHIN_NEW_HISTORY_'+i+' '+ 'y'.repeat(1000)+' BEYOND_NEW_HISTORY_'+i}));
 let input;const harness=new Harness(store,{directory:{services:{chat:{ready:true}},connection:()=>({label:'fixture'}),status:()=>({})},runAgent:async args=>{input=args;return {answer:'stub: configuration wiring only'};}});
 const run=harness.start('请概括最近讨论的重点',{conversationId:'capacity-chat'}),deadline=Date.now()+3000;
 while(harness.active.size&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.equal(run.status,'done',run.error);assert(input);
 assert.equal(input.maxRounds,18);assert.equal(input.maxCalls,30);assert.equal(input.maxTokens,8750);assert.equal(input.timeoutMs,300000);
 assert(input.systemPrompt.includes('WITHIN_NEW_HISTORY_4'));assert(input.systemPrompt.includes('WITHIN_NEW_HISTORY_13'));
 assert(!input.systemPrompt.includes('HISTORY_REQUEST_3'));assert(!input.systemPrompt.includes('BEYOND_NEW_HISTORY_13'));
 assert(input.systemPrompt.includes('每页最多40000字符'));
});
