import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export const BATCH_VERSION='v7-09-batch-1';
export const POLICY=Object.freeze(Object.fromEntries(Object.entries({queueMs:30000,parseMs:20000,renderMs:20000,ocrMs:120000,visionMs:45000,llmMs:45000,harnessMs:60000,fileMs:240000,batchMs:600000,deliveryMs:60000,maxRequests:60,maxRetries:2,concurrency:1,maxPages:10,maxBytes:20*1024*1024}).map(([key,value])=>[key,key==='concurrency'?value:scaledLimit(value)])));
export function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
export function typedError(code,message){return Object.assign(Error(message||code),{code});}
export function timeoutCode(error,fallback){const code=error?.code||error?.cause?.code;if(['queue_wait_timeout','ocr_timeout','vision_timeout','llm_timeout','harness_timeout','workspace_timeout','frontend_timeout','file_timeout'].includes(code))return code;if(code==='WORKSPACE_TIMEOUT')return 'workspace_timeout';if(code==='HARNESS_TIMEOUT')return 'harness_timeout';if(/超时|timeout|timed out/i.test(String(error?.message)))return fallback||'harness_timeout';return null;}
export class StageLog{
 constructor(root,{retryCount=0,onChange=()=>{}}={}){this.root=root;this.retryCount=retryCount;this.rows=[];this.onChange=onChange;fs.mkdirSync(root,{recursive:true});}
 async run(stage,{fileId=null,pageNo=null,signal,budgetMs,timeoutReason,requestId=null,...meta}={},action){
  const row={id:randomUUID(),stage,startedAt:new Date().toISOString(),finishedAt:null,durationMs:null,fileId,pageNo,requestId,providerRequestId:null,requestIdBasis:requestId?'client correlation; provider ID may be unavailable':null,success:null,timeoutReason:null,retryCount:this.retryCount,...meta},start=performance.now();this.rows.push(row);const append=()=>fs.appendFileSync(path.join(this.root,'stages.jsonl'),JSON.stringify(row)+'\n');append();this.onChange(row);
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason||typedError('user_cancelled','已停止'));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});let timer;
  const stopped=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});if(controller.signal.aborted)reject(controller.signal.reason);if(budgetMs)timer=setTimeout(()=>controller.abort(typedError((typeof timeoutReason==='function'?timeoutReason(row):timeoutReason)||'harness_timeout',stage+' 超时，已保存其他材料结果')),budgetMs);});
  // The losing task receives abort; waiters never hold up the whole batch.
  const work=Promise.resolve().then(()=>action(controller.signal,row));
  try{const value=await Promise.race([work,stopped]);row.success=true;return value;}catch(error){row.success=false;row.timeoutReason=timeoutCode(error,typeof timeoutReason==='function'?timeoutReason(row):timeoutReason);row.errorCode=error?.code||'stage_failed';row.error=String(error?.message||error).slice(0,400);throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);row.finishedAt=new Date().toISOString();row.durationMs=Math.round(performance.now()-start);append();this.onChange(row);}
 }
}
export class SerialResource{
 constructor(){this.busy=false;this.waiters=[];}
 acquire(signal){signal?.throwIfAborted();if(!this.busy){this.busy=true;return Promise.resolve(this.release.bind(this));}return new Promise((resolve,reject)=>{const entry={resolve,reject,signal};const abort=()=>{this.waiters=this.waiters.filter(w=>w!==entry);reject(signal.reason);};entry.abort=abort;signal?.addEventListener('abort',abort,{once:true});this.waiters.push(entry);});}
 release(){const next=this.waiters.shift();if(next){next.signal?.removeEventListener('abort',next.abort);next.resolve(this.release.bind(this));}else this.busy=false;}
}
export const invoiceOcrResource=new SerialResource();
