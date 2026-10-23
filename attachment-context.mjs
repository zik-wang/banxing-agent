import {revisionRequest} from './delivery-settlement.mjs';
import {readOriginal,digest} from './workspace-files.mjs';

export const ATTACHMENT_CONTEXT_VERSION='p4.1-attachment-context-1';
const stamp=()=>new Date().toISOString();
const snapshot=f=>({id:f.id,name:f.name,sha256:f.sha256});
function conversation(store,id){const c=store.state.conversations?.find(c=>c.id===id);if(!c)throw Error('对话已不存在，不能读取附件');return c;}
function rows(store,id){return (store.state.conversationAttachments||[]).filter(r=>r.conversationId===id);}
function fileRecord(store,id){return store.state.workspaceFiles?.find(f=>f.id===id&&!f.deletedAt&&!f.deleted);}

// Import historical references once without resurrecting an excluded/deleted reference.
export function migrateAttachmentReferences(store,conversationId){
 const c=conversation(store,conversationId);store.state.conversationAttachments||=[];let changed=false;
 const add=(source,origin,sourceId)=>{if(!source?.id||rows(store,conversationId).some(r=>r.fileId===source.id))return;store.state.conversationAttachments.push({conversationId,fileId:source.id,sha256:source.sha256,name:source.name,status:'active',origin,sourceId,createdAt:stamp(),updatedAt:stamp()});changed=true;};
 for(const r of store.state.runs||[])if(r.conversationId===conversationId)for(const f of r.sourceFiles||[])add(f,'history_run',r.id);
 for(const j of [...(store.state.jobs||[])].reverse())if(j.conversationId===conversationId)for(const f of j.dataScope||[])add(f,'history_job',j.id);
 if(!c.attachmentContext){const prior=[...(store.state.runs||[])].reverse().find(r=>r.conversationId===conversationId&&r.sourceFiles?.length&&r.status!=='running');c.attachmentContext={version:ATTACHMENT_CONTEXT_VERSION,activeFileIds:prior?.sourceFiles.map(f=>f.id)||[],updatedAt:stamp()};changed=true;}
 if(changed)store.save();return c;
}

export function bindConversationFiles(store,conversationId,files,origin='upload'){
 migrateAttachmentReferences(store,conversationId);
 for(const f of files){const foreign=(store.state.conversationAttachments||[]).some(r=>r.fileId===f.id&&r.conversationId!==conversationId)||(store.state.runs||[]).some(r=>r.conversationId!==conversationId&&r.sourceFiles?.some(s=>s.id===f.id))||(store.state.jobs||[]).some(j=>j.conversationId&&j.conversationId!==conversationId&&j.dataScope?.some(s=>s.id===f.id));if(foreign&&!rows(store,conversationId).some(r=>r.fileId===f.id))throw Error('不能跨独立对话继承附件，请在当前对话上传原件');const existing=rows(store,conversationId).find(r=>r.fileId===f.id);if(existing){if(existing.status!=='active')throw Error('附件已从本对话移除，请明确恢复后使用');if(existing.sha256!==f.sha256)throw Error('附件版本已变化，请重新上传');continue;}store.state.conversationAttachments.push({conversationId,fileId:f.id,sha256:f.sha256,name:f.name,status:'active',origin,createdAt:stamp(),updatedAt:stamp()});}
 store.save();return files;
}

export function assertConversationAttachment(store,conversationId,fileId){
 const ref=rows(store,conversationId).find(r=>r.fileId===fileId),f=fileRecord(store,fileId);
 if(!ref||ref.status!=='active')throw Error('附件不在当前对话可用范围内，或已被排除/删除');
 if(!f||f.readable===false||f.accessRevokedAt)throw Error('附件不存在或读取权限已撤销');
 if(f.conversationId&&f.conversationId!==conversationId)throw Error('附件属于其他对话');
 if(f.sha256!==ref.sha256)throw Error('附件版本已变化，请重新上传');
 readOriginal(store,f);return f;
}

export function setConversationAttachment(store,conversationId,fileId,status){
 const c=migrateAttachmentReferences(store,conversationId),ref=rows(store,conversationId).find(r=>r.fileId===fileId);if(!ref)throw Error('附件不属于当前对话');
 if(!['active','excluded','deleted'].includes(status))throw Error('附件引用状态无效');
 if(status==='active'){const f=fileRecord(store,fileId);if(!f||f.sha256!==ref.sha256)throw Error('原件已不存在或版本变化，不能恢复');readOriginal(store,f);}
 ref.status=status;ref.updatedAt=stamp();if(status!=='active')c.attachmentContext.activeFileIds=c.attachmentContext.activeFileIds.filter(id=>id!==fileId);store.save();return {fileId,status,originalPreserved:true};
}

