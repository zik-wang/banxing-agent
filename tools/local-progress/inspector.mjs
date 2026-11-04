import fs from 'node:fs';
import path from 'node:path';
import {data,interval,base,init,write,snapshot} from './core.mjs';
import {requestReview,observeConnectionResults,observeSiliconflowAdoption} from './supervision.mjs';
import {auditConnections} from './connection-audit.mjs';
import {enforceControl} from './control.mjs';
init();let last=null,next=Date.now();
function heartbeat(){write(path.join(data,'inspector.json'),{pid:process.pid,heartbeat_at:new Date().toISOString(),last_inspection_at:last,next_inspection_at:new Date(next).toISOString(),interval_ms:interval});}
async function inspect(){
 const s=snapshot();try{const h=await fetch(base+'/health',{signal:AbortSignal.timeout(3000)});s.report_service_available=h.ok;}catch{s.report_service_available=false;}
 auditConnections(s);
 s.notice='仅根据主动上报判断；服务可用不代表 worker 正在运行。无更新标为状态待核实，不注入工作窗口。';
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 write(path.join(data,'summaries',stamp+'.json'),s);
 const describe=w=>`- ${w.worker_id}：${w.freshness}；上报=${w.status||'无'}；阶段=${w.stage||'无'}；下一步=${w.next_step||'无'}；阻塞=${w.blocker||'无'}；结果路径=${w.result_path||'无'}；更新时间=${w.updated_at||'无'}`;
 const lines=[`# AFK 巡检 ${s.generated_at}`,`时区 Asia/Shanghai；上报服务可用：${s.report_service_available}`,s.notice,'','## 窗口接入状态',...s.workers.map(describe),'',...s.tasks.flatMap(t=>[`## ${t.task_id} ${t.title} / ${t.status} / 用户验收：${t.acceptance.accepted?'通过':'未验收'}`,...t.workers.map(describe)]),'','## 跨任务 / 待归类',...s.unclassified.map(describe),'','## 演示数据（与真实任务隔离）',...s.demo.map(w=>`- ${w.worker_id}: ${w.freshness} / ${w.status||'无'}`)];
 fs.writeFileSync(path.join(data,'summaries',stamp+'.md'),lines.join('\n'));
 fs.appendFileSync(path.join(data,'afk.jsonl'),JSON.stringify({at:s.generated_at,report_service_available:s.report_service_available,summary:stamp,workers:s.workers.map(w=>({worker_id:w.worker_id,freshness:w.freshness,updated_at:w.updated_at||null,task_ids:w.task_ids,reports:w.reports.map(r=>({task_id:r.task_id,freshness:r.freshness,updated_at:r.updated_at}))}))} )+'\n');
 last=s.generated_at;next=Date.now()+interval;heartbeat();
 await requestReview(s);
}
async function loop(){try{await inspect();}catch(e){console.error(new Date().toISOString(),e);next=Date.now()+interval;}setTimeout(loop,Math.max(1,next-Date.now()));}
let observing=false;
async function observe(){if(observing)return;observing=true;try{await enforceControl();await observeConnectionResults(auditConnections());await observeSiliconflowAdoption();}catch(e){console.error(new Date().toISOString(),e);}finally{observing=false;}}
setInterval(heartbeat,15000);setInterval(observe,15000);observe();loop();
