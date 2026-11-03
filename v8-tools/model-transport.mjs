import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {modelFailure,retryAfterSeconds} from './model-failure.mjs';

const transientCodes=new Set(['ECONNRESET','EPIPE','ETIMEDOUT','ECONNREFUSED','EAI_AGAIN','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
export function safeModelError(error,redact=x=>x,depth=0,seen=new Set()){
 if(depth>5)return {message:'cause depth limit'};
 if(error===null||error===undefined)return null;
 if(typeof error!=='object')return {message:redact(String(error))};
 if(seen.has(error))return {message:'circular cause'};seen.add(error);
 const result={};
 for(const key of ['name','message','code','errno','syscall','address','port'])if(error[key]!==undefined)result[key]=typeof error[key]==='string'?redact(error[key]):error[key];
 if(error.socket)result.socket=Object.fromEntries(['localAddress','localPort','remoteAddress','remotePort','remoteFamily','timeout','bytesWritten','bytesRead'].filter(k=>error.socket[k]!==undefined).map(k=>[k,error.socket[k]]));
 if(error.cause)result.cause=safeModelError(error.cause,redact,depth+1,seen);
 if(Array.isArray(error.errors))result.errors=error.errors.slice(0,8).map(e=>safeModelError(e,redact,depth+1,seen));
 return result;
}
function codes(error,seen=new Set()){
 if(!error||typeof error!=='object'||seen.has(error))return [];
 seen.add(error);return [error.code,...codes(error.cause,seen),...(error.errors||[]).flatMap(e=>codes(e,seen))].filter(Boolean);
}
function retryable(error,phase){
 if(!['fetch','response_body'].includes(phase))return false;
 const all=codes(error);
 if(all.some(c=>transientCodes.has(c)))return true;
 if(all.length)return false;
 return error?.name==='TypeError'&&/^(fetch failed|terminated)$/i.test(error.message||'');
}
export function createChatApi({baseUrl,model,apiKey,provider,fetchImpl=fetch,timeoutMs=120000,maxTokens=2000,logDirectory,enableThinking,topP,maxAttempts=3,retryDelaysMs=[200,600],disableKeepAlive=provider==='intranet',onAttempt},ErrorType=Error){
 if(enableThinking!==undefined&&typeof enableThinking!=='boolean')throw Error('enableThinking must be boolean when configured');
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('maxAttempts must be an integer from 1 to 3');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('timeoutMs must be positive');
 if(!Array.isArray(retryDelaysMs)||retryDelaysMs.some(n=>!Number.isFinite(n)||n<0||n>5000))throw Error('retryDelaysMs must contain bounded nonnegative delays');
 const redact=text=>{
  let s=String(text);if(apiKey)s=s.split(apiKey).join('[REDACTED_CREDENTIAL]');
  return s.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED_CREDENTIAL]').replace(/([?&](?:api[_-]?key|access_token|token)=)[^&\s]+/gi,'$1[REDACTED_CREDENTIAL]');
 };
 const sanitize=value=>{
  if(typeof value==='string')return redact(value);
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(apiKey|api_key|authorization|access_token|password)$/i.test(k)?'[REDACTED_CREDENTIAL]':sanitize(v)]));
  return value;
 };
 const makeError=(code,message,details,cause)=>{
  const e=new ErrorType(code,message,details);e.code=code;e.message=message;e.details=details;if(cause)e.cause=cause;const failure=modelFailure(e);if(failure)e.failure=failure;return e;
 };
 const stats={logicalRequests:0,networkAttempts:0,retries:0,recoveredRequests:0,failedRequests:0};
 const api=async(messages,definitions,signal,callOptions={})=>{
  const requestId=randomUUID(),logicalStarted=Date.now();stats.logicalRequests++;
  const allowed=Math.min(maxAttempts,callOptions.maxAttempts??maxAttempts);
  if(!Number.isInteger(allowed)||allowed<1)throw makeError('MODEL_REQUEST_BUDGET_EXHAUSTED','模型网络请求预算已耗尽',{requestId});
  const userCancelled=()=>signal?.aborted&&signal.reason?.name!=='TimeoutError';
  const combined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]);
  const cloud=provider==='cloud'||provider==='siliconflow';
  const settings=enableThinking===undefined?{}:provider==='iteracompute'?{chat_template_kwargs:{enable_thinking:enableThinking}}:cloud?{enable_thinking:enableThinking}:{chat_template_kwargs:{enable_thinking:enableThinking}};
  const toolSettings=definitions.length?{tools:definitions.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),tool_choice:'auto'}:{};
  const body=JSON.stringify({model,messages,...toolSettings,temperature:0.1,...(topP===undefined?{}:{top_p:topP}),max_tokens:maxTokens,...settings});
  for(let attempt=1;attempt<=allowed;attempt++){
   if(combined.aborted){stats.failedRequests++;throw makeError(userCancelled()?'MODEL_REQUEST_CANCELLED':'MODEL_REQUEST_TIMEOUT',userCancelled()?'模型请求已取消':'模型请求达到总时限，已停止重试',{requestId,attempts:attempt-1,phase:'before_request'});}
   // Host accounting runs before every actual HTTP attempt, including recovery.
   try{await onAttempt?.({requestId,attempt});}catch(error){stats.failedRequests++;throw error;}
   stats.networkAttempts++;
   const startedAt=new Date().toISOString(),started=Date.now();let phase='fetch',response,raw,data;
   const receipt={startedAt,requestId,attempt,attemptCount:attempt,model,provider:provider||'unspecified',maxTokens,enableThinking,visibleTools:definitions.map(d=>d.name),messageCount:messages.length,networkRequestAttempted:true,connectionPolicy:disableKeepAlive?'close':'default'};
   const progress=(state,extra={})=>{if(logDirectory){try{fs.mkdirSync(logDirectory,{recursive:true});fs.writeFileSync(path.join(logDirectory,'request-status.state'),JSON.stringify({requestId,attempt,provider:provider||'unspecified',state,startedAt,updatedAt:new Date().toISOString(),elapsedMs:Date.now()-started,...extra}));}catch{/* Optional live feedback must never replace a model result or its error. */}}};
   const log=extra=>{if(logDirectory){fs.mkdirSync(logDirectory,{recursive:true});fs.writeFileSync(path.join(logDirectory,requestId+'.'+String(attempt).padStart(2,'0')+'.json'),JSON.stringify(sanitize({...receipt,elapsedMs:Date.now()-started,logicalElapsedMs:Date.now()-logicalStarted,...extra}),null,2));}};
   try{
    progress('waiting_response');
    response=await fetchImpl(baseUrl.replace(/\/$/,'')+'/chat/completions',{
     method:'POST',redirect:'error',signal:combined,
     headers:{'Content-Type':'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{}),...(disableKeepAlive?{Connection:'close'}:{})},body
    });
    progress('reading_response',{httpStatus:response.status});phase='response_body';raw=redact(await response.text());
    phase='parse';try{data=JSON.parse(raw)}catch{}
    if(!response.ok)throw makeError('MODEL_HTTP_ERROR','Planning model HTTP '+response.status,{requestId,attempts:attempt,httpStatus:response.status,elapsedMs:Date.now()-started,providerErrorCode:redact(String(data?.error?.code||data?.error?.type||'')),providerMessage:redact(String(data?.error?.message||'')).slice(0,600),retryAfterSeconds:retryAfterSeconds(response.headers.get('retry-after')),responsePreview:redact(raw).slice(0,600)});
    if(!data)throw makeError('MODEL_INVALID_JSON','Planning model returned invalid JSON');
    if(data.choices?.[0]?.finish_reason==='length')throw makeError('MODEL_OUTPUT_TRUNCATED','Planning model response was truncated');
    log({phase:'complete',httpStatus:response.status,response:data,responseRaw:raw,recovered:attempt>1});
    progress('completed',{httpStatus:response.status});
    if(attempt>1)stats.recoveredRequests++;
    return data.choices?.[0]?.message;
   }catch(error){
    const cancelled=combined.aborted;
    const transient=(!response||response.ok)&&retryable(error,phase);
    const canRetry=!cancelled&&attempt<allowed&&transient;
    const safe=safeModelError(error,redact);
    const failure=modelFailure(error)||((cancelled&&!userCancelled())?modelFailure({code:'MODEL_REQUEST_TIMEOUT',details:{requestId,elapsedMs:Date.now()-started}}):null);
    log({phase,httpStatus:response?.status,response:data,responseRaw:raw,error:safe,retryable:!cancelled&&transient,willRetry:canRetry,cancelled});
    progress(canRetry?'retrying':userCancelled()?'cancelled':'failed',{httpStatus:response?.status??null,failure});
    if(canRetry){
     stats.retries++;
     try{await sleep(retryDelaysMs[Math.min(attempt-1,retryDelaysMs.length-1)]??0,undefined,{signal:combined})}
     catch(e){stats.failedRequests++;throw makeError(userCancelled()?'MODEL_REQUEST_CANCELLED':'MODEL_REQUEST_TIMEOUT',userCancelled()?'模型请求已取消':'模型请求达到总时限，已停止重试',{requestId,attempts:attempt,phase,error:safe},e)}
     continue;
    }
    stats.failedRequests++;
    if(cancelled)throw makeError(userCancelled()?'MODEL_REQUEST_CANCELLED':'MODEL_REQUEST_TIMEOUT',userCancelled()?'模型请求已取消':'模型请求达到总时限，已停止重试',{requestId,attempts:attempt,phase,elapsedMs:Date.now()-logicalStarted,error:safe},error);
    if(response&&!response.ok&&phase==='response_body')throw makeError('MODEL_HTTP_ERROR','Planning model HTTP '+response.status,{requestId,attempts:attempt,phase,httpStatus:response.status,error:safe},error);
    if(phase==='parse')throw error;
    const code=codes(error)[0]||'NETWORK_ERROR';
    throw makeError('MODEL_NETWORK_ERROR','模型服务连接失败（'+code+'，已尝试'+attempt+'次），读取结果与工具记录已保留',{requestId,attempts:attempt,phase,error:safe},error);
   }
  }
 };
 api.metrics=()=>({...stats});return api;
}

