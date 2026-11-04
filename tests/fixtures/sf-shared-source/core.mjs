import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=path.dirname(fileURLToPath(import.meta.url));
export const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
export const data=path.resolve(process.env.BOARD_DATA || path.join(root,'data'));
export const interval=Number(process.env.BOARD_INTERVAL_MS || config.interval_ms);
export const stale=Number(process.env.BOARD_STALE_MS || config.stale_ms);
export const port=Number(process.env.BOARD_PORT || config.port);
export const base=`http://127.0.0.1:${port}`;
export const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export function write(p,obj){fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj,null,2));fs.renameSync(tmp,p);}
export function init(){fs.mkdirSync(data,{recursive:true});const p=path.join(data,'credentials.json');const c=read(p)||{admin:crypto.randomBytes(24).toString('hex'),workers:{}};let changed=!fs.existsSync(p);for(const w of [...config.workers,...config.legacy_workers,{worker_id:'demo-a'},{worker_id:'demo-b'}]){if(!c.workers[w.worker_id]){c.workers[w.worker_id]=crypto.randomBytes(24).toString('hex');changed=true;}}if(changed)write(p,c);return c;}
export const assignment=id=>config.workers.find(w=>w.worker_id===id) || config.legacy_workers.find(w=>w.worker_id===id) || (['demo-a','demo-b'].includes(id)?{task_id:'DEMO',worker_id:id}:null);
export const file=(id)=>path.join(data,'workers',id+'.json');
export function workerEntries(id){const old=read(file(id));return old?.entries || (old?{[old.task_id]:old}:{});}
export function snapshot(now=Date.now()){
 const fresh=r=>({...r,connected:true,freshness:now-Date.parse(r.updated_at)>=stale?'状态待核实':'最近有上报'});
 const sessions=[...config.workers,...config.legacy_workers.filter(w=>fs.existsSync(file(w.worker_id))),{worker_id:'demo-a'},{worker_id:'demo-b'}].map(w=>{
  const reports=Object.values(workerEntries(w.worker_id)).map(fresh).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));
  return {worker_id:w.worker_id,...reports[0],thread_id:read(file(w.worker_id))?.thread_id||null,onboarding:read(path.join(data,'onboarding',w.worker_id+'.json')),onboarding_receipt:read(path.join(data,'onboarding-receipts',w.worker_id+'.json')),connected:!!reports.length,freshness:reports[0]?.freshness||'未接入',task_ids:reports.map(r=>r.task_id),reports};
 });
 const workers=sessions.filter(w=>!w.worker_id.startsWith('demo-'));
 const reports=workers.flatMap(w=>w.reports);
 const acceptance=read(path.join(data,'acceptance.json'),{});
 const sfQueue=read(path.join(data,'siliconflow-queue.json'));
 const supervision=read(path.join(data,'supervision-status.json'));
 if(supervision?.deliveries&&supervision.cycle_id){supervision.receipts=Object.fromEntries(Object.keys(supervision.deliveries).map(id=>[id,read(path.join(data,'supervision-receipts',supervision.cycle_id,id+'.json'))]));}
 return {generated_at:new Date(now).toISOString(),timezone:config.timezone,stale_ms:stale,interval_ms:interval,
 workers,unclassified:reports.filter(r=>r.task_id==='GENERAL'),supervision,siliconflow_policy:read(path.join(data,'siliconflow-policy.json')),siliconflow_queue:sfQueue?{active_worker:sfQueue.active?.worker_id||null,queued_workers:sfQueue.waiting.map(w=>w.worker_id),next_allowed_at:sfQueue.next_allowed_at}:null,run_control:read(path.join(data,'run-control.json')),budget_authorization:read(path.join(data,'budget-authorization.json')),github_publishing:read(path.join(data,'github-publishing.json')),connection_verification:read(path.join(data,'connection-verification.json')),
 tasks:config.tasks.map(t=>{const ws=reports.filter(w=>w.task_id===t.task_id);return {...t,status:ws.length?'已有上报':'待办',acceptance:acceptance[t.task_id]||{accepted:false},workers:ws};}),
 demo:sessions.filter(w=>w.worker_id.startsWith('demo-')),milestones:config.milestones,inspector:read(path.join(data,'inspector.json'))};
}
