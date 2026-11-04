import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {read,data} from './core.mjs';
import path from 'node:path';
const cfg=read(path.join(data,'supervisor-config.json'));
const child=spawn(cfg.codex_path,['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let seq=0;const pending=new Map();let stderr='';
child.stderr.on('data',c=>{stderr+=c;});
const rl=readline.createInterface({input:child.stdout});
rl.on('line',line=>{try{const m=JSON.parse(line);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}catch{}});
function call(method,params){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
const timeout=setTimeout(()=>{console.error('Read-only API timed out: '+stderr.slice(-1200));child.kill();process.exitCode=1;},25000);
try{
 await call('initialize',{clientInfo:{name:'local_progress_readonly',version:'1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const [action,id]=process.argv.slice(2);
 if(action==='list'){
  const r=await call('thread/list',{limit:100,sortKey:'updated_at',cwd:'D:\\pro222\\pccr-eye-gaze',sourceKinds:[],archived:false});
  console.log(JSON.stringify({threads:r.data.filter(t=>/^(0[1-7]|05挑错)$/.test(t.name||'')).map(t=>({id:t.id,name:t.name,updatedAt:t.updatedAt,source:t.source})),nextCursor:r.nextCursor},null,2));
 }else if(['worker-evidence','delivery-evidence'].includes(action)){
  const r=await call('thread/turns/list',{threadId:id,limit:action==='delivery-evidence'?2:8,sortDirection:'desc',itemsView:'full'});
  const hits=[],received=[];
  function walk(v){if(!v||typeof v!=='object')return;
   if(v.type==='commandExecution'&&typeof v.command==='string'&&/report/i.test(v.command)){const m=v.command.match(/worker-\d\d/g);if(m)hits.push(...m);}
   if(v.type==='commandExecution'&&typeof v.aggregatedOutput==='string'){const m=v.aggregatedOutput.match(/"worker_id"\s*:\s*"(worker-\d\d)"/g);if(m)hits.push(...m.map(x=>x.match(/worker-\d\d/)[0]));}
   if(v.type==='userMessage'){const text=JSON.stringify(v);const m=text.match(/AFK_CONNECT\s+[0-9a-f-]{36}|AFK 推进建议[^\n]{0,120}/g);if(m)received.push(...m.map(x=>x.slice(0,150)));}
   if(v.type==='function_call'&&typeof v.arguments==='string'&&v.arguments.includes('report.mjs')){const matches=v.arguments.match(/report\.mjs(?:\\?['"])?\s+(worker-\d\d)/g);if(matches)hits.push(...matches.map(x=>x.match(/worker-\d\d/)[0]));}
   for(const x of Object.values(v))if(typeof x==='object')walk(x);
  }
  walk(r);console.log(JSON.stringify({thread_id:id,executed_worker_ids:[...new Set(hits)],received_afk_requests:[...new Set(received)],turns:(r.data||[]).map(t=>({id:t.id,status:t.status,item_count:t.items?.length})),has_more:!!r.nextCursor},null,2));
 }else throw Error('list | worker-evidence THREAD_ID');
}catch(e){console.error(e.message);process.exitCode=1;}finally{clearTimeout(timeout);rl.close();child.stdin.end();child.kill();}
