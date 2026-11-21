import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {ConversationActions,WORKFLOW_KEYS} from '../src/conversations/conversation-actions.mjs';import {Delegations} from '../src/workspace/delegations.mjs';import {DirectoryConnections} from '../src/integrations/directory-connections.mjs';import {sampleFiles} from '../src/workspace/samples.mjs';import {resolveArtifact} from '../src/documents/artifacts.mjs';import {readOriginal} from '../src/workspace/workspace-files.mjs';
import {modelFixture,temporary,waitFor,call} from './dsh-fixture.mjs';import {extractionReply} from './dsh-analysis-fixture.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
for(let n=1;n<=20;n++)test('DSH聊天到业务交付：场景'+String(n).padStart(2,'0'),async t=>{
  const scenarioId=String(n).padStart(2,'0');
  const x=await modelFixture(t,body=>{
    if(body.tools?.some(t=>t.function.name==='read_task_inputs')){assert.deepEqual(body.tools.map(t=>t.function.name).sort(),['read_task_inputs','submit_result']);return extractionReply(body);}
    if(!body.messages.some(m=>m.role==='tool'))return {calls:[call('run_workflow',{task:WORKFLOW_KEYS[n-1],instruction:'按材料生成本地交付，默认创建明确时间的提醒',self_name:'陈晨',...(scenarioId==='10'?{file_ids:[files[1].id],template_file_id:files[0].id,dedupe_columns:'项目名称'}:{}),...(scenarioId==='18'?{clip_ranges:[{start:0,end:2}]}:{})})]};
    return {text:'任务已排队，等待实际结果。'};
  });
  const store=new Store(temporary(t)),h=new Harness(store,{directory:x.directory});store.state.conversations=[{id:'c',title:'测试'}];store.state.jobs=[];store.state.runs=[];
  // Deterministic service fixtures for two non-LLM paths; not real intranet proof.
  h.directory.capabilities=[{kind:'multimodalEmbedding',ready:true,baseUrl:'http://10.0.0.94:8100',model:'fixture-embed'},{kind:'reranker',ready:true,baseUrl:'http://10.0.0.32:7071',model:'fixture-rerank'}];
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(url,options)=>{if(!String(url).startsWith('http://10.0.0.94:8100')&&!String(url).startsWith('http://10.0.0.32:7071'))return originalFetch(url,options);const b=JSON.parse(options?.body||'{}');return new Response(JSON.stringify(url.endsWith('/v1/embeddings')?{data:b.input.map((_v,index)=>({index,embedding:[1,0.5]}))}:{results:b.documents.map((_v,index)=>({index,relevance_score:1}))}));};
  h.directory.refresh=async()=>{};h.directory.discoverMore=async()=>{};h.directory.status=()=>({services:{chat:{ready:true}},capabilities:[]});
  const w=new Workspace(store,h),d=new Delegations(store,w);h.chatActions=new ConversationActions(store,w,h,d);h.directories=new DirectoryConnections(store);
  const files=[];for(const f of await sampleFiles(scenarioId))files.push(await w.upload(f));
  if(scenarioId==='18'){files[0].content='[00:00] 测试会议原文。';files[0].parseStatus='ready';files[0].recognition={kind:'asr',model:'fixture-reviewed',confirmedAt:new Date().toISOString(),confirmedTextHash:hash(Buffer.from(files[0].content))};}
  const run=h.start('按给定材料执行场景 '+scenarioId,{conversationId:'c',fileIds:files.map(f=>f.id)});await waitFor(()=>!h.active.has(run.id));assert.equal(run.status,'done',run.error);assert.equal(run.harness.name,'DeepSeek Harness');
  await waitFor(()=>w.active.size===0);const job=store.state.jobs[0];assert(job,'聊天应产生真实后台任务');assert.equal(job.scenarioId,scenarioId);assert.equal(job.conversationId,'c');assert(!['failed','cancelled','interrupted','waiting_input','queued','running'].includes(job.status),job.error);assert(job.artifacts.length>0);assert(job.checks.every(c=>c.passed));
  for(const a of job.artifacts)assert.equal(hash(resolveArtifact(store,job.id,a.id).bytes),a.sha256);
  for(const f of files)assert.equal(hash(readOriginal(store,f)),f.sha256);
  if(scenarioId==='09'){assert.equal(job.totals.totalCents,null);assert.equal(job.totals.exceptions,4);assert.equal(job.invoiceVerification.documents,4);assert.equal(job.invoiceVerification.eligibility,'not_evaluated');assert(job.artifacts.some(a=>a.name==='票据证据与字段账本.json'));}if(scenarioId==='10')assert.equal(job.appended,1);if(scenarioId==='15')assert.equal(store.state.tasks.length,2);if(scenarioId==='14')assert(store.state.knowledge.length>0);
});
