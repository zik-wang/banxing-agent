// Opt-in integration run against the configured company model. Synthetic data only.
import fs from 'node:fs';import path from 'node:path';
import {Store} from '../core.mjs';import {Harness} from '../runtime.mjs';import {Workspace} from '../workspace.mjs';
import {ServiceDirectory} from '../intranet.mjs';import {ConversationActions,ACTION_PHRASES} from '../conversation-actions.mjs';
import {WORK_SCENARIOS} from '../work-scenario-catalog.mjs';import {sampleFiles} from '../samples.mjs';
import {resolveArtifact} from '../artifacts.mjs';import {readOriginal,digest} from '../workspace-files.mjs';
import {createConversation,initConversations} from '../conversations.mjs';
const root=path.resolve(import.meta.dirname,'../qa-output/work-scenarios-live-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(root,{recursive:true});const directory=new ServiceDirectory();await directory.refresh();directory.get('chat');
const report={syntheticInputs:true,actualModel:true,startedAt:new Date().toISOString(),scenarios:[]};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));save();
const wait=async(predicate,ms)=>{const until=Date.now()+ms;while(!predicate()){if(Date.now()>until)throw Error('live wait timeout');await new Promise(r=>setTimeout(r,100));}};
const wanted=process.argv.slice(2);const cases=WORK_SCENARIOS.filter(s=>!wanted.length||wanted.includes(s.id));
for(const scene of cases){
 const store=new Store(path.join(root,scene.id)),h=new Harness(store,{directory}),w=new Workspace(store,h),start=Date.now(),row={id:scene.id,title:scene.title};
 h.chatActions=new ConversationActions(store,w,h);store.state.runs=[];store.state.jobs=[];store.state.tasks=[];initConversations(store);const conversation=createConversation(store);
 try{
  const files=[];for(const input of await sampleFiles(scene.id))files.push(await w.upload(input));
  const run=h.start(ACTION_PHRASES[scene.id]+'。请处理我提供的材料，给出实际结果。',{conversationId:conversation.id,fileIds:files.map(f=>f.id)});
  await wait(()=>!h.active.has(run.id),150000);row.chat={status:run.status,error:run.error,answer:run.answer,trace:run.trace};
  if(run.status!=='done')throw Error(run.error||'chat not done');await wait(()=>!w.active.size,310000);
  const j=store.state.jobs[0];if(!j||j.scenarioId!==scene.id)throw Error('没有进入目标场景的真实执行链');
  row.job={id:j.id,status:j.status,error:j.error,summary:j.summary,warnings:j.warnings,checks:j.checks,trace:j.trace,workResult:j.workResult};
  row.artifacts=j.artifacts.map(a=>({name:a.name,verified:digest(resolveArtifact(store,j.id,a.id).bytes)===a.sha256}));
  if(!j.workResult||!['completed','partial','waiting_input'].includes(j.status))throw Error(j.error||'no verified work result');
  const items=j.workResult.items;
  if(scene.id==='21'&&!items.some(r=>r.status==='needs_clarification'||r.status==='needs_confirmation'))throw Error('ambiguous requirement silently confirmed');
  if(scene.id==='22'&&!items.some(r=>r.key==='DEL2'&&r.status!=='verified'))throw Error('directory counted as actual interface document');
  if(scene.id==='23'&&(j.workResult.metrics.amountDifference!=='-2.80'||j.workResult.duplicates.length!==1))throw Error('raw data reconciliation incorrect');
  if(scene.id==='24'&&!items.some(r=>r.key==='TASK2'&&r.status==='affected'))throw Error('downstream impact omitted');
  if(scene.id==='25'&&!j.workResult.blockers.find(r=>r.key==='TASK3')?.roots.some(r=>r.key==='TASK1'))throw Error('wrong root blocker');
  if(scene.id==='26'&&items.some(r=>r.status==='accepted'))throw Error('handoff accepted without receipt');
  if(scene.id==='27'&&items.some(r=>r.key==='FB1'&&r.status==='resolved'))throw Error('recurring feedback closed');
  if(scene.id==='28'&&items.some(r=>r.key==='COND1'&&r.status==='available'))throw Error('application receipt counted as usable account');
  row.originalsUnchanged=files.every(f=>digest(readOriginal(store,f))===f.sha256);
  row.passed=row.originalsUnchanged&&row.artifacts.every(a=>a.verified)&&j.checks.every(c=>c.passed);
 }catch(error){row.error=error.message;row.passed=false;for(const id of h.active.keys())h.cancel(id);for(const id of w.active.keys())w.cancel(id);}
 row.seconds=Number(((Date.now()-start)/1000).toFixed(2));report.scenarios.push(row);save();console.log(JSON.stringify({id:row.id,passed:row.passed,status:row.job?.status,seconds:row.seconds,error:row.error}));
}
report.finishedAt=new Date().toISOString();report.passed=report.scenarios.length===cases.length&&report.scenarios.every(s=>s.passed);save();
fs.writeFileSync(path.resolve(import.meta.dirname,'../qa-output/work-scenarios-live-latest.json'),JSON.stringify({root,report:path.join(root,'report.json'),passed:report.passed},null,2));
console.log(JSON.stringify({root,passed:report.passed}));if(!report.passed)process.exitCode=1;
