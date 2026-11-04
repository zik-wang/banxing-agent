import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {data,root,read,write,snapshot} from './core.mjs';
import {assertDispatchAllowed} from './control.mjs';
assertDispatchAllowed();const run=promisify(execFile),cfg=read(path.join(data,'supervisor-config.json'));
const id=crypto.randomUUID(),p=path.join(data,'siliconflow-notices',id+'.json');const record={id,at:new Date().toISOString(),deliveries:{}};write(p,record);
for(const w of snapshot().workers.filter(w=>w.thread_id&&w.thread_id!==cfg.thread_id)){
 const message=`SF_QUEUE_POLICY ${id}\n用户最新明确要求：多个进程必须错开硅基流动API调用，不能再各自并发重试造成429。这条是请求启动边界的控制更新。\n请在下一次SF请求开始前读取 '${path.join(root,'硅基流动接入.txt')}' 并实际接入共享槽位。使用Node请求入口 withSiliconflowSlot 或 sf-turn.mjs run 包装一个有限案例；一个入口只包一层，保持完整JSON/SSE消费结束才释放。不同API Key不能当作不同账户限额。当前保守使用一个全局SF槽位，非SF端点不占用。\n已在途的原调用自然结束、保留结果，不强杀或丢弃。此后禁止绕过槽位直接开始新的SF调用；等待时继续离线审查、报告、代码和Git整理。只有在确认你的旧SF直连调用已结束且后续入口全部接入后，执行 node '${path.join(root,'sf-turn.mjs')}' drained ${w.worker_id}。目前worker-01/04/05的实际收尾确认全部到齐前，全局新槽位不会开闸；不要用消息入队或收到消息冒充该确认。worker-02/03若目前无SF在途，可核对实际端点后接入；现有认证阻塞不要因此绕过。\n发生真实429时报告共享冷却，等待Retry-After或指数退避，不在旁路另开并发重试。保存队列等待与供应商请求耗时，不能改写原对照成绩。保持原模型/请求/材料权限，截止2026-11-05 14:00北京时间，明确暂停优先。\n完成接入后用原report.mjs上报stage带 SF_QUEUE_READY，写明已实际接入的入口/产物路径。若当前应用无法接入，保持SF新增调用暂停并上报具体原因，不假称已受控。`;
 record.deliveries[w.worker_id]={status:'queuing'};write(p,record);
 try{const r=await run(cfg.codex_path,['queue','--thread',w.thread_id,'--message',message],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});record.deliveries[w.worker_id]={status:'queued_pending_worker_ack',stdout:r.stdout.trim()};}catch(e){record.deliveries[w.worker_id]={status:'uncertain',error:e.message};}write(p,record);
}
console.log(JSON.stringify(record,null,2));
