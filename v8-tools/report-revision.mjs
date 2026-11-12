import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:'REPORT_REVISION_INVALID'});};

// Apply edits against the immutable prior body, never against earlier edits.
// Whole-line patches preserve every unselected line and its line ending.
export function applyReportEdits(body,output){
 const data=JSON.parse(output.replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));
 if(!data||Object.keys(data).some(k=>k!=='edits')||!Array.isArray(data.edits))fail('局部修订必须返回edits数组，不能用重写全文替代。');
 const lines=[...body.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m=>m[0].length),used=new Set(),patches=[];
 for(const edit of data.edits){
  if(!edit||Object.keys(edit).some(k=>!['before','after','reason'].includes(k))||typeof edit.before!=='string'||!edit.before||typeof edit.after!=='string'||!edit.after||typeof edit.reason!=='string'||!edit.reason.trim()||/[\r\n]/u.test(edit.before+edit.after))fail('每项修改必须包含完整单行before、after及说明，不能删除整段正文。');
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
 const candidates=(bundle.artifacts||[]).filter(a=>ids?.includes(a.record.artifactId)&&a.record.kind==='text'&&/\.(?:md|txt)$/i.test(a.record.path));
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
