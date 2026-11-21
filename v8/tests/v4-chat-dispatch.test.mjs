import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {ConversationActions} from '../src/conversations/conversation-actions.mjs';
import {modelFixture,temporary,waitFor,call} from './dsh-fixture.mjs';

test('对话把转文字交给内网识别，模型推外部工具时改交回来',async t=>{
  let calls=0;
  const x=await modelFixture(t,body=>{
    const text=JSON.stringify(body.messages);
    if(body.messages.some(m=>m.role==='tool'))return {text:'转写结果：测试转写。这段未经回听，人名和金额请抽查。'};
    if(text.includes('请调用 recognize_attachment'))return {calls:[call('recognize_attachment',{file_id:file.id})]};
    return {text:'我无法直接处理音频，请用讯飞听见或 Whisper。'};
  });
  const store=new Store(temporary(t,'v6-dispatch-'));store.state.conversations=[{id:'c',title:'录音'}];store.state.jobs=[];store.state.runs=[];
  const h=new Harness(store,{directory:x.directory});
  const w=new Workspace(store,h,{transcribe:async()=>{calls++;return {content:'[整段] 测试转写',segments:1,model:'Qwen/Qwen3-ASR-1.7B',device:'intranet-api'};}});
  h.chatActions=new ConversationActions(store,w,h);
  const file=await w.upload({name:'光华大道+18.m4a',base64:Buffer.from('fake-m4a').toString('base64')});
  const run=h.start('转文字',{conversationId:'c',fileIds:[file.id]});
  await waitFor(()=>!h.active.has(run.id));
  assert.equal(run.status,'done',run.error);
  assert.equal(calls,1);
  assert.match(run.answer,/测试转写/);
  assert.doesNotMatch(run.answer,/讯飞|Whisper/);
  assert.equal(file.recognition.dispatchedByChat,true);
  assert.equal(file.recognition.confirmedAt,null);
  assert.equal(file.recognition.provider,'intranet');
  assert.equal(run.trace.some(item=>item.type==='tool_status'&&item.label==='recognize_attachment'&&item.detail==='completed'),true);
  assert.equal(x.requests[0].tools.some(tool=>tool.function.name==='recognize_attachment'),true);
  const again=await w.recognizeForChat(file.id);
  assert.equal(again.cached,true);assert.equal(calls,1);
  assert.throws(()=>w.start({scenarioId:'04',fileIds:[file.id],rules:'纪要'}),/核对/);
});
