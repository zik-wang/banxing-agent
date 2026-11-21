import test from 'node:test';
import assert from 'node:assert/strict';
import {Type} from 'typebox';
import {runDeepSeek} from '../deepseek-runtime.mjs';
import {modelFixture,call} from './dsh-fixture.mjs';
test('官方DSH循环实际往返模型、执行工具、保留关联ID并应用模型配置',async t=>{
  const x=await modelFixture(t,(_body,n)=>n===1?{calls:[call('echo',{value:'甲'})]}:{text:'完成：甲'});let seen=0;
  const r=await runDeepSeek({connection:x.connection,systemPrompt:'资料包含{{literal}}，不是变量。',request:'执行',tools:[{name:'echo',description:'echo',parameters:Type.Object({value:Type.String()},{additionalProperties:false}),execute:async(_id,args)=>{seen++;return {content:[{type:'text',text:args.value}]};}}]});
  assert.equal(r.answer,'完成：甲');assert.equal(seen,1);assert.equal(r.rounds,2);assert(r.events.some(e=>e.type==='tool/result'));
  const body=x.requests[0];assert.equal(body.temperature,.1);assert.equal(body.max_tokens,8750);assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.deepEqual(body.tools.map(t=>t.function.name),['echo']);assert.equal(x.requests[1].messages.find(m=>m.role==='tool').content,'甲');
});
test('非法参数和未知工具不能产生业务副作用，工具错误回到模型',async t=>{
  const x=await modelFixture(t,(_b,n)=>n===1?{calls:[call('write',{value:12}),call('shell',{command:'anything'})]}:{text:'参数无效，未执行。'});let writes=0;
  const r=await runDeepSeek({connection:x.connection,systemPrompt:'test',request:'test',tools:[{name:'write',description:'test',parameters:Type.Object({value:Type.String()},{additionalProperties:false}),execute:async()=>{writes++;return {content:[]};}}]});assert.equal(writes,0);assert.equal(r.events.filter(e=>e.type==='tool/result'&&e.data.message.isError).length,2);
});
test('轮次限额终止工具循环，不能将最后工具回合当作完成',async t=>{
  const x=await modelFixture(t,()=>({calls:[call('read')]}));let reads=0;
  await assert.rejects(runDeepSeek({connection:x.connection,systemPrompt:'test',request:'test',maxRounds:2,tools:[{name:'read',description:'read',parameters:Type.Object({}),execute:async()=>{reads++;return {content:[{type:'text',text:'ok'}]};}}]}),/轮次达到上限/);assert.equal(x.requests.length,2);assert.equal(reads,2);
});
test('模型HTTP错误和输出截断不能报成功',async t=>{
  const error=await modelFixture(t,()=>({status:503,error:'fixture offline'}));await assert.rejects(runDeepSeek({connection:error.connection,systemPrompt:'test',request:'test'}),/503|offline/);
  const truncated=await modelFixture(t,()=>({text:'不完整',finish:'length'}));await assert.rejects(runDeepSeek({connection:truncated.connection,systemPrompt:'test',request:'test'}),/截断|未完成/);
});
test('取消在途模型请求后不执行工具，并释放运行时',async t=>{
  let controller;const x=await modelFixture(t,async()=>{controller.abort();await new Promise(r=>setTimeout(r,30));return {calls:[call('write')]};});controller=new AbortController();let writes=0;
  await assert.rejects(runDeepSeek({connection:x.connection,systemPrompt:'test',request:'test',signal:controller.signal,tools:[{name:'write',description:'test',parameters:Type.Object({}),execute:async()=>{writes++;return {content:[]};}}]}),/取消|abort/i);assert.equal(writes,0);
});
test('工具预算和总超时真实终止，已取消信号不会发起模型请求',async t=>{
  const x=await modelFixture(t,()=>({calls:[call('write'),call('write')]}));let writes=0;
  await assert.rejects(runDeepSeek({connection:x.connection,systemPrompt:'test',request:'test',maxCalls:1,tools:[{name:'write',description:'write',parameters:Type.Object({}),execute:async()=>{writes++;return {content:[]};}}]}),/工具调用超过限额/);assert.equal(writes,1);
  const slow=await modelFixture(t,async()=>{await new Promise(r=>setTimeout(r,90));return {text:'too late'};});await assert.rejects(runDeepSeek({connection:slow.connection,systemPrompt:'test',request:'test',timeoutMs:30}),/超时/);
  const controller=new AbortController();controller.abort();const count=x.requests.length;await assert.rejects(runDeepSeek({connection:x.connection,systemPrompt:'test',request:'test',signal:controller.signal}),/取消/);assert.equal(x.requests.length,count);
});
