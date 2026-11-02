import {createHash} from 'node:crypto';
import {validate} from '../v8-tools/harness.mjs';
import {responseSchema,findingSchema,verifySchema} from './schema.mjs';
import {bindEvidence,validateVerification,legalBoundary} from './evidence.mjs';

export const PROTOCOL_VERSION='contract-submit-2';
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const clone=value=>structuredClone(value);
// Delivery preferences are data for the renderer, never a second submission schema.
export function requestIntent(raw='') {
 const deliveryPreferences={json:/\bjson\b/i.test(raw),word:/word|docx|沃德/i.test(raw),concise:/简洁|简短/.test(raw)};
 const protocolLines=[],business=[];
 let inFormat=false;
 for(const line of raw.split('\n').flatMap(line=>/JSON对象.{0,10}格式|JSON.{0,10}(?:结构|格式)\s*[：:]/i.test(line)?[line]:line.split(/(?<=。)/))){
  if(/(?:输出|返回|格式|结构|引用).{0,30}(?:JSON|U\d|U编号)|(?:JSON).{0,20}(?:格式|结构)|^\s*[{\[]|^\s*"[\w-]+"\s*:/i.test(line)){protocolLines.push(line);inFormat=true;continue;}
  if(inFormat&&/^\s*[}\],]|^\s*```/.test(line)){protocolLines.push(line);continue;}
  if(line.trim()){business.push(line);inFormat=false;}
 }
 return {originalRequest:raw,businessGuidance:business.join('\n'),deliveryPreferences,deliveryInstructions:protocolLines.join('\n'),internalProtocol:PROTOCOL_VERSION};
}
export function contractDescription(schema){
 const empty=Object.keys(schema.properties||{}).includes('checks')?{checks:[{check_id:'本轮请求ID',status:'insufficient_evidence',inspected_unit_ids:['本轮实际阅读E编号'],evidence_refs:[],explanation:'具体范围和材料不足理由',unresolved_questions:[]}],findings:[]}:{decisions:[],comments:[]};
 return {version:PROTOCOL_VERSION,required: schema.required,example:empty,note:'只使用当前工具schema。findings必须是数组；无候选时显式[]，不可缺失/null/字符串。risk_found须关联真实发现。用户JSON/Word偏好由宿主交付，不改变内部协议。'};
}

// Validate copies item by item. A broken sibling must not erase valid observations.
// Observations and accepted dispositions are intentionally separate.
export function acceptSubmission(raw,{index,checkIds,targets,identity={},priorFindings=[],schema=responseSchema,itemSchema=findingSchema}){
 const out={checks:[],findings:[],observations:[],quarantine:[],errors:[],pendingIds:[],identity,sourceFingerprint:fingerprint(raw)};
 const error=(path,code,detail='',targetId=null)=>out.errors.push({path,code,detail,targetId});
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){error('arguments','OBJECT_REQUIRED');out.pendingIds=[...checkIds];return out;}
 const validFindings=Array.isArray(raw.findings),validChecks=Array.isArray(raw.checks);
 if(!validFindings)error('arguments.findings','FINDINGS_ARRAY_REQUIRED');
 if(!validChecks)error('arguments.checks','CHECKS_ARRAY_REQUIRED');
 if(validFindings&&raw.findings.length>schema.properties.findings.maxItems)error('arguments.findings','ARRAY_LENGTH_EXCEEDED');
 if(validChecks&&raw.checks.length>schema.properties.checks.maxItems)error('arguments.checks','ARRAY_LENGTH_EXCEEDED');
 for(const key of Object.keys(raw))if(!['checks','findings'].includes(key))error('arguments.'+key,'UNEXPECTED_FIELD');
 if(validFindings)for(const [n,value]of raw.findings.entries()){
  const location='arguments.findings['+n+']';
  try{
   validate(itemSchema,value,location);
   const f=clone(value);
   if(!f.check_ids.length||f.check_ids.some(id=>!checkIds.includes(id)))throw Error('FINDING_CHECK_SCOPE');
   if(!f.evidence_refs.length)throw Error('FINDING_EVIDENCE_REQUIRED');
   f.evidence=bindEvidence(index,f.evidence_refs);
   if(f.category==='条款冲突'&&new Set(f.evidence.map(r=>r.clause_label||r.unit_id)).size<2)throw Error('CONFLICT_NEEDS_BOTH_CLAUSES');
   if(!f.explanation.trim()||!f.priority_reason.trim())throw Error('FINDING_REASON_REQUIRED');
   Object.assign(f,{level:'model_judgment',origin:'model',legal_sources:[],legal_verification:'unverified',receipt:{...identity,path:location,sourceFingerprint:out.sourceFingerprint}});
   out.findings.push(legalBoundary({findings:[f]}).findings[0]);
  }catch(e){out.quarantine.push({kind:'finding',value:clone(value),path:location,reason:e.message,...identity});error(location,'INVALID_FINDING',e.message);}
 }
 const groups=new Map();
 if(validChecks)for(const [n,value]of raw.checks.entries()){
  const location='arguments.checks['+n+']';
  out.observations.push({kind:'check',value:clone(value),path:location,...identity});
  if(!checkIds.includes(value?.check_id)){out.quarantine.push({kind:'check',value:clone(value),path:location,reason:'UNREQUESTED_CHECK',...identity});error(location,'UNREQUESTED_CHECK');continue;}
  const list=groups.get(value.check_id)||[];list.push({value,location});groups.set(value.check_id,list);
 }
 for(const id of checkIds){
  const variants=groups.get(id)||[];
  if(!variants.length){error('checks.'+id,'MISSING_CHECK','',id);continue;}
  if(new Set(variants.map(x=>fingerprint(x.value))).size>1){error('checks.'+id,'CONFLICTING_DUPLICATES','Conflicting observations retained; no last-write-wins',id);continue;}
  try{
   const {value,location}=variants[0];validate(schema.properties.checks.items,value,location);
   const c=clone(value);
   if(!c.explanation.trim())throw Error('CHECK_EXPLANATION_REQUIRED');
   if(new Set(c.inspected_unit_ids).size!==c.inspected_unit_ids.length||c.inspected_unit_ids.some(u=>!targets.includes(u)))throw Error('UNKNOWN_OR_DUPLICATE_INSPECTED_UNIT');
   if(targets.some(u=>!c.inspected_unit_ids.includes(u)))throw Error('UNINSPECTED_TARGETS');
   c.evidence=bindEvidence(index,c.evidence_refs);
   if(!validFindings)throw Error('FINDINGS_ARRAY_REQUIRED');
   if(out.quarantine.some(x=>x.kind==='finding'&&(!Array.isArray(x.value?.check_ids)||x.value.check_ids.includes(id))))throw Error('RELATED_FINDING_INVALID');
   const linked=[...out.findings,...priorFindings].filter(f=>f.check_ids.includes(id));
   if(c.status==='risk_found'&&!linked.length)throw Error('RISK_WITHOUT_FINDING');
   if(c.status==='no_issue_found'&&linked.length)throw Error('NO_ISSUE_WITH_FINDING');
   if(c.status==='not_applicable'&&linked.some(f=>f.category!=='待确认'))throw Error('NOT_APPLICABLE_WITH_RISK');
   c.receipt={...identity,path:location,sourceFingerprint:out.sourceFingerprint};
   out.checks.push(legalBoundary({checks:[c]}).checks[0]);
  }catch(e){error('checks.'+id,e.message,'',id);}
 }
 out.pendingIds=checkIds.filter(id=>!out.checks.some(c=>c.check_id===id));
 out.complete=!out.pendingIds.length&&!out.quarantine.length&&!out.errors.some(e=>!e.targetId);
 return out;
}

export function acceptVerification(raw,index,findings,comments,identity={}){
 const out={decisions:[],comments:[],errors:[],pendingFindings:[],pendingComments:[],identity};
 for(const [key,items,idKey,source]of [['decisions',findings,'finding_id',raw?.decisions],['comments',comments,'audit_id',raw?.comments]]){
  if(!Array.isArray(source)){out.errors.push({path:key,code:'ARRAY_REQUIRED'});for(const x of items)out[key==='decisions'?'pendingFindings':'pendingComments'].push(x[idKey]);continue;}
  for(const item of items){const id=item[idKey],matches=source.filter(x=>x?.[key==='decisions'?'finding_id':'comment_id']===id);
   try{if(!matches.length||new Set(matches.map(fingerprint)).size>1)throw Error('MISSING_OR_CONFLICTING_VERIFIER_ITEM');
    const value=clone(matches[0]);validate(verifySchema.properties[key].items,value,key+'.'+id);
    const v=validateVerification(key==='decisions'?{decisions:[value],comments:[]}:{decisions:[],comments:[value]},index,key==='decisions'?[item]:findings,key==='comments'?[item]:[],key==='comments'?{decisionTargets:[]}:{});
    out[key].push({...legalBoundary(v)[key][0],receipt:{...identity,path:key+'.'+id}});
   }catch(e){out.errors.push({path:key+'.'+id,code:e.message});out[key==='decisions'?'pendingFindings':'pendingComments'].push(id);}
  }
  for(const extra of source)if(!items.some(x=>x[idKey]===extra?.[key==='decisions'?'finding_id':'comment_id']))out.errors.push({path:key,code:'UNKNOWN_VERIFIER_ITEM',value:clone(extra)});
 }
 out.complete=!out.errors.length;
 return out;
}
