import {contentHash} from './reliability.mjs';
export const RELATION_VERSION='v7-p3-relations-1';
export const RELATION_TYPES=['responsible_for','member_of','completed_on','due_on','scheduled_on','applies_to','excluded_from','depends_on','changed_from','changed_to'];
export function verifyRelation(input,units){
 const allowed=new Map(units.map(u=>[u.id,u])),refs=input.evidenceRefs||[],selected=refs.map(id=>allowed.get(id)).filter(Boolean),text=selected.map(u=>u.text).join('\n'),codes=[];
 let status='needs_human_review';
 if(!refs.length||selected.length!==refs.length){status='insufficient_evidence';codes.push('EVIDENCE_OUTSIDE_AUTHORIZED_SCOPE_OR_MISSING');}
 else if(!RELATION_TYPES.includes(input.predicate)){status='insufficient_evidence';codes.push('UNSUPPORTED_RELATION_TYPE');}
 else{
  const subj=String(input.subject||''),obj=String(input.object||'');
  if(!subj||!obj||!text.includes(subj)||!text.includes(obj)){status='insufficient_evidence';codes.push('SUBJECT_OR_OBJECT_NOT_LITERAL');}
  else{
   // A role marker elsewhere in a paragraph is not binding to this subject.
   const clauses=text.split(/[。；;\n]/).filter(t=>t.includes(subj));
   const local=clauses.join('\n'),near=clauses.some(t=>t.includes(obj));
   if(input.predicate==='responsible_for'){
    if(/成员|联系人|参与人/.test(local)&&!new RegExp(escape(subj)+'(?:担任|是|为)?(?:[^，。；]{0,6})?(?:负责人|负责)').test(local)){status='contradicted';codes.push('MEMBER_OR_CONTACT_IS_NOT_OWNER');}
    else if(!near||!new RegExp(escape(subj)+'(?:负责|为负责人|是负责人|担任负责人)').test(local)){status='insufficient_evidence';codes.push('NO_EXPLICIT_OWNER_BINDING');}
   }
   if(input.predicate==='due_on'&&/验收日期|已完成|完成于/.test(text)&&!/截止|期限|最迟|须于/.test(text)){status='contradicted';codes.push('COMPLETION_DATE_IS_NOT_DEADLINE');}
   if(input.predicate==='member_of'&&near&&/成员(?:包括|为|：)|作为.*成员/.test(local)){status='literal_supported';codes.push('EXPLICIT_MEMBERSHIP_TEXT');}
   if(input.predicate==='excluded_from'&&near&&/不在.*范围|不包括|不适用/.test(local)){status='literal_supported';codes.push('EXPLICIT_EXCLUSION_TEXT');}
   if(input.predicate==='applies_to'&&/不在.*范围|不适用|不包括/.test(local)){status='contradicted';codes.push('EXPLICIT_SCOPE_EXCLUSION');}
   if(['changed_from','changed_to'].includes(input.predicate)){codes.push('CHANGE_REQUIRES_BOUND_OLD_NEW_PAIR');}
   if(input.predicate==='depends_on'&&!/依赖|取决于|前提|依照/.test(text)){status='insufficient_evidence';codes.push('NO_EXPLICIT_DEPENDENCY');}
   if(/如果|若|仅限|进口|当.*时/.test(text)&&!input.condition){if(status!=='contradicted')status='needs_human_review';codes.push('CONDITION_NOT_BOUND');}
   if(/除外|除非|但不|不包括/.test(text)){if(status!=='contradicted')status='needs_human_review';codes.push('EXCEPTION_REQUIRES_REVIEW');}
   if(/不得|不能|未|并非/.test(local)&&!['excluded_from'].includes(input.predicate)){if(status!=='contradicted')status='needs_human_review';codes.push('NEGATION_REQUIRES_BINDING');}
  }
 }
 return {...input,relationId:input.relationId||'R'+contentHash(input).slice(0,24),condition:input.condition||null,scope:input.scope||null,validatorMethod:RELATION_VERSION,status,reasonCodes:codes.length?codes:['NO_DETERMINISTIC_RELATION_PROOF'],model_agreed:false,independently_verified:false};
}
function escape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
export function auditClaim(candidate,units,scenarioId){
 const byId=new Map(units.map(u=>[u.id,u])),evidence=candidate.evidence||[],valid=evidence.length>0&&evidence.every(e=>{const u=byId.get(e.unitId);return u&&typeof e.quote==='string'&&e.quote.length>0&&u.text.slice(e.spanStart,e.spanEnd)===e.quote&&(!e.textHash||contentHash(u.text)===e.textHash);});
 const text=candidate.text||candidate.originalClaim||'',quoted=evidence.map(e=>e.quote).join('\n'),codes=[];
 const literal=quoted.replace(/\s/g,'').includes(text.replace(/\s/g,''));let semanticStatus=valid&&literal?'directly_supported':valid?'not_checked':'insufficient_evidence';
 const change=/调整|改为|由.*变|新增|删除|降低|提高/.test(text),interpretation=/可能影响|导致|因此|成本|性能降低|工期延/.test(text);
 if(interpretation){codes.push('BUSINESS_INTERPRETATION_REQUIRES_EXTRA_EVIDENCE');semanticStatus='insufficient_evidence';}
 if(/无变化|未变化|保持不变/.test(text)){codes.push('NO_CHANGE_REQUIRES_EXHAUSTIVE_COMPARISON');semanticStatus='insufficient_evidence';}
 if(change&&!/由|调整为|改为|变更为/.test(quoted)){codes.push('CHANGE_NOT_BOUND_TO_BEFORE_AFTER');semanticStatus='insufficient_evidence';}
 const inScope=!(scenarioId==='08'&&!change);
 if(!inScope)codes.push('SOURCE_FACT_IS_NOT_VERSION_CHANGE');
 if(/否\s*$/.test(quoted)&&/:R\d+/.test(evidence[0]?.unitId||'')){codes.push('TABLE_LAST_COLUMN_UNBOUND');if(semanticStatus==='directly_supported')semanticStatus='partially_supported';}
 const high=/\d|负责|成员|截止|如果|若|除外|仅限|范围|不得|不应|缓存|存储|网络|防火墙|隔离|虚拟机|带宽|读写/.test(text),messages={BUSINESS_INTERPRETATION_REQUIRES_EXTRA_EVIDENCE:'业务推断需要额外依据',NO_CHANGE_REQUIRES_EXHAUSTIVE_COMPARISON:'无变化结论需要完整对照，单侧证据不足',CHANGE_NOT_BOUND_TO_BEFORE_AFTER:'变化没有绑定明确的前后原文',SOURCE_FACT_IS_NOT_VERSION_CHANGE:'这是来源中的事实，不能作为本次版本变化',TABLE_LAST_COLUMN_UNBOUND:'表格末列尚未绑定真实表头，不能将“否”解释为功能不支持'};
 return {candidateId:candidate.id,scenarioId,sourceUnitIds:evidence.map(e=>e.unitId),originalClaim:text,claimType:interpretation?'interpretation':change?'change_fact':'source_fact',evidenceRefs:evidence.map(e=>e.unitId),citationValid:valid,semanticStatus,taskScopeStatus:inScope?'requires_review':'outside_requested_change_scope',reviewPriority:high?'high':'medium',issueType:codes.join('|')||'SEMANTIC_SUPPORT_UNCHECKED',explanation:codes.length?codes.map(c=>messages[c]||c).join('；'):literal?'仅逐字文字支持；未独立人工审定':'引用通过；关系、改写与完整性尚未确认',independentlyVerified:false,modelAgreed:false};
}
export function counterEvidence(relation,authorizedUnits){
 const hits=authorizedUnits.filter(u=>u.text.includes(relation.subject)&&/成员|联系人|不包括|不在.*范围|除外|截止|已完成|验收日期|负责人/.test(u.text));
 return {relationId:relation.relationId,searchedUnitIds:authorizedUnits.map(u=>u.id),hits:hits.map(u=>({unitId:u.id,text:u.text,sourceId:u.sourceId})),result:hits.length?'potential_counter_evidence':'no_counter_evidence_found_not_proof'};
}
