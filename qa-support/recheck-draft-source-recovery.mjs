// Original three worker-05 synthetic boundaries against the fixed repair only.
// Usage: node <script> <repository> <new-evidence-directory>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const commit='e8dcbe2c65e0f5cffc469d489350deadef2bf169';
const [repoArg,outputArg]=process.argv.slice(2);
if(!repoArg||!outputArg)throw Error('Provide repository and new isolated evidence directory');
const repo=fs.realpathSync(repoArg),root=path.resolve(outputArg);
if(fs.existsSync(root))throw Error('Preserve previous evidence');
const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:4*1024*1024});
assert.equal(git(['cat-file','-t',commit]).toString().trim(),'commit');fs.mkdirSync(root,{recursive:true});
const snapshot=path.join(root,'candidate-source'),seen=new Set(),manifest=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex'),fileHash=file=>sha(fs.readFileSync(file));
const names=['continuity','document-tools','document-extras','text-tools','delivery-tools','source-record-tools','draft-delivery'],pending=names.map(n=>'v8-tools/'+n+'.mjs');
while(pending.length){
 const relative=pending.shift();if(seen.has(relative))continue;seen.add(relative);
 if(!/^[a-zA-Z0-9_./-]+\.mjs$/.test(relative)||relative.startsWith('../'))throw Error('Only static JavaScript sources allowed');
 const bytes=git(['show',commit+':'+relative]),target=path.join(snapshot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);manifest.push({path:relative,sha256:sha(bytes)});
 for(const m of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g))pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative),m[1])));
}
const [{Continuity},{DocumentTools},{DocumentExtras},{TextTools},{DeliveryTools},{SourceRecordTools},{saveDraft,getDraft}]=await Promise.all(names.map(n=>import(pathToFileURL(path.join(snapshot,'v8-tools',n+'.mjs')))));
const cases=[],scopeChecks=[];
for(const [name,hasTable,checkpointFailure]of [['control_source_draft_without_table',false,true],['uncached_source_draft_with_table',true,true],['checkpointed_source_draft_with_table',true,false]]){
 const directory=fs.mkdtempSync(path.join(root,name+'-')),original=path.join(directory,'synthetic-source.txt');
 fs.writeFileSync(original,'SYNTHETIC PUBLIC-LIKE SOURCE. Amount 42. No company data.');let sequence=0;
 const open=(mode='revise',resumeRunId,workItemId='synthetic-w',projectId='synthetic-p')=>{
  const runDirectory=path.join(directory,'run'+(++sequence));
  const c=new Continuity({directory:runDirectory,executionRepair:true,request:'Synthetic draft recovery QA; no network',inputClassification:'synthetic',continuity:{spaceRoot:path.join(directory,'space'),projectId,workItemId,mode,resumeRunId}});
  const d=new DocumentTools({directory:runDirectory,inputs:mode==='revise'?[original]:[],python:process.execPath});d.executionRepair=true;d.requestedFormats=['txt'];
  const e=new DocumentExtras(d),texts=new TextTools(d),out=new DeliveryTools(d,e,texts),records=new SourceRecordTools(d,e,texts),workbooks={tables:new Map()};c.bind({docs:d,extras:e,records,workbooks});return{c,d,e,out,workbooks};
 };
 const x=open();if(hasTable){x.workbooks.tables.set('synthetic-table',{id:'synthetic-table',headers:['amount'],rows:[[42]]});x.c.currentTableId='synthetic-table';}
 const old=x.out.register({title:'Synthetic previous delivery',filename:'previous.txt',bytes:Buffer.from('SYNTHETIC OLD DELIVERY MUST SURVIVE')});x.c.checkpoint();
 const oldHash=fileHash(old.path),originalHash=fileHash(original),sourceId=[...x.d.assets.keys()][0],source=x.d.asset(sourceId);
 const args={title:'Synthetic sourced draft',content:'SYNTHETIC DRAFT: source amount is 42.',source_ids:[sourceId]},checkpoint=x.c.checkpoint.bind(x.c);let saveError;
 if(checkpointFailure)x.c.checkpoint=()=>{throw Object.assign(Error('Explicit synthetic checkpoint fault; not a real Windows EPERM'),{code:'SYNTHETIC_CHECKPOINT_BLOCKED'});};
 let draft;try{draft=saveDraft(x.d,args);}catch(error){saveError=error.code;draft=[...x.d.results.values()].find(r=>r.method==='submitted_draft');}finally{x.c.checkpoint=checkpoint;}
 if(checkpointFailure)assert.equal(saveError,'SYNTHETIC_CHECKPOINT_BLOCKED');
 const draftPath=path.join(x.d.directory,'drafts',draft.version+'.json'),draftHash=fileHash(draftPath);
 let phase='bind',y,restored,error,sourceRefsPreserved=false,sourceIdPreserved=false,sourceMappingPreserved=false,tablePreserved=!hasTable;
 try{
  y=open('resume',x.c.runId);phase='getDraft';restored=getDraft(y.d,draft.resultId);assert.equal(restored.answer,args.content);
  assert.deepEqual(restored.sourceRefs,draft.sourceRefs);assert.equal(restored.sourceRefs.length,1);sourceRefsPreserved=true;
  assert.equal(y.d.asset(sourceId).id,sourceId);assert.equal(y.d.asset(sourceId).sha256,source.sha256);sourceIdPreserved=true;
  assert.deepEqual(y.c.mapping.get('asset:'+sourceId),source.resourceRef);sourceMappingPreserved=true;
  assert.equal(y.c.rootId,x.c.rootId);assert.equal(y.c.projectId,x.c.projectId);assert.equal(y.c.workItemId,x.c.workItemId);
  if(hasTable){assert.equal(y.c.currentTableId,x.c.currentTableId);assert.deepEqual(y.workbooks.tables.get('synthetic-table'),x.workbooks.tables.get('synthetic-table'));tablePreserved=true;}
  phase='complete';
 }catch(caught){error={code:caught.code||caught.name,message:caught.message,phase};}
 if(hasTable&&checkpointFailure)for(const [label,work,project]of [['other_work','another-work','synthetic-p'],['other_project_same_work','synthetic-w','another-project']]){
  let actual;try{open('resume',x.c.runId,work,project);actual='UNEXPECTED_SUCCESS';}catch(caught){actual=caught.code||caught.name;}
  scopeChecks.push({name:label,expected:'RESUME_SCOPE_DENIED',actual,passed:actual==='RESUME_SCOPE_DENIED'});
 }
 const item={name,hasTable,checkpointFailure,bindAndGetDraftPassed:phase==='complete',sourceRefsPreserved,sourceIdPreserved,sourceMappingPreserved,tablePreserved,
 oldDeliveryPreserved:fileHash(old.path)===oldHash,localDraftPreserved:fileHash(draftPath)===draftHash,originalInputPreserved:fileHash(original)===originalHash,
 restoredSourceCount:y?.d.assets.size??null,modelRequests:x.c.space.load().runs[x.c.rootId].budget.modelRequests,error};
 item.passed=item.bindAndGetDraftPassed&&sourceRefsPreserved&&sourceIdPreserved&&sourceMappingPreserved&&tablePreserved&&item.oldDeliveryPreserved&&item.localDraftPreserved&&item.originalInputPreserved&&item.modelRequests===0;
 cases.push(item);
}
const result={commit,kind:'ORIGINAL_THREE_SYNTHETIC_SOURCE_RECOVERY_BOUNDARIES_NEW_COMMIT_ONLY',newModelRequests:0,worker01WorktreeModified:false,productionTouched:false,
 passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).length,cases,scopeChecks,
 limits:['No old-candidate execution or full regression.','Synthetic checkpoint fault is not a real Windows EPERM.','Production lock root cause, real materials, end-to-end business and user acceptance unverified.']};
fs.writeFileSync(path.join(root,'snapshot-manifest.json'),JSON.stringify({commit,files:manifest},null,2));fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(result.failed||scopeChecks.some(c=>!c.passed))process.exitCode=1;
