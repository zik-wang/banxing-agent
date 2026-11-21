import {randomUUID} from 'node:crypto';
// Optional host boundary for a shared account-wide SF queue. It never reads keys
// or request bodies. A buffered response is returned only after upstream ended.
export function createSiliconflowSlotFetch({fetchImpl,withSlot,workerId,onReceipt=()=>{},clock=Date.now}){
 if(typeof fetchImpl!=='function'||typeof withSlot!=='function'||!workerId)throw Error('SF_SLOT_CONFIGURATION_REQUIRED');
 return async function slotFetch(input,init){
  const address=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
  let url;try{url=new URL(address);}catch{return fetchImpl(input,init);}
  if(url.hostname.toLowerCase()!=='api.siliconflow.cn')return fetchImpl(input,init);
  const queuedAt=clock(),receipt={id:randomUUID(),provider:'siliconflow',workerId,kind:url.pathname.endsWith('/models')?'models':'model_request',queuedAt:new Date(queuedAt).toISOString(),state:'queued',networkRequestAttempted:false};
  let upstreamStarted=false;
  onReceipt({...receipt});
  try{
   const value=await withSlot(workerId,async()=>{
    const started=clock();receipt.queueWaitMs=started-queuedAt;
    const signal=init?.signal||(input instanceof Request?input.signal:null);
    if(signal?.aborted)throw Object.assign(Error('Request cancelled before shared SF slot was granted'),{request_not_started:true});
    upstreamStarted=true;Object.assign(receipt,{state:'requesting',networkRequestAttempted:true,upstreamStartedAt:new Date(started).toISOString()});onReceipt({...receipt});
    const response=await fetchImpl(input,init),chunks=[];let bytes=0,firstChunkMs=null;
    if(response.body){const reader=response.body.getReader();try{while(true){const next=await reader.read();if(next.done)break;if(firstChunkMs===null)firstChunkMs=clock()-started;chunks.push(next.value);bytes+=next.value.byteLength;}}finally{reader.releaseLock();}}
    const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
    Object.assign(receipt,{state:'body_consumed',status:response.status,fullBodyConsumed:true,providerElapsedMs:clock()-started,firstChunkMs,responseBytes:bytes});
    return {status:response.status,retry_after_seconds:response.headers.get('retry-after')||60,body,headers:response.headers,statusText:response.statusText};
   },{label:'SF full-response boundary; no prompt or credential recorded'});
   Object.assign(receipt,{state:'completed',finishedAt:new Date(clock()).toISOString(),totalElapsedMs:clock()-queuedAt});onReceipt({...receipt});
   return new Response([204,205,304].includes(value.status)?null:value.body,{status:value.status,statusText:value.statusText,headers:value.headers});
  }catch(error){
   if(!upstreamStarted)Object.assign(receipt,{queueWaitMs:clock()-queuedAt,providerElapsedMs:0});
   else if(!receipt.fullBodyConsumed)receipt.providerElapsedMs=clock()-Date.parse(receipt.upstreamStartedAt);
   Object.assign(receipt,{state:'failed',finishedAt:new Date(clock()).toISOString(),totalElapsedMs:clock()-queuedAt,fullBodyConsumed:receipt.fullBodyConsumed===true,uncertain:upstreamStarted&&receipt.fullBodyConsumed!==true});onReceipt({...receipt});
   throw error;
  }
 };
}
