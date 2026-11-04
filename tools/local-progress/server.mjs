import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {root,config,data,port,base,init,read,write,file,assignment,workerEntries,snapshot} from './core.mjs';
import {auditConnections} from './connection-audit.mjs';
const credentials=init();
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.headers.host!==`127.0.0.1:${port}` && req.headers.host!==`localhost:${port}`)return send(res,403,{error:'invalid host'});
 if(req.headers.origin && req.headers.origin!==base && req.headers.origin!==`http://localhost:${port}`)return send(res,403,{error:'invalid origin'});
 try{
  if(req.method==='GET' && req.url==='/health')return send(res,200,{ok:true,pid:process.pid,service:'local-progress',uptime:process.uptime()});
  if(req.method==='GET' && req.url==='/api/state'){const state=snapshot();state.connection_verification=auditConnections(state);return send(res,200,state);}
  if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'"});return res.end(fs.readFileSync(path.join(root,'index.html')));}
  if(req.method==='GET' && ['/app.js','/style.css'].includes(req.url)){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(fs.readFileSync(path.join(root,req.url.slice(1))));}
  if(req.method!=='POST' || !['/api/report','/api/accept'].includes(req.url))return send(res,404,{error:'not found'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON required'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(res,413,{error:'metadata only, max 16KB'});}
  let body;try{body=JSON.parse(raw);}catch{return send(res,400,{error:'invalid JSON'});}
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(req.url==='/api/accept'){
   if(token!==credentials.admin)return send(res,403,{error:'user acceptance requires admin credential'});
   if(!config.tasks.some(t=>t.task_id===body.task_id)||typeof body.accepted!=='boolean')return send(res,400,{error:'invalid acceptance'});
   const a=read(path.join(data,'acceptance.json'),{});a[body.task_id]={accepted:body.accepted,updated_at:new Date().toISOString(),by:'user'};write(path.join(data,'acceptance.json'),a);return send(res,200,a[body.task_id]);
  }
  const w=assignment(body.worker_id);
  if(!w || !token || token!==credentials.workers[body.worker_id])return send(res,403,{error:'unknown worker or invalid credential'});
  const stored=read(file(w.worker_id));
  if(body.thread_id!==undefined && (typeof body.thread_id!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.thread_id)))return send(res,400,{error:'invalid thread_id'});
  if(stored?.thread_id && body.thread_id && stored.thread_id!==body.thread_id)return send(res,409,{error:'worker_id already belongs to another chat; choose a distinct worker_id'});
  if(body.thread_id && !w.worker_id.startsWith('demo-')){
   const duplicate=[...config.workers,...config.legacy_workers].find(other=>other.worker_id!==w.worker_id&&read(file(other.worker_id))?.thread_id===body.thread_id);
   if(duplicate)return send(res,409,{error:'this chat is already bound to '+duplicate.worker_id});
  }
  const ids=body.task_ids===undefined?[body.task_id]:body.task_ids;
  const allowed=w.worker_id.startsWith('demo-')?['DEMO']:[...config.tasks.map(t=>t.task_id),'GENERAL'];
  if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length||!ids.includes(body.task_id)||ids.some(id=>!allowed.includes(id)))return send(res,409,{error:'invalid task_ids; real workers may report T1/T2/T3/T4 or GENERAL; demo stays isolated'});
  if(!['todo','running','blocked','done'].includes(body.status))return send(res,400,{error:'status: todo/running/blocked/done'});
  const fields=['stage','next_step','blocker','result_path'];
  if(fields.some(k=>typeof body[k]!=='string'||body[k].length>1000))return send(res,400,{error:'stage/next_step/blocker/result_path must be strings <=1000 characters'});
  if(body.status==='blocked'&&!body.blocker.trim())return send(res,400,{error:'blocked requires blocker'});
  const reports=ids.map(task_id=>({worker_id:w.worker_id,task_id,status:body.status,...Object.fromEntries(fields.map(k=>[k,body[k]])),updated_at:new Date().toISOString()}));
  // One atomic file per worker, independently keyed by task. Switching tasks retains previous progress.
  const entries=workerEntries(w.worker_id);for(const report of reports)entries[report.task_id]=report;
  fs.mkdirSync(path.join(data,'events'),{recursive:true});fs.appendFileSync(path.join(data,'events',new Date().toISOString().slice(0,10)+'.jsonl'),reports.map(r=>JSON.stringify(r)).join('\n')+'\n');write(file(w.worker_id),{worker_id:w.worker_id,thread_id:stored?.thread_id||body.thread_id||null,entries});
  const ack=body.stage.match(/AFK_ACK:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i);
  if(ack){const cycle=read(path.join(data,'supervision',ack[1]+'.json'));if(cycle?.deliveries?.[w.worker_id]&&cycle.workers.some(x=>x.worker_id===w.worker_id&&x.thread_id===(stored?.thread_id||body.thread_id))){const ackPath=path.join(data,'supervision-receipts',ack[1],w.worker_id+'.json');if(!read(ackPath))write(ackPath,{worker_id:w.worker_id,cycle_id:ack[1],acknowledged_at:new Date().toISOString(),message:'worker 已主动回执；具体执行与完成以真实上报为准'});}}
  const connection=body.stage.match(/AFK_CONNECT_(ACK|PROGRESS):([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i);
  if(connection){
   const enrollment=read(path.join(data,'onboarding',w.worker_id+'.json'));
   if(enrollment?.id===connection[2]&&enrollment.thread_id===(stored?.thread_id||body.thread_id)){
    const receiptPath=path.join(data,'onboarding-receipts',w.worker_id+'.json');const old=read(receiptPath,{});
    write(receiptPath,{...old,worker_id:w.worker_id,id:connection[2],thread_id:enrollment.thread_id,[connection[1]==='ACK'?'acknowledged_at':'progress_reported_at']:new Date().toISOString(),[connection[1]==='ACK'?'ack_report':'progress_report']:reports[0]});
   }
  }
  return send(res,200,{ok:true,report:reports[0],reports});
 }catch(e){console.error(new Date().toISOString(),e);send(res,500,{error:'local storage/server error; consult runtime log'});}
});
server.requestTimeout=10000;server.headersTimeout=15000;
server.listen(port,'127.0.0.1',()=>console.log(new Date().toISOString(),base));
server.on('error',e=>{console.error(e);process.exit(1);});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
