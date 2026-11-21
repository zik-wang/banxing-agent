import fs from 'node:fs';import path from 'node:path';
import {contentHash,canonical} from '../src/recovery/reliability.mjs';
import {readRecovery} from '../src/recovery/task-recovery.mjs';
import {buildSupplementPlan,sameUnits} from '../src/recovery/supplement-plan.mjs';
import {registerSupplementEvidence} from '../src/recovery/supplement-evidence.mjs';
import {readOriginal} from '../src/workspace/workspace-files.mjs';
const root=path.resolve(import.meta.dirname,'..'),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
try{
 const reportFile=path.resolve(process.argv[2]||''),folder=path.dirname(reportFile),report=read(reportFile),store={directory:path.join(root,'data'),state:read(path.join(root,'data/state.json'))},registered=[];
 if(!report.finishedAt||report.error)throw Error('没有完整的历史实跑报告');
 for(const c of report.cases.filter(c=>c.parent&&['extract','audit'].includes(c.phase))){
  if(!/^[A-Za-z0-9_-]+$/.test(c.id)||!/^[A-Za-z0-9_-]+$/.test(c.jobId)||!/^[a-f0-9-]+$/.test(c.auditId)||!c.allTargetsRegistered)throw Error('历史补查项不完整');
  const base=store.state.jobs.find(j=>j.id===c.parent.taskId);if(!base)throw Error('原任务不存在');
  const files=base.dataScope.map(s=>{const f=store.state.workspaceFiles.find(f=>f.id===s.id&&f.sha256===s.sha256);if(!f)throw Error('原件变化');readOriginal(store,f);return f;});
  const plan=buildSupplementPlan(store,{base,files,checkpoint:readRecovery(store,base)});
  const reqFile=path.join(folder,c.id,'request.json'),rawFile=path.join(folder,c.id,'parsed.json'),callFile=path.join(folder,'qa-runtime/reliability',c.jobId,'calls',c.auditId+'.json'),parsedFile=path.join(path.dirname(callFile),c.auditId+'-parsed.json'),inputFile=path.join(path.dirname(callFile),c.auditId+'-input.json');
  const request=read(reqFile),raw=read(rawFile),call=read(callFile),input=read(inputFile),targets=request.documents[0].units.filter(u=>u.target),context=request.documents[0].units.filter(u=>u.contextOnly);
  if(call.id!==c.auditId||call.taskId!==c.jobId||canonical(request.documents)!==canonical(input.documents)||canonical(raw)!==canonical(read(parsedFile))||canonical(request.profile)!==canonical(call.inference.profile))throw Error('原始请求、调用记录、解析结果或模型配置不一致');
  if(!plan.groups.some(g=>g.phase===c.phase&&sameUnits(g.targets,targets)&&sameUnits(g.context,context)))throw Error('历史回执不对应当前剩余目标/上下文');
  const sessionFile=path.join(folder,'qa-runtime/harness-sessions',path.basename(call.harnessSession.file)),events=fs.readFileSync(sessionFile,'utf8').trim().split('\n').map(JSON.parse);
  if(events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason?.kind!=='completed')throw Error('历史Harness会话未真实完成');
  const origin={kind:'historical-intranet-run',reportFile,sourceFiles:[reqFile,rawFile,callFile,parsedFile,inputFile,sessionFile].map(file=>({file,sha256:contentHash(fs.readFileSync(file))}))};
  const receipt=registerSupplementEvidence(store,{base,request,raw,call,phase:c.phase,origin});registered.push({baseTaskId:base.id,phase:c.phase,modelCallId:receipt.call.id,targets:targets.length,newModelRequests:0});
 }
 console.log(JSON.stringify({registered,newModelRequests:0},null,2));
}catch(error){console.error(error.stack);process.exitCode=1;}
