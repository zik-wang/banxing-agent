import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {data,root,read,write,snapshot} from './core.mjs';
import {assertDispatchAllowed} from './control.mjs';
assertDispatchAllowed();
const run=promisify(execFile),cfg=read(path.join(data,'supervisor-config.json'));
const id=crypto.randomUUID(),p=path.join(data,'policy-notices',id+'.json');
const record={id,at:new Date().toISOString(),deliveries:{}};write(p,record);
for(const w of snapshot().workers.filter(w=>w.thread_id&&w.thread_id!==cfg.thread_id)){
 const message=`AFK_POLICY_UPDATE ${id}\n用户最新直接指令，覆盖此前“明早截止”和“本轮不推送GitHub”的限制：\n1. 本轮截止时间明确为2026年11月5日14:00，东八区北京时间。Qwen/DeepSeek调用预算在原任务范围内已授权到此时，不因调用费本身等待确认。每批新调用/实验/推送前，先执行 node '${path.join(root,'control.mjs')}' check；退出码非0或mode暂停即停止新增工作，保存成果并上报blocked。到点不能自行延长。\n2. 用户中途明确要求暂停时必须暂停；收到AFK_PAUSE后停止新调用、实验、代码修改及推送，不自动恢复，保留成果。不要绕过本地暂停状态。\n3. 有经过验证的实质进展后，用户已授权commit并push到GitHub供mentor每天查看。沿用你项目现有远端和当前工作分支，仅提交你负责的代码、测试及脱敏进度摘要；不要提交公司材料正文、凭证、.env、本机运行态、模型原始敏感请求或无关修改。不要force push、不擅自合并主分支。提交说明写清本次行为变化、实际验证、仍未验证/阻塞项；推送后用原上报命令登记真实commit与仓库/分支位置。若认证或权限失败，保留提交并上报真实阻塞，不声称已推送。\n4. 继续原聊天最新任务与上下文，不因这条控制更新重启已有执行或重复已完成步骤。`;
 record.deliveries[w.worker_id]={status:'queuing'};write(p,record);
 try{const r=await run(cfg.codex_path,['queue','--thread',w.thread_id,'--message',message],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});record.deliveries[w.worker_id]={status:'queued_pending_receipt',stdout:r.stdout.trim()};}catch(e){record.deliveries[w.worker_id]={status:'uncertain',error:e.message};}write(p,record);
}
console.log(JSON.stringify(record,null,2));
