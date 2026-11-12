import {createHash} from 'node:crypto';
import {getDraft} from './draft-delivery.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:'REPORT_REVISION_INVALID'});};

function selectedWordDraft(docs,artifact){
 // Result bundles intentionally omit raw drafts. Recover only the exact draft
 // from the selected result's direct, authorized checkpoint, not a global latest run.
 if(!docs.results.has(artifact.draftRef)){
  const c=docs.continuity,version=c.allowed(c.result);
  const matches=[];
  for(const ref of version?.parents||[]){
   const parent=c.allowed(ref);if(!parent.metadata?.bundle)continue;
   const checkpoint=JSON.parse(c.space.read(c.projectId,ref));
   if(checkpoint.schemaVersion!==1||!checkpoint.artifacts?.some(a=>a.record.artifactId===artifact.artifactId&&a.record.sha256===artifact.sha256&&a.record.draftRef===artifact.draftRef))continue;
   for(const r of checkpoint.results||[])if(r.resultId===artifact.draftRef)matches.push(r);
  }
  if(matches.length!==1)fail('当前Word的原始草稿无法唯一恢复；未改用其他版本。');
  const r=matches[0];
  if(r.method!=='submitted_draft'||typeof r.answer!=='string'||!Array.isArray(r.sourceRefs)||hash(r.answer)!==r.sha256||'draft:'+r.version!==r.resultId||hash(JSON.stringify({sha256:r.sha256,sources:r.sourceRefs}))!==r.version)fail('Word原始草稿的正文或版本校验失败。');
  for(const source of r.sourceRefs)if(docs.asset(source.id).sha256!==source.sha256)fail('Word草稿来源版本已变化。');
  docs.results.set(r.resultId,r);
 }
 return getDraft(docs,artifact.draftRef);
}

// Apply edits against the immutable prior body, never against earlier edits.
// Whole-line patches preserve every unselected line and its line ending.
export function applyReportEdits(body,output){
 const data=JSON.parse(output.replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));
 if(!data||Object.keys(data).some(k=>k!=='edits')||!Array.isArray(data.edits))fail('局部修订必须返回edits数组，不能用重写全文替代。');
 const lines=[...body.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m=>m[0].length),used=new Set(),patches=[];
 for(const edit of data.edits){
  if(!edit||Object.keys(edit).some(k=>!['before','after','reason'].includes(k))||typeof edit.before!=='string'||!edit.before||typeof edit.after!=='string'||!edit.after.trim()||typeof edit.reason!=='string'||!edit.reason.trim()||/[\r\n]/u.test(edit.before))fail('每项修改必须包含完整单行before、非空after及说明，不能删除整段正文。');
  if(/^\s*\|.*\|\s*$/u.test(edit.before)&&/[\r\n]/u.test(edit.after))fail('表格行修改须保持单行，不能把一个表格记录拆成多条。');
  const matches=lines.filter(m=>m[0].replace(/[\r\n]+$/u,'')===edit.before);
  if(matches.length!==1||used.has(matches[0]?.index))fail('修改位置不唯一或重复；原稿保留。');
  const start=matches[0].index;used.add(start);patches.push({...edit,start,end:start+edit.before.length});
 }
 let revised=body;for(const p of [...patches].sort((a,b)=>b.start-a.start))revised=revised.slice(0,p.start)+p.after+revised.slice(p.end);
 return {body:revised,receipt:{baseSha256:hash(body),revisedSha256:hash(revised),edits:patches,unchangedSpansPreserved:true,semanticVerified:false}};
}

export async function readRevisionBase(docs,config,call){
 const continuity=docs.continuity;
 if(!continuity?.result)return null;
 continuity.allowed(continuity.result);
 const bundle=JSON.parse(continuity.space.read(continuity.projectId,continuity.result));
 const ids=config.revisionArtifactIds;
 // The host identifies outputs of the selected turn, not a workspace-wide latest file.
 const selected=(bundle.artifacts||[]).filter(a=>ids?.includes(a.record.artifactId));
 const candidates=selected.filter(a=>a.record.kind==='text'&&/\.(?:md|txt)$/i.test(a.record.path));
 if(!candidates.length){
  const words=selected.filter(a=>a.record.kind==='docx');
  if(words.length!==1)return null;
  const a=words[0].record;
  // Only our source-bound prose export is reversible here. Imported Word,
  // independent table attachments and ambiguous outputs use the normal tools.
  if(!a.draftRef||!a.wordSource||a.wordSource.tables?.length||typeof a.title!=='string'||/[\r\n]/u.test(a.title))return null;
  const draft=selectedWordDraft(docs,a);
  if(draft.version!==a.draftVersion||draft.title!==a.title||draft.answer!==a.wordSource.text)fail('Word与保存草稿的版本不一致；不能用另一份草稿替代。');
  const receipt=await call('validate_artifact',{artifact_id:a.artifactId});
  if(receipt.artifactId!==a.artifactId||receipt.sha256!==a.sha256||receipt.exportIntegrityPassed!==true)fail('当前Word文件回读或SHA256校验失败，原件保留。');
  const text='# '+a.title+'\n\n'+draft.answer;
  return {text,artifactId:a.artifactId,sha256:a.sha256,bodySha256:hash(text),draftRef:draft.resultId,resultRef:continuity.result,representation:'validated_word_source_draft'};
 }
 if(candidates.length!==1)return null;
 const a=candidates[0].record;let offset=0,text='',total=null;
 for(;;){const r=await call('read_artifact',{artifact_id:a.artifactId,offset});
  if(typeof r.text!=='string'||!Number.isInteger(r.totalChars)||total!==null&&total!==r.totalChars)fail('原成果读取回执不完整或版本变化。');
  total=r.totalChars;text+=r.text;
  if(r.nextOffset==null)break;
  if(r.nextOffset<=offset||r.nextOffset!==text.length)fail('原成果分页游标异常。');offset=r.nextOffset;
 }
 if(text.length!==total||hash(text)!==a.sha256)fail('原成果正文不完整或SHA256不匹配，不能重写替代。');
 return {text,artifactId:a.artifactId,sha256:a.sha256,resultRef:continuity.result};
}
