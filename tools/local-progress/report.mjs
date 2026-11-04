import {init,assignment,base} from './core.mjs';
// Positional args avoid PowerShell quoting ambiguities. Empty values may be passed as "-".
const args=process.argv.slice(2);
const worker_id=args.shift();
const w=assignment(worker_id);
// Old commands remain accepted for previously assigned workers; neutral workers must supply tasks.
const tasks=['todo','running','blocked','done'].includes(args[0])?(w?.task_id||'GENERAL'):args.shift();
const [status,stage,next_step='-',blocker='-',result_path='-']=args;
if(!w||!status||!stage||!tasks){console.error('node report.mjs WORKER T1|T1,T4|GENERAL todo|running|blocked|done "当前阶段" "下一步" "阻塞原因或-" "允许记录的结果路径或-"');process.exit(1);}
const task_ids=tasks.split(',');
const clean=s=>s==='-'?'':s;
try{
 const thread_id=process.env.CODEX_THREAD_ID||process.env.CODEX_SESSION_ID;
 const r=await fetch(base+'/api/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+init().workers[worker_id]},body:JSON.stringify({worker_id,thread_id,task_id:task_ids[0],task_ids,status,stage:clean(stage),next_step:clean(next_step),blocker:clean(blocker),result_path:clean(result_path)}),signal:AbortSignal.timeout(5000)});
 const body=await r.json();if(!r.ok)throw new Error(JSON.stringify(body));console.log(JSON.stringify(body,null,2));
}catch(e){console.error('上报失败：'+e.message+'；请保留失败说明并在服务恢复后重试。');process.exit(1);}
