import {assertConversationAttachment} from '../documents/attachment-context.mjs';
import {deliveryArtifacts} from '../documents/delivery-settlement.mjs';

const time=x=>Date.parse(x.finishedAt||x.createdAt||x.startedAt||'')||0;
export function revisionJobs(store,cid){return (store.state.jobs||[]).filter(j=>j.conversationId===cid&&!['queued','running','cancelled','failed','interrupted'].includes(j.status)&&j.artifacts?.some(a=>/\.(xlsx|docx|pdf)$/i.test(a.name))).sort((a,b)=>time(a)-time(b));}
export function eligibleRevision(store,cid,job){
 if(!job||job.conversationId!==cid)return false;
 try{for(const f of job.dataScope||[])assertConversationAttachment(store,cid,f.id);return true;}catch{return false;}
}
export function revisionState(store,cid){
 const c=store.state.conversations.find(x=>x.id===cid);if(!c)throw Error('对话不存在');
 const jobs=revisionJobs(store,cid),preferred=jobs.find(j=>j.id===c.workContext?.selectedJobId),fallback=[...jobs].reverse().find(j=>eligibleRevision(store,cid,j));
 const active=c.attachmentContext?.activeFileIds,within=j=>eligibleRevision(store,cid,j)&&(!active?.length||(j.dataScope||[]).every(f=>active.includes(f.id)));
 const current=preferred&&within(preferred)?preferred:[...jobs].reverse().find(within);
 return {conversationId:cid,currentJobId:current?.id||null,selectedArtifactId:c.workContext?.selectedArtifactId||null,versions:jobs.map((j,i)=>({jobId:j.id,version:j.revisionNumber||i+1,title:j.title,createdAt:j.finishedAt||j.createdAt,operation:j.officeOperation||j.scenarioId,parentJobId:j.parentJobId||null,current:j.id===current?.id,selectable:eligibleRevision(store,cid,j)&&deliveryArtifacts(store,j).artifacts.some(a=>/\.(xlsx|docx|pdf)$/i.test(a.name)),sourceFileIds:(j.dataScope||[]).map(f=>f.id),requirements:j.requirementResults||[],factStatus:j.factStatus||'not_independently_verified',artifacts:deliveryArtifacts(store,j).artifacts.filter(a=>/\.(xlsx|docx|pdf)$/i.test(a.name))}))};
}
export function selectRevision(store,cid,jobId,artifactId){
 const c=store.state.conversations.find(x=>x.id===cid),j=revisionJobs(store,cid).find(j=>j.id===jobId);
 if(!c||!eligibleRevision(store,cid,j))throw Error('成果不属于当前对话或来源已排除、删除、不可访问');
 const files=deliveryArtifacts(store,j);if(files.issues.length)throw Error('成果文件已缺失或改变，不能将它设为当前版本');
 const artifact=artifactId?files.artifacts.find(a=>a.id===artifactId):files.artifacts.find(a=>/\.(xlsx|docx|pdf)$/i.test(a.name));
 if(!artifact)throw Error('所选成果不存在');
 c.workContext={...(c.workContext||{}),selectedJobId:j.id,selectedArtifactId:artifact.id,currentWorkItemId:j.workItemId||j.chatRunId,latestTaskId:j.id,selection:'explicit',updatedAt:new Date().toISOString()};
 c.attachmentContext={...(c.attachmentContext||{}),activeFileIds:(j.dataScope||[]).map(f=>f.id),updatedAt:new Date().toISOString()};store.save();return revisionState(store,cid);
}
export function advanceRevision(store,run,job,parent){
 const c=store.state.conversations.find(x=>x.id===run.conversationId);if(!c)return;
 job.parentJobId=parent?.id||null;job.revisionNumber=1+Math.max(0,...revisionJobs(store,run.conversationId).filter(j=>j.id!==job.id).map((j,i)=>j.revisionNumber||i+1));
 job.officeOperation=run.operation;job.requirementResults=run.requirementResults||[];job.factStatus=parent?.factStatus||'not_independently_verified';
 const a=job.artifacts.find(a=>/\.(xlsx|docx|pdf)$/i.test(a.name));
 if(a)c.workContext={...(c.workContext||{}),selectedJobId:job.id,selectedArtifactId:a.id,selection:'latest_delivery',latestTaskId:job.id,updatedAt:new Date().toISOString()};
}
