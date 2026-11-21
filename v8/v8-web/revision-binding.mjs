import {executionIntent} from '../v8-tools/execution-intent.mjs';

// Auto-checked, unchanged source files are supporting evidence for a revision,
// not an instruction to discard the selected work product.
export function revisionBinding(workspace,conversation,request,fileIds,{scopeChanged=false,clarification=false}={}){
 const current=workspace.space.work(conversation.workspaceId,conversation.workItemId).current;
 if(!current||scopeChanged||clarification)return {current:null,reason:'no_current_or_explicit_scope_change'};
 const intent=executionIntent(request);
 if(!fileIds.length||intent.operation==='retrieve')return {current,reason:'existing_result_selection'};
 if(!['modify','convert'].includes(intent.operation))return {current:null,reason:'new_task_with_files'};
 if(!conversation.turns.some(t=>t.resultRef?.resourceId===current.resourceId&&t.resultRef?.revisionId===current.revisionId))return {current:null,reason:'result_not_in_conversation'};
 const index=workspace.space.load(),originals=new Set(),seen=new Set();
 const key=r=>r.resourceId+':'+r.revisionId;
 const visit=ref=>{if(seen.has(key(ref)))return;seen.add(key(ref));const value=workspace.space.check(conversation.workspaceId,ref,new Set(),index),resource=index.resources[ref.resourceId];if(resource.kind==='original')originals.add(key(ref));for(const parent of value.parents||[])visit(parent);};
 visit(current);
 const selected=fileIds.map(id=>conversation.files.find(f=>f.id===id&&!f.removed&&workspace.available(conversation,f)));
 const exact=new Set(selected.filter(Boolean).map(f=>key(f.ref)));
 const unchanged=selected.every(Boolean)&&originals.size>0&&exact.size===originals.size&&[...originals].every(k=>exact.has(k));
 return {current:unchanged?current:null,reason:unchanged?'revision_with_unchanged_sources':'source_selection_changed'};
}
