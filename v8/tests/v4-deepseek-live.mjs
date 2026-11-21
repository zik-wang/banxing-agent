import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {ServiceDirectory} from '../src/integrations/intranet.mjs';import {ConversationActions,ACTION_PHRASES} from '../src/conversations/conversation-actions.mjs';import {Delegations} from '../src/workspace/delegations.mjs';import {DirectoryConnections} from '../src/integrations/directory-connections.mjs';import {sampleFiles} from '../src/workspace/samples.mjs';import {resolveArtifact} from '../src/documents/artifacts.mjs';import {readOriginal} from '../src/workspace/workspace-files.mjs';
const root=path.resolve(import.meta.dirname,'../qa-output/dsh-live-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(root,{recursive:true});
const directory=new ServiceDirectory();await directory.refresh();await directory.discoverMore();directory.get('chat');
const previousReport=process.env.DSH_RECHECK_REPORT?JSON.parse(fs.readFileSync(process.env.DSH_RECHECK_REPORT,'utf8')):null;
const report={previousReport:process.env.DSH_RECHECK_REPORT||null,attempts:previousReport?.attempts||[],startedAt:new Date().toISOString(),root,syntheticInputs:true,realModel:true,services:directory.status(),scenarios:previousReport?.scenarios||[]};const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));save();
const hash=b=>createHash('sha256').update(b).digest('hex');
async function waitFor(predicate,ms){const deadline=Date.now()+ms;while(!predicate()){if(Date.now()>deadline)throw Error('QA等待超时');await new Promise(r=>setTimeout(r,100));}}
const selected=process.env.DSH_SCENES?process.env.DSH_SCENES.split(',').map(Number):Array.from({length:20},(_,i)=>i+1);if(selected.some(n=>!Number.isInteger(n)||n<1||n>20))throw Error('DSH_SCENES仅接受1–20');
for(const n of selected){
  const scenarioId=String(n).padStart(2,'0'),started=Date.now(),row={scenarioId};
  const store=new Store(path.join(root,scenarioId)),h=new Harness(store,{directory}),w=new Workspace(store,h),d=new Delegations(store,w);store.state.conversations=[{id:'qa',title:'合成验收 '+scenarioId}];store.state.runs=[];store.state.jobs=[];store.state.tasks=[];store.state.approvals=[];
  row.dataRoot=store.directory;h.directories=new DirectoryConnections(store);h.chatActions=new ConversationActions(store,w,h,d);
  try{
    const files=[];for(const f of await sampleFiles(scenarioId))files.push(await w.upload(f));
    if(scenarioId==='18'){const draft=await w.recognizeFile(files[0].id);row.asr={model:draft.recognition.model,text:draft.recognition.draftText};w.confirmRecognition({fileId:files[0].id,draftHash:draft.recognition.draftHash,expectedTextHash:null,content:draft.recognition.draftText});}
    const extra=scenarioId==='10'?'；用上传的Excel作模板，只追加终审信息，项目名称去重':scenarioId==='04'?'；我叫陈晨，明确时间的本地提醒默认创建':scenarioId==='14'?'；检索问题：纪要核对有哪些步骤？':scenarioId==='19'?'；空数组返回0，不运行代码、不创建PR':'';
    const run=h.start(ACTION_PHRASES[scenarioId]+extra,{conversationId:'qa',fileIds:scenarioId==='20'?[]:files.map(f=>f.id)});await waitFor(()=>!h.active.has(run.id),140000);row.chat={status:run.status,error:run.error,answer:run.answer,turns:run.turns,trace:run.trace};if(run.status!=='done')throw Error(run.error||'聊天未完成');
    await waitFor(()=>w.active.size===0,310000);const job=store.state.jobs[0];if(!job)throw Error('没有启动实际业务任务');
    row.job={id:job.id,scenarioId:job.scenarioId,status:job.status,error:job.error,summary:job.summary,warnings:job.warnings,checks:job.checks,trace:job.trace,totals:job.totals,appended:job.appended,actions:job.actions};
    row.artifacts=job.artifacts.map(a=>({name:a.name,bytes:a.bytes,sha256:a.sha256,verified:hash(resolveArtifact(store,job.id,a.id).bytes)===a.sha256}));row.originalsUnchanged=files.every(f=>hash(readOriginal(store,f))===f.sha256);
    row.accepted=job.scenarioId===scenarioId&&['completed','partial','awaiting_approval'].includes(job.status)&&row.artifacts.length>0&&row.artifacts.every(a=>a.verified)&&row.originalsUnchanged&&job.checks.every(c=>c.passed);
    row.tasks=store.state.tasks.map(({title,dueAt})=>({title,dueAt}));
  }catch(error){row.error=error.message;row.accepted=false;for(const runId of h.active.keys())h.cancel(runId);for(const jobId of w.active.keys())w.cancel(jobId);}
  row.seconds=Number(((Date.now()-started)/1000).toFixed(2));const previous=report.scenarios.find(r=>r.scenarioId===scenarioId);if(previous)report.attempts.push(previous);report.scenarios=report.scenarios.filter(r=>r.scenarioId!==scenarioId);report.scenarios.push(row);report.scenarios.sort((a,b)=>a.scenarioId.localeCompare(b.scenarioId));save();console.log(JSON.stringify({scenarioId,accepted:row.accepted,status:row.job?.status,error:row.error,seconds:row.seconds}));
}
report.finishedAt=new Date().toISOString();report.summary={accepted:report.scenarios.filter(s=>s.accepted).length,total:report.scenarios.length,failed:report.scenarios.filter(s=>!s.accepted).map(s=>s.scenarioId),note:'真实Qwen与真实业务链路的合成样例验收；partial/awaiting_approval仍有已声明范围限制，不代表连接外部业务系统或语义零错误。'};save();fs.writeFileSync(path.resolve(root,'../dsh-live-latest.json'),JSON.stringify({root,report:path.join(root,'report.json')},null,2));console.log(JSON.stringify(report.summary));if(report.summary.failed.length)process.exitCode=1;
