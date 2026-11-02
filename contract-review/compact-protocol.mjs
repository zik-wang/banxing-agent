import {validate} from '../v8-tools/harness.mjs';
import {acceptSubmission,acceptVerification,fingerprint} from './protocol.mjs';
import {responseSchema,verifySchema} from './schema.mjs';
const string={type:'string',maxLength:3000},array=items=>({type:'array',items,maxItems:60}),object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const quoteSchema=object({unit_id:{type:'string',maxLength:250},quote:{type:'string',minLength:1,maxLength:8000}});
const checkSchema=object({check_id:{type:'string'},status:{type:'string',enum:['risk_found','no_issue_found','insufficient_evidence','not_applicable']},explanation:string,evidence_refs:array(quoteSchema),unresolved_questions:array(string)});
const findingSchema=object({check_ids:array({type:'string'}),category:{type:'string',enum:['文字错误','材料缺失','商务风险','法律风险','条款冲突','待确认']},priority:{type:'string',enum:['高','需关注','低']},title:string,evidence_refs:array(quoteSchema),explanation:string,conditions:array(string),exceptions:array(string),suggestion:string,unresolved_questions:array(string)});
export const compactResponseSchema=object({scope_complete:{type:'boolean'},unprocessed_unit_ids:array({type:'string'}),checks:array(checkSchema),findings:array(findingSchema)});
compactResponseSchema.properties.checks.maxItems=40;
compactResponseSchema.properties.findings.maxItems=24;
compactResponseSchema.properties.findings.items.properties.check_ids.maxItems=40;
export const compactCrossSchema=object({scope_complete:{type:'boolean'},unprocessed_unit_ids:array({type:'string'}),findings:compactResponseSchema.properties.findings});
export const compactVerifySchema=structuredClone(verifySchema);
for(const [name,list]of Object.entries(compactVerifySchema.properties)){
 list.items.properties.evidence_refs=array(quoteSchema);
 if(name==='decisions')list.items.properties.counter_evidence_refs=array(quoteSchema);
}
export function locateQuote(index,ref){
 const u=index.get(ref?.unit_id);if(!u)throw Error('UNKNOWN_EVIDENCE_UNIT');
 if(typeof ref.quote!=='string'||!ref.quote.length)throw Error('EMPTY_EVIDENCE_QUOTE');
 const first=u.raw_text.indexOf(ref.quote);if(first<0)throw Error('EVIDENCE_QUOTE_NOT_FOUND');
 if(u.raw_text.indexOf(ref.quote,first+1)>=0)throw Error('AMBIGUOUS_EVIDENCE_QUOTE');
 return {unit_id:ref.unit_id,start:Array.from(u.raw_text.slice(0,first)).length,end:Array.from(u.raw_text.slice(0,first+ref.quote.length)).length};
}
export function acceptCompactSubmission(raw,{index,checkIds,targets,identity={},priorFindings=[],cross=false}){
 const converted={checks:[],findings:[]},quarantine=[],conversionErrors=[];
 const convertRefs=refs=>refs.map(r=>locateQuote(index,r));
 const scopeComplete=raw?.scope_complete===true&&Array.isArray(raw?.unprocessed_unit_ids)&&raw.unprocessed_unit_ids.length===0;
 for(const [kind,schema]of [['findings',findingSchema],...(cross?[]:[['checks',checkSchema]])]){
  if(!Array.isArray(raw?.[kind])){converted[kind]=null;continue;}
  for(const [n,v]of raw[kind].entries())try{
   validate(schema,v);const value={...v,evidence_refs:convertRefs(v.evidence_refs)};
   if(kind==='checks')value.inspected_unit_ids=scopeComplete?[...targets]:[];
   else{value.priority_reason='模型提出的'+value.priority+'优先级；依据其问题解释，仍待业务核查。';value.interpretation_space=['条件：'+(v.conditions.join('；')||'未提出额外条件'),'例外：'+(v.exceptions.join('；')||'未提出明确例外')].join('\n');value.business_parameters=[];value.addresses_comment_ids=[];delete value.conditions;delete value.exceptions;}
   converted[kind].push(value);
  }catch(e){quarantine.push({kind:kind==='checks'?'check':'finding',value:v,path:kind+'.'+n,reason:e.message,...identity});conversionErrors.push({code:e.message,targetId:v.check_id||null});}
 }
 // Legacy item-level acceptance still enforces real spans, contradictions and findings.
 const legacySchema=structuredClone(responseSchema);legacySchema.properties.checks.maxItems=40;legacySchema.properties.checks.items.properties.check_id.maxLength=31;
 const legacyFinding=structuredClone(legacySchema.properties.findings.items);legacyFinding.properties.check_ids.maxItems=40;legacyFinding.properties.check_ids.items.maxLength=31;
 const accepted=acceptSubmission(converted,{index,checkIds,dispositionIds:cross?[]:checkIds,targets,identity,priorFindings,schema:legacySchema,itemSchema:legacyFinding});
 for(const key of Object.keys(raw||{}))if(!Object.keys((cross?compactCrossSchema:compactResponseSchema).properties).includes(key))accepted.errors.push({code:'UNEXPECTED_FIELD',path:key});
 // A bad compact finding must keep its related disposition pending as well.
 const badIds=new Set(quarantine.filter(q=>q.kind==='finding').flatMap(q=>Array.isArray(q.value?.check_ids)?q.value.check_ids:checkIds));
 accepted.checks=accepted.checks.filter(c=>!badIds.has(c.check_id));
 accepted.pendingIds=cross?checkIds.filter(id=>badIds.has(id)):checkIds.filter(id=>!accepted.checks.some(c=>c.check_id===id));accepted.quarantine.push(...quarantine);accepted.errors.push(...conversionErrors);
 accepted.complete=accepted.complete&&!quarantine.length&&scopeComplete&&!accepted.pendingIds.length&&!accepted.errors.length;
 accepted.scope_receipt={sentUnitIds:[...targets],returnedCheckIds:accepted.checks.map(c=>c.check_id),modelDeclaredScopeComplete:raw?.scope_complete===true,unprocessedUnitIds:Array.isArray(raw?.unprocessed_unit_ids)?raw.unprocessed_unit_ids:[...targets],meaning:'Host records sent/disposed scope; not proof of understanding or semantic recall.'};
 if(!scopeComplete)accepted.errors.push({code:'DECLARED_SCOPE_INCOMPLETE'});
 return accepted;
}
export function acceptCompactVerification(raw,index,findings,comments,identity={}){
 const converted={decisions:[],comments:[]},errors=[];
 for(const key of ['decisions','comments']){
  if(!Array.isArray(raw?.[key])){converted[key]=null;continue;}
  for(const item of raw[key])try{
   validate(compactVerifySchema.properties[key].items,item);
   const value={...item,evidence_refs:item.evidence_refs.map(r=>locateQuote(index,r))};
   if(key==='decisions'){
    value.counter_evidence_refs=item.counter_evidence_refs.map(r=>locateQuote(index,r));
    if(value.decision==='not_supported'&&!value.counter_evidence_refs.length)throw Error('REJECTION_REQUIRES_COUNTER_EVIDENCE');
   }
   converted[key].push(value);
  }catch(e){errors.push({code:e.message,value:item,...identity});}
 }
 const accepted=acceptVerification(converted,index,findings,comments,identity);accepted.errors.push(...errors);accepted.complete=accepted.complete&&!errors.length;return accepted;
}
