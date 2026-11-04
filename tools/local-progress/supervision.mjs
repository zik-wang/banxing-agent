import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {data,root,read,write,file,snapshot} from './core.mjs';
import {policy,assertDispatchAllowed} from './control.mjs';
const run=promisify(execFile);
const statusPath=path.join(data,'supervision-status.json');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const cyclePath=id=>{if(!uuid.test(id))throw Error('invalid cycle id');return path.join(data,'supervision',id+'.json');};
async function queue(thread,message){
 assertDispatchAllowed();
 const cfg=read(path.join(data,'supervisor-config.json'),{});
 if(!cfg.codex_path)throw Error('Codex executable not configured');
 // Supported CLI only; never open private session storage or start another writer for the thread.
 const r=await run(cfg.codex_path,['queue','--thread',thread,'--message',message],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});
 return {stdout:r.stdout.trim(),stderr:r.stderr.trim(),queued_at:new Date().toISOString()};
}
export async function observeConnectionResults(audit,deliver=queue){
 if(policy().paused)return;
 const cfg=read(path.join(data,'supervisor-config.json'),{});if(!cfg.enabled)return;
 const p=path.join(data,'connection-watch-state.json');const old=read(p);
 const phases=Object.fromEntries(audit.workers.map(w=>[w.worker_id,{id:w.id,phase:w.verification}]));
 const events=audit.workers.flatMap(w=>{
  const result=[];
  if(w.verification==='已核对回执及本轮新产物路径')result.push({worker:w,key:JSON.stringify([w.worker_id,w.id,'artifact',w.result_path,w.modified_at,w.bytes]),label:'已核对本轮新产物路径'});
  if(w.acknowledged&&w.status==='blocked')result.push({worker:w,key:JSON.stringify([w.worker_id,w.id,'blocked',w.blocker||'未详述']),label:'上报阻塞：'+(w.blocker||'原因待核实')});
  return result;
 });
 // On first start or migration, seed current evidence without repeating old notifications.
 if(!old||!Array.isArray(old.seen_events)){write(p,{...old,phases,seen_events:events.map(e=>e.key),initialized_at:old?.initialized_at||new Date().toISOString(),notifications:old?.notifications||[]});return;}
 const seen=new Set(old.seen_events);const changes=events.filter(e=>!seen.has(e.key));
 for(const e of changes)seen.add(e.key);
 old.seen_events=[...seen];old.phases=phases;old.checked_at=new Date().toISOString();write(p,old);
 if(!changes.length)return;
 const message=`AFK_CONNECTION_VERIFICATION_CHANGE\n本地独立观察发现需要核实的变化：${changes.map(e=>e.worker.worker_id+' '+e.label).join('；')}。请运行 node '${path.join(root,'connection-audit.mjs')}' 核对当前轮次、回执和产物文件元数据；阻塞不代表产物完成。仅更新实际新事实，不重复派发已投递建议，不把文件存在当内容质量或用户验收，不读取敏感材料正文。这是一次有限验证通知。`;
 const notification={at:new Date().toISOString(),workers:[...new Set(changes.map(e=>e.worker.worker_id))],events:changes.map(e=>e.key),status:'queuing'};old.notifications.push(notification);write(p,old);
 try{Object.assign(notification,await deliver(cfg.thread_id,message),{status:'queued_pending_supervisor'});}catch(e){notification.status='uncertain';notification.error=e.message;}write(p,old);
}
export async function requestReview(s,deliver=queue){
 if(policy().paused){const c=policy();write(statusPath,{...read(statusPath,{}),status:'paused',updated_at:new Date().toISOString(),message:'AFK已暂停：'+c.reason});return;}
 const cfg=read(path.join(data,'supervisor-config.json'),{});
 if(!cfg.enabled)return;
 const previous=read(statusPath,{});
 if(['queuing','queued','reviewing','uncertain'].includes(previous.status))return; // Never stack unresolved requests.
 const bound=s.workers.filter(w=>w.connected&&w.thread_id&&w.thread_id!==cfg.thread_id);
 const eligible=bound.filter(w=>{
  if(w.onboarding&&!w.onboarding_receipt?.progress_reported_at)return false;
  let pending=read(path.join(data,'supervision-pending',w.worker_id+'.json'));
  if(!pending&&previous.deliveries?.[w.worker_id]&&previous.cycle_id){pending={cycle_id:previous.cycle_id};write(path.join(data,'supervision-pending',w.worker_id+'.json'),pending);}
  return !pending||!!read(path.join(data,'supervision-receipts',pending.cycle_id,w.worker_id+'.json'));
 });
 if(!eligible.length){write(statusPath,{...previous,status:bound.length?'waiting_for_worker_ack':'waiting_for_binding',updated_at:new Date().toISOString(),message:bound.length?'等待上轮建议回执或阶段结果，暂不重复排队':'等待 worker 下次上报自动绑定聊天；尚未下发推进指令'});return;}
 const id=crypto.randomUUID(),p=cyclePath(id);
 const cycle={id,status:'queuing',created_at:new Date().toISOString(),supervisor_thread_id:cfg.thread_id,workers:eligible,snapshot:s,deliveries:{}};
 write(p,cycle);write(statusPath,{cycle_id:id,status:'queuing',updated_at:cycle.created_at});
 const cli=path.join(root,'supervision.mjs');
 const message=`AFK_SUPERVISION_REQUEST ${id}\n用户已授权每半小时审查并向已绑定的原聊天发送合理推进建议。现在执行 node '${cli}' context ${id}，读取本轮允许记录的进度元数据（不读取私有会话库或敏感材料正文）。根据每个 worker 的真实阶段、阻塞、下一步、任务目标和前次上报判断是否有可推进工作；给需要推进的窗口制定1至3步具体动作、完成验证标准和停止条件。状态过旧先要求核实；需要用户权限/材料或已完成待验收时不要反复试错或代替用户决策。窗口可能跨多项任务，不能用一个任务标签替代当前上下文。用 node '${cli}' send ${id} WORKER_ID '具体建议' 向对应原聊天投递（不迁移进程、不另开原线程执行器、不使用--resume）。同一窗口本轮只发一条汇总建议；明确要求保留原上下文、校验建议适用性并在实际开始/阻塞/完成时主动上报。不要把队列成功声称为收到或执行。审查完执行 node '${cli}' complete ${id} '本轮结论'。这是有限一次审查；定时器由本地独立进程承担。`;
 const publishing=read(path.join(data,'github-publishing.json'));
 const reviewMessage=message+'\n先核对当前run-control.json和budget-authorization.json，遵守用户最新暂停、截止及调用范围。'+(publishing?.enabled?'用户已授权有经验证实质进展后推送GitHub；按快照github_publishing中的既有仓库、工作树、分支和进度页同步代码及脱敏摘要，检查真实远端commit；没有实质变化不空提交，不上传材料正文、凭证或运行态，不强推或自行合并主分支，暂停或到期不推送。':'')+'\n用户已要求错开硅基流动调用：先看siliconflow_policy/siliconflow_queue，所有SF请求经sf-turn.mjs共享单槽或withSiliconflowSlot入口；迁移屏障未解除、槽位占用或共享冷却时安排离线工作，不让多个窗口旁路直连重试，不把预算充足当不限流。模型条件与队列等待时间分别记录，原对照成绩不改写。';
 try{cycle.queue=await deliver(cfg.thread_id,reviewMessage);cycle.status='queued';write(p,cycle);write(statusPath,{cycle_id:id,status:'queued',updated_at:new Date().toISOString(),message:'审查请求已入队；尚未确认桌面聊天接收或执行'});}
 catch(e){cycle.status='uncertain';cycle.error=e.message;write(p,cycle);write(statusPath,{cycle_id:id,status:'uncertain',updated_at:new Date().toISOString(),message:'投递失败或结果不确定，停止自动重试以避免重复指令：'+e.message});}
}
export async function observeSiliconflowAdoption(deliver=queue){
 if(policy().paused)return;
 const cfg=read(path.join(data,'supervisor-config.json'),{}),rules=read(path.join(data,'siliconflow-policy.json'));
 if(!cfg.enabled||!rules?.enabled)return;
 const slot=read(path.join(data,'siliconflow-queue.json'),{}),required=rules.required_drain_workers||[];
 if(!required.length||required.some(w=>!slot.drained?.[w]))return;
 const p=path.join(data,'siliconflow-adoption-watch.json'),state=read(p,{notifications:[]});
 const events=[];if(!state.ready){state.ready=true;events.push('活跃worker均已提交旧调用收尾确认');}if((slot.granted_total||0)>0&&!state.first_grant){state.first_grant=true;events.push('已发生共享槽位的实际任务许可');}
 if(!events.length)return;write(p,state);
 const note={at:new Date().toISOString(),status:'queuing',events};state.notifications.push(note);write(p,state);
 try{Object.assign(note,await deliver(cfg.thread_id,`SF_QUEUE_ADOPTION_VERIFY\n${events.join('；')}。请运行 node '${path.join(root,'sf-turn.mjs')}' status 并对照最新worker上报，核对实际受控入口及排队/结算记录，不将收尾确认或槽位许可当成模型结果成功，不重复派发或直接重试。仅汇报真实新进展。`),{status:'queued_pending_supervisor'});}catch(e){note.status='uncertain';note.error=e.message;}write(p,state);
}
export async function command(args,deliver=queue){
 const [action,id,worker_id,...rest]=args;const p=cyclePath(id);const c=read(p);if(!c)throw Error('unknown cycle');
 if(process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID!==c.supervisor_thread_id)throw Error('only the bound supervisor chat may handle this cycle');
 if(action==='context'){if(c.status==='completed')throw Error('cycle already completed');c.status='reviewing';c.received_at=new Date().toISOString();write(p,c);write(statusPath,{cycle_id:id,status:'reviewing',updated_at:c.received_at,message:'审查聊天已接收请求；正在根据真实上报制定建议'});console.log(JSON.stringify(c,null,2));return;}
 if(action==='send'){
  if(c.status!=='reviewing')throw Error('run context first; cycle must be reviewing');
  const w=c.workers.find(w=>w.worker_id===worker_id),current=w&&read(file(worker_id));
  if(!w||!current?.thread_id||current.thread_id!==w.thread_id)throw Error('missing or changed worker binding');
  if(c.deliveries[worker_id])throw Error('already attempted for this worker in this cycle');
  const advice=rest.join(' ');if(!advice.trim()||advice.length>6000)throw Error('advice required, max 6000 chars');
  c.deliveries[worker_id]={status:'queuing',advice,at:new Date().toISOString()};write(p,c);
  write(path.join(data,'supervision-pending',worker_id+'.json'),{cycle_id:id,status:'pending_worker_ack',at:new Date().toISOString()});
  const message=`AFK 推进建议 / worker=${worker_id} / cycle=${id}\n${advice}\n请在当前聊天和原工作目录中，结合最新上下文校验建议是否适用，再继续原任务。已做完的步骤不要重复；如建议与最新用户指令冲突，遵守最新用户指令并上报原因。开始时执行本机 report.mjs 上报当前真实阶段，并在 stage 中包含回执标记 AFK_ACK:${id}；随后阶段完成、阻塞、最终完成时继续上报。只操作已有授权范围，不搬运敏感材料、不擅自发布或代替用户验收。遇到需要用户的新权限/材料就报告阻塞，保留成果。`;
  try{c.deliveries[worker_id]={...c.deliveries[worker_id],...await deliver(w.thread_id,message),status:'queued_pending_worker_ack'};write(p,c);console.log('已入队，等待 worker 明确回执；不代表已执行。');}
  catch(e){c.deliveries[worker_id].status='uncertain';c.deliveries[worker_id].error=e.message;write(p,c);throw e;}
  return;
 }
 if(action==='complete'){
  if(c.status!=='reviewing')throw Error('cycle must be reviewing');c.status='completed';c.completed_at=new Date().toISOString();c.summary=[worker_id,...rest].filter(Boolean).join(' ');write(p,c);write(statusPath,{cycle_id:id,status:'completed',updated_at:c.completed_at,message:c.summary||'本轮已审查；建议是否执行须看 worker 回执与后续真实上报',deliveries:c.deliveries});console.log('本轮审查完成');return;
 }
 throw Error('usage: context CYCLE | send CYCLE WORKER "advice" | complete CYCLE "summary"');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){command(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});}
