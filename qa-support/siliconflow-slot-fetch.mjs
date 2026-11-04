import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import https from 'node:https';
import {randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
export const SF_QUEUE_HOST=Symbol.for('banxing.siliconflow.shared-slot-host');
export const isSiliconflow=input=>{try{return new URL(typeof input==='string'||input instanceof URL?input:input.url).origin==='https://api.siliconflow.cn';}catch{return false;}};

// Host-only adapter. No queue credentials, request bodies or API keys are recorded.
export function createSiliconflowSlotTransport({withSlot,fetchImpl=globalThis.fetch,onRecord=()=>{}}={}){
 if(typeof withSlot!=='function')throw TypeError('Real shared slot function required');
 const scope=new AsyncLocalStorage(),wrapped=new WeakSet();let uncertain=false;
 const emit=(callback,value)=>{for(const fn of [onRecord,callback])try{fn?.(value);}catch{/* Timing must not replace a provider result. */}};
 const wrapFetch=rawFetch=>{
  if(wrapped.has(rawFetch))return rawFetch;
  const queued=async(input,options={})=>{
   if(!isSiliconflow(input))return rawFetch(input,options);
   if(scope.getStore())throw Object.assign(Error('SF request already owns a shared slot; nested acquisition refused'),{code:'SF_NESTED_SLOT'});
   if(uncertain)throw Object.assign(Error('Previous SF response end is unconfirmed; shared slot retained'),{code:'SF_SLOT_UNCERTAIN'});
   const {sfOnTiming,...networkOptions}=options,enqueuedAt=performance.now(),requestId=randomUUID();
   const timing=value=>emit(sfOnTiming,{requestId,...value});
   timing({event:'queued'});
   const result=await withSlot(async()=>scope.run(true,async()=>{
    const acquiredAt=performance.now(),queueWaitMs=acquiredAt-enqueuedAt;
    if(networkOptions.signal?.aborted){timing({event:'cancelled-before-dispatch',queueWaitMs,providerElapsedMs:0});return{status:499,notStarted:true};}
    timing({event:'provider-start',queueWaitMs});
    try{
     // Streaming adapters must wait for HTTP EOF as well as protocol DONE.
     const response=await rawFetch(input,{...networkOptions,waitForStreamEnd:true});
     const body=await response.text(),headers=new Headers(response.headers);
     headers.delete('content-encoding');headers.delete('content-length');
     const value={status:response.status,statusText:response.statusText,headers,body,retry_after_seconds:response.headers.get('retry-after')||60};
     timing({event:'provider-end',queueWaitMs,providerElapsedMs:performance.now()-acquiredAt,httpStatus:response.status,responseBytes:Buffer.byteLength(body),bodyFullyConsumed:true});
     return value;
    }catch(error){
     uncertain=true;
     timing({event:'provider-uncertain',queueWaitMs,providerElapsedMs:performance.now()-acquiredAt,bodyFullyConsumed:false,errorName:error.name,errorCode:error.code});
     // Return uncertainty to the scheduler; never release or retry on our own.
     return{status:502,uncertain:true};
    }
   }),{label:'worker-04 single SF request through complete JSON/SSE consumption'});
   if(result.notStarted)throw Object.assign(Error('SF request cancelled while waiting; provider was not contacted'),{code:'SF_REQUEST_NOT_STARTED',status:499,request_not_started:true});
   if(result.uncertain)throw Object.assign(Error('SF response end is unconfirmed; shared slot retained; no automatic retry'),{code:'SF_SLOT_UNCERTAIN'});
   return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,statusText:result.statusText,headers:result.headers});
  };
  wrapped.add(queued);return queued;
 };
 return{fetch:wrapFetch(fetchImpl),wrapFetch,ownsSlot:()=>!!scope.getStore()};
}

// Install once in a host preload, also inherited by that host's model children.
export function installSiliconflowSlotTransport(options){
 if(globalThis[SF_QUEUE_HOST])throw Error('SF queue host already installed; refusing a second layer');
 const originalFetch=globalThis.fetch,request=https.request,get=https.get;
 const transport=createSiliconflowSlotTransport({...options,fetchImpl:originalFetch});
 const isSfRequest=input=>isSiliconflow(input)||!!(input&&typeof input==='object'&&/^api\.siliconflow\.cn(?::443)?$/i.test(input.hostname||input.host||''));
 const guard=original=>function(input,...args){if(isSfRequest(input)&&!transport.ownsSlot())throw Object.assign(Error('Direct SF HTTPS requires the configured shared-slot request entry'),{code:'SF_SLOT_REQUIRED'});return original.call(this,input,...args);};
 globalThis[SF_QUEUE_HOST]=transport;globalThis.fetch=transport.fetch;https.request=guard(request);https.get=guard(get);syncBuiltinESMExports();
 return()=>{globalThis.fetch=originalFetch;https.request=request;https.get=get;syncBuiltinESMExports();delete globalThis[SF_QUEUE_HOST];};
}
