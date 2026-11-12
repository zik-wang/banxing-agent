import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomic} from './resource-space.mjs';
import {resolveSourceIds} from './source-ids.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,message,details)=>{throw Object.assign(Error(message),{code,details});};
export const contentAlternatives=['content','draft_ref','result_ids','table_ids','artifact_ids','statistics_ids'];
export function documentInput(schema){return {...schema,properties:{...schema.properties,content:{...schema.properties.content,minLength:1},draft_ref:{type:'string',minLength:1,maxLength:100}},oneOf:contentAlternatives.map(k=>({required:[k]}))};}
function validateDraft(record,id){
 if(!record||record.resultId!==id||record.method!=='submitted_draft'||typeof record.answer!=='string'||typeof record.title!=='string'||!Array.isArray(record.sourceRefs)||record.sourceRefs.some(s=>typeof s?.id!=='string'||typeof s?.sha256!=='string')||hash(record.answer)!==record.sha256||'draft:'+record.version!==id||hash(JSON.stringify({sha256:record.sha256,sources:record.sourceRefs}))!==record.version)fail('DRAFT_MISSING_OR_CHANGED','持久草稿的版本或正文校验失败；原文件保留，不自动覆盖。',{draft_ref:id});
 return record;
}
function readDraft(file,id){let record;try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e instanceof SyntaxError)fail('DRAFT_RECORD_INVALID','持久草稿JSON不完整；原文件保留。',{draft_ref:id});throw e;}return validateDraft(record,id);}
function sameDraft(a,b){return ['resultId','version','sha256','answer','title','createdAt'].every(k=>a[k]===b[k])&&JSON.stringify(a.sourceRefs)===JSON.stringify(b.sourceRefs);}
export function recoverPersistedDrafts(docs,previousDirectory){
 const root=fs.realpathSync(previousDirectory),folder=path.join(root,'drafts');if(!fs.existsSync(folder))return {recovered:[],uncommittedTemporaryFiles:[]};
 if(fs.realpathSync(folder)!==folder)fail('RECOVERY_PATH_ESCAPE','草稿目录不能跳转到原运行目录之外。');
 const names=fs.readdirSync(folder),recovered=[],uncommittedTemporaryFiles=names.filter(n=>n.endsWith('.tmp'));
 for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
  const file=path.join(folder,name),id='draft:'+name.slice(0,-5);if(fs.realpathSync(file)!==file)fail('RECOVERY_PATH_ESCAPE','草稿文件不能跳转到其他路径。');
  const record=readDraft(file,id),cached=docs.results.get(id);
  if(cached&&!sameDraft(validateDraft(cached,id),record))fail('DRAFT_MISSING_OR_CHANGED','草稿与已有检查点内容不一致，未覆盖任一版本。',{draft_ref:id});
  if(!cached)for(const source of record.sourceRefs)if(docs.asset(source.id).sha256!==source.sha256)fail('STALE_DRAFT_SOURCE','持久草稿的来源版本已变化。',{draft_ref:id});
  const targetFolder=path.join(docs.directory,'drafts');fs.mkdirSync(targetFolder,{recursive:true});const target=path.join(targetFolder,name);
  if(fs.existsSync(target)){if(!sameDraft(readDraft(target,id),record))fail('DRAFT_MISSING_OR_CHANGED','目标草稿版本冲突，未覆盖。',{draft_ref:id});}else fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);
  docs.results.set(id,record);recovered.push({draft_ref:id,sha256:record.sha256,restoredOutsideCheckpoint:!cached,contentVerified:false});
 }
 const receipt={recovered,uncommittedTemporaryFiles,scope:'same authorized prior run only; drafts are not verified deliveries; temporary files were not promoted'};
 if(recovered.length||uncommittedTemporaryFiles.length)fs.writeFileSync(path.join(docs.directory,'draft-recovery.json'),JSON.stringify(receipt,null,2));return receipt;
}
export function saveDraft(docs,{content,title='文稿',source_ids=[]}){
 if(typeof content!=='string'||!content.trim())fail('DOCUMENT_CONTENT_REQUIRED','source_ids只记录依据，不能替代正文',{missing_fields:['content_or_draft_ref'],retryable_without_change:false,next_action:'提交非空content，或引用已保存draft_ref'});
 const sources=resolveSourceIds(docs,source_ids);
 const sha256=hash(content),version=hash(JSON.stringify({sha256,sources})),id='draft:'+version;
 const existing=docs.results.get(id),folder=path.join(docs.directory,'drafts');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,version+'.json');
 let record=existing?validateDraft(existing,id):null;
 if(fs.existsSync(file)){const persisted=readDraft(file,id);if(record&&!sameDraft(record,persisted))fail('DRAFT_MISSING_OR_CHANGED','草稿文件与内存版本不一致，未覆盖。',{draft_ref:id});record=persisted;}
 record??={resultId:id,method:'submitted_draft',title,answer:content,sha256,version,sourceRefs:sources,status:'saved_unverified',createdAt:new Date().toISOString(),contentVerified:false};
 if(!fs.existsSync(file))atomic(file,record);
 docs.results.set(id,record);
 if(existing&&!docs.pendingDraftPersistence?.has(id))return record;
 try{docs.save();docs.continuity?.checkpoint();docs.pendingDraftPersistence?.delete(id);return record;}
 catch(error){(docs.pendingDraftPersistence??=new Set()).add(id);error.details={...error.details,draft_ref:id,locallySaved:true,persistencePending:true,checkpointPending:!!docs.continuity,next_action:'草稿正文已独立保存；解除写入阻断后可重试保存或从同一任务续跑，不需要重新生成正文。'};throw error;}
}
export function getDraft(docs,id){const r=docs.results.get(id);if(!r||r.method!=='submitted_draft'||hash(r.answer)!==r.sha256)fail('DRAFT_MISSING_OR_CHANGED','使用当前授权任务中已保存的draft_ref',{next_action:'重新提交文稿；不要用source_ids代替正文'});for(const source of r.sourceRefs)if(docs.asset(source.id).sha256!==source.sha256)fail('STALE_DRAFT_SOURCE','文稿来源版本已变化');return r;}
// Keeps complete receipts on disk. Historical payloads in the next model request are
// references, not another copy of every page. Recent receipts remain verbatim.
export function compactHistory(messages,directory,{seenThrough=messages.length,evidenceBudgetChars=0}={}){
 // Keep actual reader evidence available for synthesis across multiple sources.
 // Deduplicate identical text/ranges, not distinct clauses or source versions.
 const pinned=new Map(),identities=new Set();let evidenceChars=0;
 for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m.role!=='tool')continue;let r;try{r=JSON.parse(m.content);}catch{continue;}
  const d=r.data||{},text=typeof d.text==='string'?d.text:typeof d.quote==='string'?d.quote:null;
  if(r.status!=='ok'||!text||!(d.sourceId||d.assetId||d.artifactId)||r.contextReceipt)continue;
  const key=JSON.stringify([d.sourceId||d.assetId||d.artifactId,d.sourceSha256||d.sha256,d.start,d.end,d.pointer,hash(text)]);if(identities.has(key))continue;
  const data={...d};if(data.quote===data.text)delete data.quote;
  const content=JSON.stringify({...r,data});if(evidenceChars+content.length>evidenceBudgetChars)continue;
  identities.add(key);evidenceChars+=content.length;pinned.set(i,content);
 }
 let kept=0;const coverage=[];
 for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m.role!=='tool')continue;kept++;if(i>=seenThrough||kept<=2||m.content.length<2000)continue;
  let r;try{r=JSON.parse(m.content);}catch{continue;}if(r.contextReceipt)continue;
  const file=path.join(directory,'context-receipts',hash(m.content)+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,m.content);
  if(pinned.has(i)){coverage.push({callId:r.callId,file,characters:m.content.length,retainedEvidence:true});m.content=pinned.get(i);continue;}
  const d=r.data||{};const binding=d.sourceRange||d.binding||{};
  const summary={callId:r.callId,tool:r.tool,status:r.status,error:r.error,contextReceipt:{sha256:hash(m.content),characters:m.content.length},data:{sourceId:d.sourceId||binding.sourceId,sourceSha256:d.sourceSha256||binding.sourceSha256,resultId:d.resultId,artifactId:d.artifactId,tableId:d.tableId,draft_ref:d.draft_ref,pointer:d.pointer,nextOffset:d.nextOffset,next_cursor:d.next_cursor,totalChars:d.totalChars,totalItems:d.totalItems,coverage:d.coverage,sourceRange:binding.start!==undefined?{start:binding.start,end:binding.end}:undefined,items:d.items?.map(x=>({pointer:x.pointer,start:x.start,end:x.end})),note:'历史全文已保存。需要原文时按sourceId+pointer/range或resultId取回；这不是语义完整性证明。'}};
  if(r.tool==='discover_tools')summary.data.tools=d.tools;
  if(r.tool==='search_knowledge')Object.assign(summary.data,{query:d.query,totalMatches:d.totalMatches,offset:d.offset,limit:d.limit,returnedMatches:d.matches?.length,note:d.resultId?'原句已按resultId保存，可直接export_document result_ids导出；压缩后没有matches不代表未取得原句。仍需按nextOffset取回后续页。':'旧检索回执没有保存resultId；需重新检索，不能把明细压缩解释为无命中。'});
  coverage.push({callId:r.callId,file,characters:m.content.length});m.content=JSON.stringify(summary);
 }
 if(coverage.length)fs.appendFileSync(path.join(directory,'context-compaction.jsonl'),JSON.stringify({at:new Date().toISOString(),coverage})+'\n');
}
