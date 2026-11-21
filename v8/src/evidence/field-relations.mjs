import {validateRelation} from './issue-review.mjs';
export const FIELD_RELATION_VERSION='v7-p1-field-relations-1';
export function guardInterpretationFields(row){
 if(row.verification==='program_text_transition'||!row.owner&&!row.dueText)return row;
 const sourceUnits=[...new Map([...(row.basis||[]),...(row.evidence||[])].map((r,i)=>{const id=r.unitId||r.sourceId+':'+(r.start??i);return [id,{id,sourceId:r.sourceId,start:r.start||0,text:r.quote}];})).values()];
 const next={...row,owner:row.owner||'',dueText:row.dueText||'',status:'needs_confirmation',modelFieldCandidates:{owner:row.owner||'',dueText:row.dueText||''},proposedFields:{},fieldValidation:{version:FIELD_RELATION_VERSION,checks:[],limit:'局部字段角色支持不证明整条模型解释正确。'}};
 for(const [field,predicate,subject,object]of [['owner','responsible_for',next.owner,row.title],['dueText','due_on',row.title,next.dueText]])if(next[field]){
  let relation;try{relation=validateRelation({subject,predicate,object,sourceUnitIds:sourceUnits.map(u=>u.id)},sourceUnits);}catch(error){relation={subject,predicate,object,sourceUnitIds:sourceUnits.map(u=>u.id),validationStatus:'unsupported',verifierMethod:'field-relation-error-guard-v1',reason:'字段关系核验失败，保留候选：'+error.message};}
  if(sourceUnits.some(u=>/如果|仅限|除非|除外|但|不得|尚未/.test(u.text))){relation.validationStatus='ambiguous';relation.reason='引用范围存在条件、例外或否定；字段需核对适用范围';}
  next.fieldValidation.checks.push({field,proposed:next[field],relation});
  if(relation.validationStatus!=='supported'){next.proposedFields[field]=next[field];next[field]='';}
 }
 return next;
}
