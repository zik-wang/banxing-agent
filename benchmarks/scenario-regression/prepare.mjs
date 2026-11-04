import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
export const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function prepareCases(intakeFile,scopeFile,out){
 const root=path.dirname(path.resolve(intakeFile)),intake=JSON.parse(fs.readFileSync(intakeFile)),scope=JSON.parse(fs.readFileSync(scopeFile));
 if(scope.active.length!==18||new Set(scope.active).size!==18)throw Error('Expected the frozen original 18-case scope');
 const cases=[];
 for(const id of scope.active){const original=intake.cases.find(c=>c.id===id);if(!original)throw Error('Missing original case '+id);
  const requestFile=path.join(original.folder,'REQUEST.txt'),request=fs.readFileSync(requestFile,'utf8').replace(/^\uFEFF/,'');
  if(request.trim()!==original.request.trim())throw Error('Original request differs from intake '+id);
  const inputs=[];for(const input of original.files){const resolved=fs.realpathSync(input.path),allowed=path.resolve(root,'inputs');if(!resolved.startsWith(allowed+path.sep))throw Error('Input outside original frozen package');if(digest(resolved)!==input.sha256)throw Error('Original input hash mismatch '+id+'/'+input.name);
   const folder=path.join(out,'inputs',id);fs.mkdirSync(folder,{recursive:true});const target=path.join(folder,path.basename(input.name));if(fs.existsSync(target))throw Error('Refuse input overwrite');fs.copyFileSync(resolved,target);if(digest(target)!==input.sha256)throw Error('Copy mismatch');inputs.push({name:input.name,path:target,original:resolved,sha256:input.sha256,bytes:fs.statSync(target).size});
  }
  cases.push({id,title:original.title,request,requestFile,requestSha256:digest(requestFile),inputs,sourceStatus:original.sourceStatus,expectedBlocked:original.sourceStatus==='blocked',variant:{kind:'format_followup_without_reprocessing',request:'把刚才已经完成的实际回复整理成Markdown文件，完整保留原有事实、限制和待确认项。不要重新分析原件，不要补写未完成的内容。',requiresCompletedBase:true,expectedNewModelRequests:0},semanticGold:'not independently adjudicated'});
 }
 return cases;
}
export function snapshot(repo,revision,destination,python){
 if(fs.existsSync(destination))throw Error('Refuse snapshot overwrite');fs.mkdirSync(destination,{recursive:true});const archive=destination+'.zip';
 execFileSync('git',['-C',repo,'archive','--format=zip','--output',archive,revision]);
 execFileSync(python,['-c',"import zipfile,pathlib,sys; z=zipfile.ZipFile(sys.argv[1]); r=pathlib.Path(sys.argv[2]).resolve(); assert all((r/p).resolve().is_relative_to(r) for p in z.namelist()); z.extractall(r)",archive,destination]);
 return execFileSync('git',['-C',repo,'rev-parse',revision],{encoding:'utf8'}).trim();
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [intake,scope,outArg,repoArg,baselineArg='HEAD']=process.argv.slice(2);if(!repoArg)throw Error('Usage: prepare.mjs intake scope NEW-output repo [baseline]');
 const out=path.resolve(outArg),repo=path.resolve(repoArg);if(fs.existsSync(path.join(out,'manifest.json')))throw Error('Preserve existing suite');fs.mkdirSync(out,{recursive:true});
 const python='C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
 const cases=prepareCases(intake,scope,out),baselineRevision=snapshot(repo,baselineArg,path.join(out,'baseline-runtime'),python);
 const manifest={kind:'FROZEN_ORIGINAL_18_AND_FORMAT_FOLLOWUP_VARIANTS',createdAt:new Date().toISOString(),cases,port:8986,repo,baselineRevision,baselineRuntime:path.join(out,'baseline-runtime'),candidateRuntime:null,candidateRevision:null,settings:{endpoint:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3.8-27B',temperature:.1,topP:.95,maxTokens:4500,enableThinking:false,maxRequestsPerRun:8,singleCallTimeoutMs:150000,totalTaskTimeoutMs:600000,estimatedTokensPerMinute:80000,maxTotalRequests:160},host:{python,docxModule:'C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/docx/dist/index.mjs',artifactModule:'C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs',codexExecutable:'C:/Users/31125/AppData/Local/OpenAI/Codex/bin/b6c7fc9497179c98/codex.exe',powershellExecutable:process.env.BX_POWERSHELL},scope:{original:18,variants:18,engines:['baseline','candidate'],totalRows:72,blockedCases:cases.filter(c=>c.expectedBlocked).map(c=>c.id),independentHumanGold:0},fairness:'Same original requests, source hashes, model, sampling and request budgets. Candidate adds native workspace tools; fixed source tasks remain data. Follow-up variants convert only a completed actual answer; failed bases are blocked dependencies, never exported error messages.'};
 if(!manifest.host.powershellExecutable)throw Error('Set BX_POWERSHELL to the actual host PowerShell executable');fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({out,cases:18,variants:18,blocked:manifest.scope.blockedCases,baselineRevision}));
}