export function conversationAttachmentState(store,conversationId){migrateAttachmentReferences(store,conversationId);return {version:ATTACHMENT_CONTEXT_VERSION,conversationId,files:rows(store,conversationId).map(r=>({fileId:r.fileId,name:r.name,sha256:r.sha256,status:r.status,origin:r.origin,available:!!fileRecord(store,r.fileId)}))};}

function ids(value,label){if(!Array.isArray(value)||value.length>20||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)throw Error(label+'须为最多20个不同文件ID');return value;}
const referenceRequest=s=>/(?:做成|整理成|生成|导出|转成)\s*(?:excel|excal|xlsx|word|docx|pdf)|转\s*(?:word|docx|pdf)|弄成|第[一二12]个|第[一二12]份|刚才|刚刚|上[一轮次个份]|之前|继续|接着|重试|重新|再分析|这些|这[份个两几]|那[份个]|附件|文件|材料|原文|报告|汇报|改成|改为|调整|补充|对比|比较|归档|台账|总结/i.test(s);
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function resolveAttachmentContext(store,{conversationId,request='',fileIds=[],intentContextRunId,excludedFileIds=[],attachmentInheritance='auto'}){
 const c=migrateAttachmentReferences(store,conversationId);ids(fileIds,'附件列表');ids(excludedFileIds,'排除列表');if(!['auto','none','all'].includes(attachmentInheritance))throw Error('附件继承方式无效');
 let references=rows(store,conversationId);const ordinal=/(?:第([一二12])(?:个|份)(?:文件)?)/.exec(request);const ordinalIndex=ordinal?({'一':0,'1':0,'二':1,'2':1}[ordinal[1]]):null;const ordinalRef=ordinalIndex!==null?references.filter(r=>r.status==='active')[ordinalIndex]:null;if(ordinalRef&&/不要用|不再用|排除|不用/.test(request)){setConversationAttachment(store,conversationId,ordinalRef.fileId,'excluded');}const mentioned=references.filter(r=>r.name&&request.includes(r.name)),negative=mentioned.filter(r=>new RegExp('(?:不要(?:使用|用|分析|引用)?|排除|忽略|移除|删除|删掉|不再(?:使用|用))\\s*(?:附件|文件)?[“"「『\\s]*'+escapeRegex(r.name)).test(request));
 for(const fileId of [...new Set([...excludedFileIds,...negative.map(r=>r.fileId)])])setConversationAttachment(store,conversationId,fileId,'excluded');
 let reason='no_attachment_needed',requested=[],previous=null;
 if(intentContextRunId){previous=store.state.runs.find(r=>r.id===intentContextRunId&&r.conversationId===conversationId&&r.status!=='running'&&r.sourceFiles?.length);if(!previous)throw Error('待补充的分析不属于当前对话或尚未结束');if(fileIds.length)throw Error('补充分析时请先结束旧附件上下文再添加新附件');requested=previous.sourceFiles.map(f=>f.id);reason='explicit_run_reference';}
 else if(fileIds.length){for(const fileId of fileIds){const f=fileRecord(store,fileId);if(!f)throw Error('所选附件不存在或已删除');bindConversationFiles(store,conversationId,[f],'explicit_selection');}requested=[...fileIds];reason='explicit_selection';}
 references=rows(store,conversationId);const active=references.filter(r=>r.status==='active'),named=mentioned.filter(r=>r.status==='active'),oldActive=(c.attachmentContext.activeFileIds||[]).filter(id=>active.some(r=>r.fileId===id)),useContext=(referenceRequest(request)||revisionRequest(request))&&references.length>0;
 if(ordinalRef&&ordinalRef.status==='active'&&!fileIds.length&&!previous){requested=[ordinalRef.fileId];reason='ordinal_reference';}
 const combine=/结合|加上|一起|同时|对照|比较|对比|合并/.test(request)&&/刚才|之前|原[来有]|上[一轮次份]|历史/.test(request);
 if(fileIds.length&&combine){requested=[...new Set([...oldActive,...requested])];reason='explicit_plus_previous';}
 else if(!fileIds.length&&!previous&&ordinalRef?.status==='active'){requested=[ordinalRef.fileId];reason='ordinal_reference';}
 else if(!fileIds.length&&!previous&&named.length){requested=named.map(r=>r.fileId);reason='named_reference';}
 else if(!fileIds.length&&!previous&&(attachmentInheritance==='all'||(/全部|所有|两份|两[个份]|这[两几]份/.test(request)&&referenceRequest(request)))){requested=active.map(r=>r.fileId);reason='all_conversation_files';}
 else if(!requested.length&&!previous&&attachmentInheritance==='auto'&&useContext){requested=oldActive.length?oldActive:active.length===1?[active[0].fileId]:[];reason=requested.length?(revisionRequest(request)?'followup_revision':'active_context'):'ambiguous_or_missing_context';}
 if(attachmentInheritance==='none'||/不要(?:使用|用|引用)(?:任何|这些|所有)?附件|不(?:用|使用)附件/.test(request)){requested=[];reason='explicit_no_inheritance';}
 const singularAmbiguous=!fileIds.length&&!previous&&!named.length&&requested.length>1&&/那个文件|这个文件|那一份|其中一份|其中一个|某个文件/.test(request);if(singularAmbiguous){requested=[];reason='ambiguous_or_missing_context';}
 const unavailable=[],files=[];
 for(const fileId of [...new Set(requested)]){try{files.push(assertConversationAttachment(store,conversationId,fileId));}catch(error){unavailable.push({fileId,reason:error.message});}}
 const invalidNamed=mentioned.filter(r=>r.status!=='active'&&!negative.includes(r));for(const r of invalidNamed)unavailable.push({fileId:r.fileId,reason:'该附件已从本对话排除或删除，请先明确恢复'});
 const blocked=unavailable.length>0||requested.length>20;
 const needsSelection=blocked||(reason==='ambiguous_or_missing_context'&&useContext);
 const resolvedFileIds=blocked?[]:files.map(f=>f.id),sourceRefs=blocked?[]:files.map(f=>{const ref=references.find(r=>r.fileId===f.id)||rows(store,conversationId).find(r=>r.fileId===f.id);return{fileId:f.id,sha256:f.sha256,origin:reason,referenceOrigin:ref?.origin,sourceId:ref?.sourceId||null,parsedTextSha256:typeof f.content==='string'?digest(Buffer.from(f.content)):null,parseStatus:f.parseStatus,reusedParsedContent:true};});
 const result={version:ATTACHMENT_CONTEXT_VERSION,conversationId,status:needsSelection?'needs_selection':'ready',resolvedFileIds,reason,sources:sourceRefs,excludedFileIds:rows(store,conversationId).filter(r=>r.status!=='active').map(r=>r.fileId),unavailable,availableFiles:active.map(r=>({id:r.fileId,name:r.name})),selectedFromRunId:c.attachmentContext.lastRunId||[...(store.state.runs||[])].reverse().find(r=>r.conversationId===conversationId&&r.sourceFiles?.length)?.id||null,relatedJobIds:(store.state.jobs||[]).filter(j=>j.conversationId===conversationId&&resolvedFileIds.length&&j.dataScope?.length===resolvedFileIds.length&&j.dataScope.every(f=>sourceRefs.some(s=>s.fileId===f.id&&s.sha256===f.sha256))).map(j=>j.id),resolvedAt:stamp()};
 if(!needsSelection&&resolvedFileIds.length){c.attachmentContext={version:ATTACHMENT_CONTEXT_VERSION,activeFileIds:resolvedFileIds,updatedAt:stamp()};store.save();}
 return {resolution:result,files:needsSelection?[]:files,previous};
}

export function resolvedRunSources(store,run){return (run.resolvedFileIds||[]).map(id=>{const f=assertConversationAttachment(store,run.conversationId,id),ref=run.sourceFiles?.find(s=>s.id===id);if(!ref||ref.sha256!==f.sha256)throw Error('本轮附件快照已变化');return snapshot(f);});}

export function taskAttachmentResolution(run,files,reason='workspace_explicit_selection'){
 const resolvedFileIds=files.map(f=>f.id);return {...(run?.attachmentResolution||{version:ATTACHMENT_CONTEXT_VERSION,reason,resolvedAt:stamp()}),resolvedFileIds,sources:files.map(f=>({...run?.attachmentResolution?.sources?.find(s=>s.fileId===f.id),fileId:f.id,sha256:f.sha256,origin:run?.attachmentResolution?.reason||reason})),taskSelectionReason:reason};
}
