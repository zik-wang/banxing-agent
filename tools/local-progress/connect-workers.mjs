import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {data,root,read,write,assignment,file} from './core.mjs';
const run=promisify(execFile);
const [worker_id,thread_id,...words]=process.argv.slice(2);
if(!assignment(worker_id)||worker_id.startsWith('demo-')||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(thread_id||''))throw Error('usage: WORKER THREAD "bounded next step"');
const cfg=read(path.join(data,'supervisor-config.json'));
if(thread_id===cfg.thread_id)throw Error('cannot enroll supervisor as worker');
const previous=read(file(worker_id));if(previous?.thread_id&&previous.thread_id!==thread_id)throw Error('binding mismatch');
const p=path.join(data,'onboarding',worker_id+'.json');if(read(p))throw Error('onboarding already attempted; inspect receipt before retry');
const id=crypto.randomUUID();const message=`AFK_CONNECT ${id} / ${worker_id}\n用户已要求总控把其他工作窗口接上并验证收到建议后的实际推进。已通过官方只读接口核对你此前使用的上报编号是 ${worker_id}；请保持本聊天和原目录，不另开执行器。\n先读取 '${path.join(root,'接入提示词.txt')}'，立即使用原 report.mjs 命令上报当前真实状态，worker_id=${worker_id}，stage 带 AFK_CONNECT_ACK:${id}。脚本自动从当前环境绑定聊天；不要代其他窗口上报。\n在最新用户指令和既有授权内有限推进：${words.join(' ')}\n请先做一个可验证步骤，再上报阶段结果及允许保存的证据路径，stage 带 AFK_CONNECT_PROGRESS:${id}。如果已完成全部授权工作或需要新权限/材料/费用，明确说明并上报真实done或blocked，不虚构进行中。禁止搬材料、扩大预算、部署发布或代用户验收。此条建议无需人工再次转发；执行后请正常结束本次回复，后续由独立巡检发起。`;
write(p,{id,worker_id,thread_id,status:'queuing',requested_at:new Date().toISOString(),advice:words.join(' ')});
try{const q=await run(cfg.codex_path,['queue','--thread',thread_id,'--message',message],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});write(p,{...read(p),status:'queued_pending_worker_ack',queued_at:new Date().toISOString(),stdout:q.stdout.trim()});console.log(JSON.stringify({worker_id,id,status:'queued_pending_worker_ack'}));}catch(e){write(p,{...read(p),status:'uncertain',error:e.message});throw e;}
