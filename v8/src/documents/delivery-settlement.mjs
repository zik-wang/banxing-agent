import {resolveArtifact} from './artifacts.mjs';
import {prepareDelivery,validateDelivery,requestedFormats,FILE_FORMATS} from './file-delivery.mjs';
export const revisionRequest=s=>/还不够|不完整|遗漏|漏了|加上|新增|增加|补上|补齐|补充|修改|更正|改一下|改一改|再加|再改/.test(s||'');

export function exportFormats(store,run,proposed){
 const explicit=requestedFormats(run.request);
 if(explicit.length)return explicit;
 if(revisionRequest(run.request)){const prior=store.state.jobs.find(j=>j.conversationId===run.conversationId&&j.chatRunId!==run.id&&j.options?.outputFormats?.length&&j.dataScope?.length&&j.dataScope.every(f=>run.resolvedFileIds?.includes(f.id)));if(prior)return prior.options.outputFormats.filter(f=>FILE_FORMATS.includes(f));}
 return proposed;
}
const checkFor=(job,a)=>a.kind==='presentation'||/\.(md|txt|csv|json)$/i.test(a.name)||(a.name.endsWith('.docx')&&job.checks?.some(c=>c.passed&&c.label==='报告文件回读通过；不等于事实正确性'))||job.checks?.some(c=>c.passed&&c.verified&&a.name.toLowerCase().endsWith('.'+c.format));
export function deliveryArtifacts(store,job){
 const artifacts=[],issues=[];
 for(const a of job.artifacts||[]){if(a.kind==='audit')continue;try{const {bytes}=resolveArtifact(store,job.id,a.id);if(bytes.length!==a.bytes)throw Error('文件大小与登记不符');if(job.scenarioId==='export'&&!checkFor(job,a))throw Error('文件没有成功回读记录');if(a.kind==='presentation'&&!bytes.toString('utf8').includes('</html>'))throw Error('HTML文件不完整');artifacts.push({...a,downloadUrl:'/api/jobs/'+job.id+'/artifacts/'+a.id+'?conversationId='+encodeURIComponent(job.conversationId||'')});}catch(e){issues.push({artifactId:a.id,name:a.name,reason:e.message});}}
 return {artifacts,issues};
}
export function exportJobs(store,run){return (store.state.jobs||[]).filter(j=>j.chatRunId===run.id&&j.conversationId===run.conversationId&&j.scenarioId==='export');}
export function deliveryRunView(store,run){
 if(run.status==='running')return run;
 const jobs=exportJobs(store,run);if(!jobs.length)return run;
 const checked=jobs.map(j=>({job:j,...deliveryArtifacts(store,j)})),documents=checked.flatMap(x=>x.artifacts).filter(a=>FILE_FORMATS.some(f=>a.name.endsWith('.'+f))),issues=checked.flatMap(x=>x.issues);
 if(issues.length){return {...run,deliveryState:documents.length?'partially_delivered':'failed',answer:documents.length?'部分文件仍可下载，其余已登记文件校验失败，请查看交付卡片。':'已登记的导出文件目前校验失败，没有可下载的已验证办公文件。',deliveryViewDerived:true};}
 if(run.status==='failed'&&documents.length)return {...run,deliveryState:'partially_delivered',answer:run.answer||'这轮运行未完全完成，但已验证的文件仍可下载：'+documents.map(a=>a.name).join('、')+'。旧结果重导出不代表新增要求已经完成，请核对交付范围。',deliveryViewDerived:true};
 return run;
}
export async function settleDelivery(store,run,{interrupted=null}={}){
 const jobs=exportJobs(store,run);if(!jobs.length||jobs.some(j=>['running','queued'].includes(j.status)))return null;
 const artifacts=[],issues=[];
 for(const j of jobs){const checked=deliveryArtifacts(store,j);issues.push(...checked.issues);for(const a of checked.artifacts){try{const {bytes}=resolveArtifact(store,j.id,a.id),format=a.name.split('.').at(-1).toLowerCase();if(FILE_FORMATS.includes(format))await validateDelivery(format,bytes,prepareDelivery(j.exportSource));artifacts.push({jobId:j.id,...a,readbackVerified:true});}catch(e){issues.push({artifactId:a.id,name:a.name,reason:e.message});}}
  issues.push(...(j.warnings||[]).map(reason=>({jobId:j.id,reason})));if(j.status==='failed')issues.push({jobId:j.id,reason:j.error||'导出失败'});
 }
 const desired=jobs.flatMap(j=>j.options?.outputFormats||[]),delivered=new Set(artifacts.map(a=>a.name.split('.').at(-1).toLowerCase())),missing=[...new Set(desired)].filter(f=>!delivered.has(f));
 if(missing.length)issues.push({reason:'未交付所需格式：'+missing.join('、')});
 if(run.trace?.some(t=>t.type==='tool_status'&&t.detail?.startsWith('failed')))issues.push({reason:'本轮仍有工具执行失败，不能把文件生成等同整个目标完成'});
 if(run.requirementResults?.length){for(const r of run.requirementResults.filter(r=>r.state!=='applied'))issues.push({reason:r.detail,requirementId:r.id});}else if(jobs.some(j=>j.dataScope?.length))issues.push({reason:'文件已回读；材料事实和本轮新增要求未经过独立完整性核验'});
 if(interrupted)issues.push({reason:interrupted});
 const documents=artifacts.filter(a=>FILE_FORMATS.some(f=>a.name.toLowerCase().endsWith('.'+f))),state=documents.length?(issues.length?'partially_delivered':'fully_completed'):(interrupted?'interrupted':'failed');
 const result={version:'p4.2-delivery-1',state,artifacts,issues,missingFormats:missing,verifiedAt:new Date().toISOString(),requirements:run.requirementResults||[],factStatus:'not_independently_verified',verificationScope:'artifact_identity_readback_and_requested_formats; not semantic correctness'};
 run.delivery=result;run.deliveryState=state;
 for(const j of jobs){j.deliveryVerification={state,artifacts:artifacts.filter(a=>a.jobId===j.id),issues};if(j.status==='completed'&&state!=='fully_completed')j.status=documents.length?'partial':'failed';}
 store.save();
 if(!documents.length)return {answer:'没有可以交付的已验证文件。'+issues.map(i=>i.reason).join('；'),delivery:result,terminal:true};
 const names=documents.map(a=>a.name).join('、');return {answer:'已生成并回读验证：'+names+'。下载入口在下方。原材料中的待核事实保持待核。'+(issues.length?'本次为部分交付（部分格式已交付或要求待核）：'+issues.map(i=>i.reason).join('；')+'。':''),delivery:result,terminal:true};
}

export function deliveryJobView(store,job){
 if(job.scenarioId!=='export')return job;const c=deliveryArtifacts(store,job);if(!c.issues.length)return job;return {...job,status:c.artifacts.some(a=>FILE_FORMATS.some(f=>a.name.endsWith('.'+f)))?'partial':'failed',summary:'已登记的交付文件校验失败，请查看仍可用文件与失败原因。',artifacts:c.artifacts,warnings:[...(job.warnings||[]),...c.issues.map(i=>i.name+'：'+i.reason)]};
}
