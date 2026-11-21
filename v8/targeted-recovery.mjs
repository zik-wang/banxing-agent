import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
export const SUPPLEMENT_PROTOCOL='v7-p2-targeted-supplement-1';

// Only split explicit starred/# numbered table rows, preserving exact source
// offsets. This does not infer header meaning, polarity or semantic completeness.
export function splitNumberedRequirements(unit){
 const matches=[...unit.text.matchAll(/(?:^|\n)(\d{1,4})\s+(?:★|#)\s+/g)];
 if(matches.length<2)return [{...unit,parentUnitId:unit.id,parentStart:0,parentEnd:unit.text.length}];
 const ids=matches.map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('表格行号重复，禁止猜测对齐');
 return matches.map((m,i)=>{const start=m.index+(m[0].startsWith('\n')?1:0),end=i+1<matches.length?matches[i+1].index:unit.text.length;return {...unit,id:unit.id+':R'+m[1],parentUnitId:unit.id,parentStart:start,parentEnd:end,text:unit.text.slice(start,end)};});
}

export function validateSupplement(raw,targets,context=[]){
 if(!raw||!Array.isArray(raw.rows))throw Error('缺少完整rows数组');
 const targetMap=new Map(targets.map(u=>[u.id,u])),all=new Map([...context,...targets].map(u=>[u.id,u]));
 if(targetMap.size!==targets.length)throw Error('目标ID重复');
 const rows=[],errors=[],seen=new Set();
 for(const row of raw.rows){
  if(!row||!targetMap.has(row.id)){errors.push({id:row?.id||null,code:'UNKNOWN_TARGET'});continue;}
  if(seen.has(row.id)){errors.push({id:row.id,code:'DUPLICATE_TARGET'});continue;}seen.add(row.id);
  if(!['candidate','background','uncertain'].includes(row.disposition)||typeof row.reason!=='string'||!row.reason.trim()){errors.push({id:row.id,code:'INVALID_DISPOSITION'});continue;}
  if(!Array.isArray(row.claims)||(row.disposition==='candidate'&&!row.claims.length)||(row.disposition!=='candidate'&&row.claims.length)){errors.push({id:row.id,code:'INVALID_CLAIMS'});continue;}
  const claims=[];let invalid=false;
  for(const claim of row.claims){
   if(typeof claim?.text!=='string'||!claim.text.trim()||!Array.isArray(claim.evidence)||!claim.evidence.length){invalid=true;break;}
   const evidence=[];
   for(const ref of claim.evidence){const u=all.get(ref.unitId);if(!u||typeof ref.quote!=='string'||!ref.quote.trim()||!u.text.includes(ref.quote)){invalid=true;break;}evidence.push({...ref,textHash:hash(u.text),page:u.page??null,parentUnitId:u.parentUnitId||u.id,parentStart:u.parentStart??0,spanStart:u.text.indexOf(ref.quote),spanEnd:u.text.indexOf(ref.quote)+ref.quote.length});}
   if(!evidence.some(e=>e.unitId===row.id))invalid=true;
   claims.push({text:claim.text,evidence,status:'needs_semantic_confirmation',citationValidity:invalid?'invalid':'valid',claimValidity:'not_verified'});
  }
  if(invalid){errors.push({id:row.id,code:'INVALID_EVIDENCE'});continue;}
  rows.push({id:row.id,disposition:row.disposition,reason:row.reason,claims,unitTextHash:hash(targetMap.get(row.id).text)});
 }
 for(const id of targetMap.keys())if(!seen.has(id))errors.push({id,code:'MISSING_TARGET'});
 const invalidIds=new Set(errors.map(e=>e.id));
 const accepted=rows.filter(r=>!invalidIds.has(r.id));
 return {protocol:SUPPLEMENT_PROTOCOL,accepted,errors,targetCount:targets.length,handledCount:accepted.length,allTargetsRegistered:accepted.length===targets.length&&errors.length===0,claimValidity:'not_verified',limit:'Supplemental model/config run only. Valid spans and target dispositions do not prove semantic coverage or correctness. Original checkpoints and exhausted attempts remain unchanged.'};
}
