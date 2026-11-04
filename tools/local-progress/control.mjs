import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {data,read,write,snapshot} from './core.mjs';
const run=promisify(execFile),p=path.join(data,'run-control.json');
export function policy(now=Date.now()){
 const c=read(p,{mode:'running',deadline:null});const expired=!!c.deadline&&now>=Date.parse(c.deadline);
 return {...c,paused:c.mode==='paused'||expired,expired,reason:c.mode==='paused'?c.reason:expired?'已到用户指定截止时间':null};
}
export function assertDispatchAllowed(){const c=policy();if(c.paused)throw Error('AFK 已暂停：'+c.reason);}
export async function enforceControl(){
 let c=policy();if(!c.paused)return;
 if(c.mode!=='paused'){c={...c,mode:'paused',reason:'到达2026-11-05 14:00 +08:00截止时间',paused_at:new Date().toISOString(),revision:crypto.randomUUID()};write(p,c);}
 const noticePath=path.join(data,'control-notifications',c.revision+'.json');if(read(noticePath))return;
 const cfg=read(path.join(data,'supervisor-config.json'));if(!cfg?.codex_path)return;
 const targets=[...new Set([...snapshot().workers.filter(w=>w.thread_id).map(w=>w.thread_id),cfg.thread_id].filter(Boolean))];
 const record={at:new Date().toISOString(),reason:c.reason,deliveries:{}};write(noticePath,record);
 for(const id of targets){
  const message=`AFK_PAUSE ${c.revision}\n${c.reason}。这是暂停控制指令：立即停止发起新的模型调用、实验、代码修改与GitHub推送；保留已有成果，妥善终止或收尾当前安全可中止的操作，不启动替代线程或自动恢复。请用原上报命令将当前工作标blocked，说明用户暂停/到点暂停和最后成果路径。不得把预算充足当继续执行授权。只有用户后续明确要求恢复才可恢复。上报和只读状态核对仍可执行。`;
  record.deliveries[id]={status:'queuing'};write(noticePath,record);
  try{const r=await run(cfg.codex_path,['queue','--thread',id,'--message',message],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});record.deliveries[id]={status:'queued_pending_ack',stdout:r.stdout.trim()};}catch(e){record.deliveries[id]={status:'uncertain',error:e.message};}write(noticePath,record);
 }
}
async function main(){const [action,value]=process.argv.slice(2);
 if(action==='pause'){const c=read(p,{});write(p,{...c,mode:'paused',reason:value||'用户明确要求暂停',paused_at:new Date().toISOString(),revision:crypto.randomUUID()});await enforceControl();}
 else if(action==='resume'){const c=read(p,{});if(c.deadline&&Date.now()>=Date.parse(c.deadline))throw Error('截止时间已过；需用户重新授权时间范围');write(p,{...c,mode:'running',reason:null,resumed_at:new Date().toISOString(),revision:crypto.randomUUID()});}
 else if(action==='check'){const c=policy();console.log(JSON.stringify(c));if(c.paused)process.exitCode=3;return;}
 else if(action!=='status')throw Error('pause [reason] | resume | status | check');
 console.log(JSON.stringify(policy(),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
