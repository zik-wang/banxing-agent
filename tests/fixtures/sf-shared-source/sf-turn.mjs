import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {base,init,assignment,data,read} from './core.mjs';
import {assertDispatchAllowed} from './control.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function post(worker_id,action,body){
 if(!assignment(worker_id))throw Error('unknown worker');
 const r=await fetch(base+'/api/siliconflow/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+init().workers[worker_id]},body:JSON.stringify({worker_id,...body}),signal:AbortSignal.timeout(10000)});
 const result=await r.json();if(!r.ok)throw Error(result.error||'slot service error');return result;
}
function retrySeconds(retryAfter){
 let seconds=Number(retryAfter);if(!Number.isFinite(seconds))seconds=Math.max(0,(Date.parse(retryAfter)-Date.now())/1000);if(!Number.isFinite(seconds))seconds=60;
 return seconds;
}
export async function reportSiliconflow429(worker_id,retryAfter=60){
 return post(worker_id,'cooldown',{retry_after_seconds:retrySeconds(retryAfter)});
}
export async function withSiliconflowSlot(worker_id,fn,{label='单个硅基流动调用',pollMs=3000}={}){
 const request_id=crypto.randomUUID();let lease_id,heartbeat,errorInHeartbeat;
 try{
  let last='';
  while(!lease_id){
   assertDispatchAllowed();const r=await post(worker_id,'acquire',{request_id,label});if(r.paused)throw Error('AFK paused or deadline reached');
   if(r.granted){lease_id=r.lease_id;break;}
   const line=`硅基流动排队：${worker_id} 位置${r.position}；当前占用${r.active?.worker_id||'无'}；冷却约${Math.ceil(r.cooldown_remaining_ms/1000)}秒；待旧调用收尾：${r.awaiting_drain_workers.join(',')||'无'}`;
   if(line!==last){console.error(line);last=line;}await delay(pollMs);
  }
  // Never release on a missed heartbeat: the original call might still be running.
  heartbeat=setInterval(()=>post(worker_id,'heartbeat',{lease_id}).catch(e=>{errorInHeartbeat=e;}),10000);
  let outcome='ok',retry_after_seconds=0,confirmedEnded=true;
  try{
   assertDispatchAllowed();const result=await fn({lease_id,request_id});
   if(result instanceof Response&&result.body&&(!result.bodyUsed||result.body.locked)){confirmedEnded=false;throw Object.assign(Error('回调必须等待JSON/SSE消费完整结束；当前响应结束未核实，保留槽位'),{uncertain:true});}
   if(result?.uncertain)confirmedEnded=false;
   if(result?.status===429){outcome='rate_limited';retry_after_seconds=retrySeconds(result?.retry_after_seconds||60);}
   else if(result?.status>=400)outcome='error';
   return result;
  }catch(e){outcome=e.status===429||e.code===429?'rate_limited':'error';retry_after_seconds=retrySeconds(e.retry_after_seconds||60);if(e.uncertain||(!e.request_not_started&&!Number.isInteger(e.status)&&e.code!==429))confirmedEnded=false;throw e;}
  finally{
   clearInterval(heartbeat);
   if(confirmedEnded){try{await post(worker_id,'release',{lease_id,outcome,retry_after_seconds});}catch(e){console.error('释放未确认，调度器保留占用以避免重叠：'+e.message);}}
   else console.error('原调用结束状态不确定，保留槽位；实际核实结束后才能 release-confirmed，禁止自动抢占。');
   if(errorInHeartbeat)console.error('曾丢失租约心跳：'+errorInHeartbeat.message);
  }
 }finally{clearInterval(heartbeat);if(!lease_id)await post(worker_id,'cancel',{request_id}).catch(()=>{});}
}
async function main(){
 const [action,worker_id,...args]=process.argv.slice(2);
 if(action==='status'){const r=await fetch(base+'/api/siliconflow');console.log(JSON.stringify(await r.json(),null,2));return;}
 if(action==='429'){console.log(JSON.stringify(await reportSiliconflow429(worker_id,args[0]||60),null,2));return;}
 if(action==='drained'){console.log(JSON.stringify(await post(worker_id,'drained',{}),null,2));return;}
 if(action==='release-confirmed'){
  if(args[0]!=='--confirmed-ended')throw Error('必须先实际核实原调用结束，再加 --confirmed-ended；不能盲目清锁');
  const active=read(path.join(data,'siliconflow-queue.json'))?.active;if(active?.worker_id!==worker_id)throw Error('no matching active lease');
  console.log(JSON.stringify(await post(worker_id,'release',{lease_id:active.lease_id,outcome:'error'}),null,2));return;
 }
 if(action!=='run')throw Error('usage: status | 429 WORKER [Retry-After seconds] | run WORKER -- EXECUTABLE [ARGS]');
 if(args.shift()!=='--'||!args.length)throw Error('run requires -- EXECUTABLE [ARGS]');
 const executable=args.shift();let code=1;
 await withSiliconflowSlot(worker_id,()=>new Promise((resolve,reject)=>{
  // No shell; inherit the original environment without inspecting or recording API keys.
  const child=spawn(executable,args,{stdio:'inherit',windowsHide:true,shell:false,env:{...process.env,AFK_SILICONFLOW_WORKER:worker_id}});
  child.once('error',e=>{e.request_not_started=true;reject(e);});child.once('close',(exit,signal)=>{code=exit??1;resolve({status:exit===75?429:exit===0?200:500,uncertain:!!signal||(exit!==0&&exit!==75),retry_after_seconds:60});});
 }),{label:'有限调用任务（命令和请求正文不记录）'});
 process.exitCode=code;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
