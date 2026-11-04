// One bounded offline fixture against a fixed candidate; no model/network call.
// Usage: node <this-file> <git-repository> <new-isolated-output-directory>
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const commit='489cfa58260f4f230098341643f049159b0e91d4';
const [repoArg,outputArg]=process.argv.slice(2);
if(!repoArg||!outputArg)throw Error('Provide repository and a new isolated evidence directory');
const repo=fs.realpathSync(repoArg),root=path.resolve(outputArg);
if(fs.existsSync(root))throw Error('Refuse overwriting prior evidence');
const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:4*1024*1024});
if(git(['cat-file','-t',commit]).toString().trim()!=='commit')throw Error('Candidate unavailable');
fs.mkdirSync(root,{recursive:true});
const snapshot=path.join(root,'candidate-source'),seen=new Set(),manifest=[];
const seeds=['continuity','document-tools','document-extras','text-tools','delivery-tools','source-record-tools','draft-delivery'].map(n=>'v8-tools/'+n+'.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
while(seeds.length){
 const relative=seeds.shift();if(seen.has(relative))continue;seen.add(relative);
 if(!/^[a-zA-Z0-9_./-]+\.mjs$/.test(relative)||relative.startsWith('../'))throw Error('Only static JavaScript source may be copied');
 const bytes=git(['show',commit+':'+relative]),target=path.join(snapshot,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);manifest.push({path:relative,sha256:sha(bytes)});
 for(const m of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g))seeds.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative),m[1])));
}
const modules=await Promise.all(['continuity','document-tools','document-extras','text-tools','delivery-tools','source-record-tools','draft-delivery'].map(n=>import(pathToFileURL(path.join(snapshot,'v8-tools',n+'.mjs')))));
const [{Continuity},{DocumentTools},{DocumentExtras},{TextTools},{DeliveryTools},{SourceRecordTools},{saveDraft,getDraft}]=modules;
const source=path.join(root,'synthetic-source.txt');fs.writeFileSync(source,'SYNTHETIC source amount 42; no company data.');
let serial=0;
const open=(mode='revise',resumeRunId)=>{
 const directory=path.join(root,'run'+(++serial));
 const c=new Continuity({directory,executionRepair:true,request:'Synthetic recovery fixture',inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'synthetic-p',workItemId:'synthetic-w',mode,resumeRunId}});
 const d=new DocumentTools({directory,inputs:mode==='revise'?[source]:[],python:process.execPath});d.executionRepair=true;d.requestedFormats=['txt'];
 const e=new DocumentExtras(d),texts=new TextTools(d),out=new DeliveryTools(d,e,texts),records=new SourceRecordTools(d,e,texts),workbooks={tables:new Map()};
 c.bind({docs:d,extras:e,records,workbooks});return{c,d,e,out,workbooks};
};
const first=open(),old=first.out.register({title:'Synthetic prior delivery',filename:'previous.txt',bytes:Buffer.from('SYNTHETIC immutable old delivery')});
// Exercise the actual continuity operation boundary with a synthetic table result.
// This is not a real spreadsheet merge or a model invocation.
await first.c.operation('merge_tables',{table_ids:['synthetic-input']},()=>{
 first.workbooks.tables.set('synthetic-table',{id:'synthetic-table',headers:['amount'],rows:[[42]]});return{tableId:'synthetic-table'};
});
const oldHash=sha(fs.readFileSync(old.path)),sourceId=[...first.d.assets.keys()][0];
const checkpoint=first.c.checkpoint.bind(first.c);
first.c.checkpoint=()=>{throw Object.assign(Error('Explicit synthetic checkpoint fault, not a real Windows EPERM'),{code:'SYNTHETIC_CHECKPOINT_BLOCKED'});};
let originalError;
try{saveDraft(first.d,{title:'Synthetic sourced draft',content:'SYNTHETIC draft with source amount 42.',source_ids:[sourceId]});}
catch(error){originalError={code:error.code,locallySaved:error.details?.locallySaved};}
finally{first.c.checkpoint=checkpoint;}
if(originalError?.code!=='SYNTHETIC_CHECKPOINT_BLOCKED'||!originalError.locallySaved)throw Error('Fault did not occur at intended checkpoint boundary');
const draft=[...first.d.results.values()].find(r=>r.method==='submitted_draft'),draftPath=path.join(first.d.directory,'drafts',draft.version+'.json'),draftHash=sha(fs.readFileSync(draftPath));
const bundle=JSON.parse(first.c.space.read('synthetic-p',first.c.space.load().runs[first.c.runId].checkpoint));
let phase='bind',caught;
try{const second=open('resume',first.c.runId);phase='getDraft';getDraft(second.d,draft.resultId);phase='complete';}
catch(error){caught={code:error.code||error.name,phase,message:error.message};}
const result={candidate:commit,kind:'SYNTHETIC_ONE_CASE_REPRODUCTION',sourceFiles:manifest.length,checkpointAssetCount:bundle.assets.length,checkpointHasTable:!!bundle.currentTableId,checkpointContainsDraft:bundle.results.some(r=>r.resultId===draft.resultId),
 originalError,resumeError:caught,oldDeliveryPreserved:sha(fs.readFileSync(old.path))===oldHash,localDraftPreserved:sha(fs.readFileSync(draftPath))===draftHash,
 modelRequests:first.c.space.load().runs[first.c.rootId].budget.modelRequests,productionTouched:false,worker01WorktreeModified:false};
result.verdict=caught?.code==='UNKNOWN_ASSET'&&caught.phase==='bind'&&result.oldDeliveryPreserved&&result.localDraftPreserved&&result.modelRequests===0?'DEFECT_REPRODUCED':'EXPECTED_DEFECT_NOT_REPRODUCED';
fs.writeFileSync(path.join(root,'snapshot-manifest.json'),JSON.stringify({commit,files:manifest},null,2));
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(result.verdict!=='DEFECT_REPRODUCED')process.exitCode=1;
