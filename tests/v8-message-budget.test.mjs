import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {applyMessagePolicy} from '../v8-tools/execution-policy.mjs';import {Continuity} from '../v8-tools/continuity.mjs';import {ToolHarness,runToolAgent,chatApi} from '../v8-tools/harness.mjs';
function root(t){const base=fs.realpathSync(os.tmpdir()),r=fs.mkdtempSync(path.join(base,'v8-message-budget-'));t.after(()=>{assert.equal(path.dirname(r),base);fs.rmSync(r,{recursive:true,force:true});});return r;}
test('web ordinary messages override old 24/40/100 limits even with global contract configuration present',()=>{const p=applyMessagePolicy({maxRounds:24,maxCalls:100,contractReview:{enabled:true},assistantRouting:{phase:'offer'},continuity:{conversationId:'c',maxCumulativeModelRequests:40,maxCumulativeToolAttempts:100}});assert.equal(p.maxRounds,70);assert.equal(p.maxCalls,null);assert.equal(p.continuity.maxCumulativeModelRequests,null);assert.equal(p.continuity.maxCumulativeToolAttempts,null);});
test('resume gets fresh 70 requests; historical cumulative counters remain audit-only; task scope is enforced',t=>{
 const space=root(t),base={request:'synthetic',continuity:{spaceRoot:space,projectId:'p',workItemId:'w',conversationId:'c'}};
 const legacy=new Continuity({...base,continuity:{...base.continuity,maxCumulativeModelRequests:1,maxCumulativeToolAttempts:1}});legacy.spend('model');legacy.spend('tool');
 const open=id=>new Continuity(applyMessagePolicy({...base,continuity:{...base.continuity,mode:'resume',resumeRunId:id}}));
 const a=open(legacy.runId);for(let i=0;i<70;i++)a.spend('model');assert.throws(()=>a.spend('model'),/MESSAGE_MODEL_BUDGET_EXHAUSTED/);for(let i=0;i<120;i++)a.spend('tool');
 const b=open(a.runId);for(let i=0;i<70;i++)b.spend('model');assert.throws(()=>b.spend('model'),/MESSAGE_MODEL_BUDGET_EXHAUSTED/);
 const state=b.space.load();assert.equal(state.runs[legacy.runId].budget.modelRequests,141);assert.equal(state.runs[legacy.runId].budget.maxModelRequests,null);assert.equal(state.runs[a.runId].messageBudget.modelRequests,70);assert.equal(state.runs[b.runId].messageBudget.modelRequests,70);
 assert.throws(()=>new Continuity(applyMessagePolicy({...base,continuity:{...base.continuity,workItemId:'foreign',mode:'resume',resumeRunId:a.runId}})),/RESUME_SCOPE_DENIED/);
});
test('70 physical model requests include retries and reserve final response; tool calls have no old 24/100 cap',async t=>{
 const directory=root(t),h=new ToolHarness({directory,tools:[{name:'step',inputSchema:{type:'object',properties:{n:{type:'integer'}},required:['n']},execute:async a=>a}],maxCalls:null,maxNoProgress:null});let network=0;
 const api=chatApi({baseUrl:'http://synthetic.invalid/v1',model:'explicit-synthetic',retryDelaysMs:[0],fetchImpl:async(_u,o)=>{network++;if(network===1)throw new TypeError('fetch failed');const input=JSON.parse(o.body),message=input.tools?{role:'assistant',tool_calls:[1,2].map(n=>({id:'tool-'+network+'-'+n,function:{name:'step',arguments:JSON.stringify({n:network*2+n})}}))}:{role:'assistant',content:'已有步骤已完成；余项保留，需继续时发新消息。'};return new Response(JSON.stringify({choices:[{finish_reason:input.tools?'tool_calls':'stop',message}]}));}});
 const r=await runToolAgent({harness:h,next:api,request:'explicit synthetic accounting',maxRounds:70,reserveFinalRound:true});assert.equal(network,70);assert.equal(r.metrics.modelRequests,70);assert.equal(r.termination,null);assert(r.calls>100);assert.equal(r.contentVerified,false);
});
