import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {AsyncLocalStorage} from 'node:async_hooks';
import {retryAfterSeconds} from './model-failure.mjs';
import {operatorControls} from './operator-controls.mjs';

const timing=new WeakMap(),context=new AsyncLocalStorage();
const failure=(code,message)=>Object.assign(new Error(message),{code});
export function isSiliconflowEndpoint(input){
 const u=new URL(input instanceof Request?input.url:String(input));
 return ['api.siliconflow.cn','api.siliconflow.com'].includes(u.hostname);
}
export const siliconflowTiming=response=>timing.get(response)||null;

async function sharedSlot(worker,fn,options){
 const configured=process.env.V8_SF_SLOT_MODULE||operatorControls().slotModulePath;
 const source=configured?pathToFileURL(configured).href:new URL('../../local-progress/sf-turn.mjs',import.meta.url).href;
 let module;try{module=await import(source);}catch{throw failure('SF_QUEUE_UNAVAILABLE','共享SF调度模块不可用；未发送请求');}
 if(typeof module.withSiliconflowSlot!=='function')throw failure('SF_QUEUE_UNAVAILABLE','共享SF调度接口无效；未发送请求');
 return module.withSiliconflowSlot(worker,fn,options);
}

// One actual request, including the entire body, per shared lease. Never wrap
// the server or this function in another sf-turn run. No credential discovery.
export async function queuedProviderFetch(input,init={}, {fetchImpl=fetch,queue={},beforeFetch,onTiming,maxResponseBytes=Infinity}={}){
 if(!isSiliconflowEndpoint(input)){
  await beforeFetch?.();
  return fetchImpl(input,init);
 }
 if(context.getStore()||process.env.AFK_SILICONFLOW_WORKER)throw failure('SF_QUEUE_NESTED','检测到外层SF槽位；禁止嵌套或旁路请求');
 const worker=queue.workerId||process.env.V8_SF_WORKER_ID||operatorControls().workerId;
 if(!/^worker-0[1-7]$/.test(worker||''))throw failure('SF_QUEUE_ID_REQUIRED','须配置本进程独占V8_SF_WORKER_ID；未发送请求');
 const slot=queue.withSlot||sharedSlot,queuedAt=performance.now();
 init.signal?.throwIfAborted();
 const outcome=await slot(worker,async()=>context.run(true,async()=>{
  // The shared scheduler checks pause/deadline at grant. A user cancellation
  // while waiting must also stop dispatch even if a lease is later granted.
  init.signal?.throwIfAborted();
  const granted=performance.now(),record={queueWaitMs:granted-queuedAt,supplierRequestMs:0,bodyFullyConsumed:false};
  let response,started;
  try{
   await beforeFetch?.();
   started=performance.now();
   response=await fetchImpl(input,init);record.httpStatus=response.status;
   const chunks=[];let size=0;
   if(response.body){
    for await(const chunk of response.body){size+=chunk.byteLength;if(size>maxResponseBytes)throw failure('API_RESPONSE_TOO_LARGE','响应超过既有读取边界');chunks.push(Buffer.from(chunk));}
   }else{const raw=await response.text();size=Buffer.byteLength(raw);if(size>maxResponseBytes)throw failure('API_RESPONSE_TOO_LARGE','响应超过既有读取边界');chunks.push(Buffer.from(raw));}
   init.signal?.throwIfAborted();
   record.bodyFullyConsumed=true;record.supplierRequestMs=performance.now()-started;
   const buffered=new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
   timing.set(buffered,record);onTiming?.(record);
   return {status:response.status,retry_after_seconds:retryAfterSeconds(response.headers?.get('retry-after'))??60,response:buffered};
  }catch(error){
   if(started===undefined)error.request_not_started=true;
   record.supplierRequestMs=started===undefined?0:performance.now()-started;
   if(response?.status===429||error.status===429){error.status=429;error.retry_after_seconds=retryAfterSeconds(response?.headers?.get('retry-after'))??error.retry_after_seconds??60;}
   error.sfQueueTiming=record;onTiming?.(record);throw error;
  }
 }),{label:'V8 单次SF请求（含完整响应消费）',signal:init.signal});
 return outcome.response;
}
