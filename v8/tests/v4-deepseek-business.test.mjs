import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {ConversationActions} from '../src/conversations/conversation-actions.mjs';
import {modelFixture,temporary,waitFor,call} from './dsh-fixture.mjs';import {extractionReply} from './dsh-analysis-fixture.mjs';
import {sampleFiles} from '../src/workspace/samples.mjs';
async function setup(t,respond){const x=await modelFixture(t,respond),store=new Store(temporary(t)),h=new Harness(store,{directory:x.directory}),w=new Workspace(store,h);store.state.conversations=[{id:'c',title:'测试'}];store.state.runs=[];store.state.jobs=[];h.chatActions=new ConversationActions(store,w,h);const file=await w.upload({name:'背景.txt',base64:Buffer.from('上次会议结论：先完成本地演示。').toString('base64')});return {x,store,h,w,file};}
test('明确交办口头结束后由DSH续接一次，最终排队并交付',async t=>{
  const q=await setup(t,body=>{if(body.tools?.some(t=>t.function.name==='read_task_inputs'))return extractionReply(body);if(body.messages.some(m=>m.role==='tool'))return {text:'任务已排队。'};if(body.messages.filter(m=>m.role==='user').length>1)return {calls:[call('run_workflow',{task:'meeting_brief',instruction:'整理已有材料'})]};return {text:'我可以整理，请补充参会人。'};});
  const r=q.h.start('整理一份会前资料',{conversationId:'c',fileIds:[q.file.id]});await waitFor(()=>!q.h.active.size);assert.equal(r.status,'done',r.error);await waitFor(()=>!q.w.active.size);assert.equal(q.store.state.jobs.length,1);assert.equal(q.store.state.jobs[0].scenarioId,'03');assert.equal(r.trace.filter(t=>t.type==='repair').length,1);assert(r.harnessSession.events>0);
});
test('用户明确只要建议时不会因补救机制执行后台任务',async t=>{
  const q=await setup(t,()=>({text:'可以先检查已有材料。'}));const r=q.h.start('整理一份会前资料，仅建议，先不要执行',{conversationId:'c',fileIds:[q.file.id]});await waitFor(()=>!q.h.active.size);assert.equal(r.status,'done');assert.equal(q.x.requests.length,1);assert.equal(q.store.state.jobs.length,0);
});
test('父聊天在排队后发生模型错误，子任务取消，不能产生交付',async t=>{
  const q=await setup(t,(_body,n)=>n===1?{calls:[call('run_workflow',{task:'meeting_brief',instruction:'整理'})]}:{status:503});const r=q.h.start('整理一份会前资料',{conversationId:'c',fileIds:[q.file.id]});await waitFor(()=>!q.h.active.size);await waitFor(()=>!q.w.active.size);assert.equal(r.status,'failed');const j=q.store.state.jobs[0];assert.equal(j.status,'cancelled');assert.equal(j.artifacts.length,0);
});
test('台账仅有一份授权XLSX时确定模板，多份时拒绝猜测且不排任务',async t=>{
  const q=await setup(t,()=>({text:'test'})),files=[];for(const input of await sampleFiles('10'))files.push(await q.w.upload(input));
  const run={id:'template-run',conversationId:'c',status:'running',sourceFiles:files.map(f=>({id:f.id,sha256:f.sha256}))};q.store.state.runs.push(run);q.h.active.set(run.id,null);
  const result=q.h.chatActions.queue(run,{scenario_id:'10',file_ids:files.map(f=>f.id),instruction:'追加台账'});const job=q.store.state.jobs.find(j=>j.id===result.job_id);assert.equal(job.options.templateId,files[0].id);q.w.cancel(job.id);q.h.active.delete(run.id);await waitFor(()=>!q.w.active.size);
  const second=await q.w.upload((await sampleFiles('10'))[0]);const other={...run,id:'ambiguous',sourceFiles:[...run.sourceFiles,{id:second.id,sha256:second.sha256}]};q.h.active.set(other.id,null);assert.throws(()=>q.h.chatActions.queue(other,{scenario_id:'10'}),/多份/);assert.equal(q.store.state.jobs.length,1);q.h.active.delete(other.id);
});
