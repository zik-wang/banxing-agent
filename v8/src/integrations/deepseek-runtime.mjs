import {randomUUID} from 'node:crypto';
import {emitExecution,observed,fingerprint} from '../diagnostics/qa-events.mjs';
import {inferenceProfile} from './inference-config.mjs';
import {PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Llm from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools, {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';

export const HARNESS_INFO=Object.freeze({name:'DeepSeek Harness',version:'0.2.0-rc.2',adapter:'dsh-llm-pi-ai',toolMode:'native',parallelTools:1});
const message=text=>({id:randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text}]});
export function redactSessionEvents(events,secret){return secret&&secret!=='local-keyless'?JSON.parse(JSON.stringify(events,(_key,value)=>typeof value==='string'?value.split(secret).join('[已隐藏密钥]'):value)):events;}
export function saveDeepSeekSession(store,kind,events){
  if(!store?.directory)return null;
  const folder=path.join(store.directory,'harness-sessions');fs.mkdirSync(folder,{recursive:true});
  const name=randomUUID()+'.jsonl';fs.writeFileSync(path.join(folder,name),events.map(e=>JSON.stringify(e)).join('\n')+'\n','utf8');
  return {kind,file:name,events:events.length};
}

// This bridge only composes official plugins and application policy. The official
// dsh-agent-loop owns model iteration, tool dispatch, steering and cancellation.
export async function runDeepSeek({connection,systemPrompt,request,tools=[],maxRounds=PROCESSING_LIMITS.chatRounds,maxCalls=PROCESSING_LIMITS.chatToolCalls,maxTokens=PROCESSING_LIMITS.chatOutputTokens,timeoutMs=PROCESSING_LIMITS.chatTimeoutMs,signal,onReady=()=>{},onModel=()=>{},beforeRequest=()=>{},onToolResult=()=>{},onSession=()=>{},repair,settle}){
  const profile=inferenceProfile(connection);
  const ctx=new Context();let handle,timer,failure,rounds=0,calls=0,aborted=false,sessionSaved=false,settled=null,currentModelCallId=null;
  const abort=()=>{aborted=true;handle?.agent.cancel({kind:'user'});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    for(const plugin of [Llm,Sessions,Projections,SystemPrompt,Tools,Agents])await ctx.plugin(plugin,plugin===SystemPrompt?{includeHarnessIdentity:false,includeRuntimeContext:false}:{});
    await ctx.plugin(PiAi,{providers:{'v4-intranet':{displayName:connection.label||'内网 Qwen',api:'openai-completions',baseURL:connection.baseUrl,headers:{Authorization:'Bearer '+(connection.apiKey||'local-keyless')},models:[{id:connection.modelName,name:connection.label||'内网 Qwen',reasoningEfforts:{off:null,low:'low'},input:['text'],contextWindow:profile.context_window_tokens,maxTokens}],compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false,maxTokensField:'max_tokens',...(connection.invoiceTextOnly===true?{thinkingFormat:'qwen'}:{thinkingFormat:connection.provider==='siliconflow'?'qwen':'chat-template',chatTemplateKwargs:{enable_thinking:false}})},reasoning:'off',timeoutMs:Math.min(timeoutMs,profile.timeout_ms),streamIdleTimeoutMs:Math.min(timeoutMs,profile.timeout_ms)}}});
    await ctx.plugin(AgentLoop,{agents:[],maxParallelToolCalls:1});
    if(!ctx.agentLoop||!ctx.agents||!ctx.tools)throw Error('DeepSeek Harness组件未就绪');
    handle=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'v4-intranet',model:connection.modelName,maxTokens},setup:(scope,agent)=>{
      scope.systemPrompt.section({name:'v4:business',order:0,text:systemPrompt,interpolate:false});
      for(const tool of tools)scope.tools.register({name:tool.name,description:tool.description||tool.label,parameters:JSON.parse(JSON.stringify(tool.parameters)),output:{schema:{},render:(_args,value)=>value.content},execute:async(args,exec)=>{
        if(exec.signal.aborted||signal?.aborted||aborted)throw Error('任务已取消');
        if(++calls>maxCalls){failure=Error('工具调用超过限额');agent.cancel({kind:'user'});throw failure;}
        // Raw dsh tool definitions own argument validation; keep it before effects.
        const errors=validateJsonSchemaValue(tool.parameters,args);if(errors.length)throw Error('工具参数不合法：'+errors.join('; '));
        return observed('tool_call',{toolCallId:exec.callId,modelCallId:currentModelCallId,metadata:{toolName:tool.name,argumentsHash:fingerprint(args)}},()=>tool.execute(exec.callId,args,exec.signal));
      }});
      scope.on('agent/pre-step',async(_event,next)=>{if(aborted||signal?.aborted)return {kind:'reject',messages:[]};if(settle&&!failure){const result=await settle({rounds,calls});if(result?.terminal){settled=result;return {kind:'reject',messages:[]};}}if(rounds>=maxRounds){failure=Object.assign(Error('模型轮次达到上限，尚未完成'),{code:'MODEL_ROUND_LIMIT'});return {kind:'reject',messages:[]};}return next();});
      scope.on('agent/request',async(_event,next)=>{const config=await next();await beforeRequest({round:rounds+1});currentModelCallId=randomUUID();emitExecution('model_request','started',{modelCallId:currentModelCallId,metadata:{round:rounds+1,modelId:connection.modelName,provider:connection.provider||'unknown',promptHash:fingerprint({systemPrompt,request}),maxTokens,timeoutMs}});onModel(++rounds);return {...config,temperature:profile.temperature};});
      scope.on('agent/error',event=>{failure=event.error instanceof Error?event.error:Error(String(event.error));});
      scope.on('tools/result',(exec,result)=>onToolResult(exec.name,result));
      scope.on('agent/turn-stopping',()=>{if(!failure&&!aborted&&!signal?.aborted&&rounds<maxRounds){const prompt=repair?.({rounds,messages:agent.session.deriveMessages()});if(prompt)agent.steer(message(prompt));}});
    }});
    onReady({abort,info:HARNESS_INFO});
    timer=setTimeout(()=>{failure=Error('模型处理超时，请缩小问题');abort();},timeoutMs);
    if(signal?.aborted)abort();
    if(aborted)throw Error('任务已取消');
    handle.agent.followup(message(request));await handle.agent.whenIdle();
    const events=handle.agent.session.snapshotEvents();onSession(redactSessionEvents(events,connection.apiKey));sessionSaved=true;
    if(settled&&!aborted&&!signal?.aborted)return {answer:settled.answer,delivery:settled.delivery,settled:true,rounds,calls,events,harness:HARNESS_INFO};
    if(failure)throw failure;
    const end=events.filter(e=>e.type==='turn/end').at(-1);if(end?.data.reason.kind!=='completed')throw Error('模型未完成：'+(end?.data.reason.kind||'缺少结束记录'));
    if(aborted||signal?.aborted)throw Error('任务已取消');
    const messages=handle.agent.session.deriveMessages(),last=messages.filter(m=>m.role==='assistant').at(-1);
    if(!last||last.content.some(c=>c.type==='tool-call'))throw Error('模型尚未交付最终结果');
    const answer=last.content.filter(c=>c.type==='text').map(c=>c.text).join('').trim();
    if(!answer)throw Error('模型没有返回文字');
    return {answer,messages,events,rounds,calls,harness:HARNESS_INFO};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(handle&&!sessionSaved)onSession(redactSessionEvents(handle.agent.session.snapshotEvents(),connection.apiKey));}finally{try{await handle?.dispose();}finally{await ctx.fiber.dispose();}}}
}
