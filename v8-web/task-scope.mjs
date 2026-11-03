import {executionIntent} from '../v8-tools/execution-intent.mjs';
export function taskScope(workspace,c,request,body){
 const intent=executionIntent(request),files=c.files.filter(f=>workspace.available(c,f));
 if(body.clarification||!intent.onlyOrdinal&&!intent.excludedOrdinals.length)return {body,intent,changed:false};
 let chosen=intent.onlyOrdinal?[files[intent.onlyOrdinal-1]].filter(Boolean):files.filter((_,i)=>!intent.excludedOrdinals.includes(i+1));
 const question=intent.onlyOrdinal&&!chosen.length?{id:'scope-'+c.id+'-'+Date.now(),state:'pending',kind:'file_selection',question:'当前没有你指定序号的材料。请明确选择现有材料，或上传缺少的文件。',choices:files.map(f=>({id:f.ref.resourceId+':'+f.ref.revisionId,ref:f.ref,name:f.name,sha256:f.sha256,kind:'original',createdAt:workspace.space.check(c.workspaceId,f.ref).createdAt})),originalRequest:request}:null;
 return {intent,changed:true,question,body:{...body,fileIds:chosen.map(f=>f.id),useConversationFiles:false},resolution:{reason:'Explicit ordinal inclusion/exclusion from the user request',selectedFileIds:chosen.map(f=>f.id),selectedRefs:chosen.map(f=>f.ref),excludedFileIds:files.filter(f=>!chosen.includes(f)).map(f=>f.id)}};
}
