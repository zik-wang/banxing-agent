import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,message,details)=>{throw Object.assign(Error(message),{code,details});};
export const contentAlternatives=['content','draft_ref','result_ids','table_ids','artifact_ids','statistics_ids'];
export function documentInput(schema){return {...schema,properties:{...schema.properties,content:{...schema.properties.content,minLength:1},draft_ref:{type:'string',minLength:1,maxLength:100}},oneOf:contentAlternatives.map(k=>({required:[k]}))};}
export function saveDraft(docs,{content,title='文稿',source_ids=[]}){
 if(typeof content!=='string'||!content.trim())fail('DOCUMENT_CONTENT_REQUIRED','source_ids只记录依据，不能替代正文',{missing_fields:['content_or_draft_ref'],retryable_without_change:false,next_action:'提交非空content，或引用已保存draft_ref'});
 const sources=source_ids.map(id=>{const a=docs.asset(id);return {id,sha256:a.sha256};});
 const sha256=hash(content),version=hash(JSON.stringify({sha256,sources})),id='draft:'+version;
 const existing=docs.results.get(id);if(existing)return existing;
 const record={resultId:id,method:'submitted_draft',title,answer:content,sha256,version,sourceRefs:sources,status:'saved_unverified',createdAt:new Date().toISOString(),contentVerified:false};
 const folder=path.join(docs.directory,'drafts');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,version+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record));fs.renameSync(tmp,file);
 docs.results.set(id,record);docs.save();docs.continuity?.checkpoint();return record;
}
export function getDraft(docs,id){const r=docs.results.get(id);if(!r||r.method!=='submitted_draft'||hash(r.answer)!==r.sha256)fail('DRAFT_MISSING_OR_CHANGED','使用当前授权任务中已保存的draft_ref',{next_action:'重新提交文稿；不要用source_ids代替正文'});for(const source of r.sourceRefs)if(docs.asset(source.id).sha256!==source.sha256)fail('STALE_DRAFT_SOURCE','文稿来源版本已变化');return r;}
// Keeps complete receipts on disk. Historical payloads in the next model request are
// references, not another copy of every page. Recent receipts remain verbatim.
export function compactHistory(messages,directory,{seenThrough=messages.length,receiptReader,maxRetainedChars=48000}={}){
 const indices=messages.flatMap((m,i)=>m.role==='tool'?[i]:[]),recent=new Set(indices.slice(-2)),coverage=[];
 let retained=indices.reduce((n,i)=>n+messages[i].content.length,0);
 for(const i of indices){if(retained<=maxRetainedChars)break;const m=messages[i];if(i>=seenThrough||recent.has(i)||m.content.length<2000)continue;
  let r;try{r=JSON.parse(m.content);}catch{continue;}if(r.contextReceipt)continue;
  const file=path.join(directory,'context-receipts',hash(m.content)+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,m.content);
  const d=r.data||{};const binding=d.sourceRange||d.binding||{};
  const summary={callId:r.callId,tool:r.tool,status:r.status,error:r.error,contextReceipt:{sha256:hash(m.content),characters:m.content.length},data:{sourceId:d.sourceId||binding.sourceId,sourceSha256:d.sourceSha256||binding.sourceSha256,resultId:d.resultId,artifactId:d.artifactId,tableId:d.tableId,draft_ref:d.draft_ref,pointer:d.pointer,nextOffset:d.nextOffset,next_cursor:d.next_cursor,totalChars:d.totalChars,totalItems:d.totalItems,coverage:d.coverage,sourceRange:binding.start!==undefined?{start:binding.start,end:binding.end}:undefined,items:d.items?.map(x=>({pointer:x.pointer,start:x.start,end:x.end})),note:'历史全文已保存。需要原文时按sourceId+pointer/range或resultId取回；这不是语义完整性证明。'}};
  if(receiptReader&&r.callId)summary.contextReceipt.retrieve={tool:receiptReader,arguments:r.tool==='read_tool_receipt'&&d.historicalReceipt?{call_id:d.callId,pointer:d.pointer,offset:d.start,length:Math.min(12000,d.end-d.start)}:{call_id:r.callId,...(typeof d.text==='string'?{pointer:'/data/text'}:{})}};
  if(r.tool==='discover_tools')summary.data.tools=d.tools;
  const encoded=JSON.stringify(summary);if(encoded.length>=m.content.length)continue;
  coverage.push({callId:r.callId,file,characters:m.content.length});retained-=m.content.length-encoded.length;m.content=encoded;
 }
 if(coverage.length)fs.appendFileSync(path.join(directory,'context-compaction.jsonl'),JSON.stringify({at:new Date().toISOString(),coverage})+'\n');
}
