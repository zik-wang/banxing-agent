import {assertConversationAttachment} from './attachment-context.mjs';
export function mediaReadSession(store,run){
 const results=new Map();
 return {attemptedCount:name=>[...results.keys()].filter(k=>k.startsWith(name+':')).length,async execute(name,args,action){
  if(!['ocr_document','read_with_vision'].includes(name))return action();
  const f=store.state.workspaceFiles.find(f=>f.id===args.file_id),source=run.sourceFiles?.find(f=>f.id===args.file_id);
  if(!f||!source||source.sha256!==f.sha256)throw Error('识别来源不属于本轮授权附件');
  if(run.attachmentResolution)assertConversationAttachment(store,run.conversationId,f.id);
  const key=name+':'+f.id;if(results.has(key))return {...results.get(key),cached:true,message:'本轮已取得此识别回执，请复用；受限回执不能当成识别成功，也不要反复调用。'};
  let result;try{result=await action();}catch(e){result={status:'blocked',fileId:f.id,name:f.name,reason:e.message,doNotRetryThisRun:true,fullDocumentVerified:false,fallback:f.parseStatus==='ready'?{tool:'read_attachment_text',file_id:f.id,offset:0,truncated:!!f.truncated}:null,message:'本轮此识别已失败，不要重复调用。可在明确说明限制后使用可读文字层完成有限任务；无可用文字则保留未处理范围。'};run.materialIssues||=[];run.materialIssues.push({fileId:f.id,name:f.name,reader:name,reason:e.message,fullDocumentVerified:false});}
  results.set(key,result);return result;
 }};
}
