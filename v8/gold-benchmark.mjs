import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {evaluateBenchmark,factKey} from './blind-benchmark.mjs';
export const GOLD_VERSION='v7-p2-gold-1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateReferenceFact(f){
 const errors=[];
 for(const field of ['reference_item_id','source_file','expected_fact','subject','relation','risk_level'])if(typeof f[field]!=='string'||!f[field].trim())errors.push(field+' must be a nonempty string');
 if(f.object===undefined||!f.source_location||!Number.isInteger(f.source_location.start)||f.source_location.start<0||!Number.isInteger(f.source_location.end)||f.source_location.end<=f.source_location.start)errors.push('object and exact nonnegative source_location are required');
 for(const field of ['condition','exception'])if(!Array.isArray(f[field]))errors.push(field+' must be an array; use [] explicitly');
 if(!['critical','high','normal'].includes(f.risk_level))errors.push('invalid risk_level');
 return errors;
}
export function recordAnnotation(packet,directory){
 if(packet.version!==GOLD_VERSION||packet.annotator?.kind!=='human'||packet.annotator.independentOfDevelopment!==true||!packet.annotator.id||!packet.caseId||!Array.isArray(packet.facts))throw Error('需要实际独立人工标注身份和完整事实列表；不能用工程师/模型临时检查冒充gold');
 const errors=packet.facts.flatMap(f=>validateReferenceFact(f));if(errors.length)throw Error(errors.join('; '));
 if(new Set(packet.facts.map(f=>f.reference_item_id)).size!==packet.facts.length)throw Error('reference_item_id重复');
 fs.mkdirSync(directory,{recursive:true});const id=randomUUID(),file=path.join(directory,id+'.json'),receipt={...packet,id,recordedAt:new Date().toISOString(),packetHash:hash(packet),identityLimit:'Human identity and independence are declared by the submitting organization, not proven by this program.'};
 fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});return {id,file,packetHash:receipt.packetHash};
}
export function adjudicateReference(testCase,annotations,resolution){
 if(annotations.length<2||new Set(annotations.map(a=>a.annotator?.id)).size<2||annotations.some(a=>a.caseId!==testCase.id||a.annotator?.kind!=='human'||a.annotator?.independentOfDevelopment!==true))throw Error('至少两位不同的实际独立人工标注者');
 if(!resolution?.adjudicatorId||annotations.some(a=>a.annotator.id===resolution.adjudicatorId)||resolution.complete!==true||!Array.isArray(resolution.facts)||!Array.isArray(resolution.disagreements))throw Error('需要独立裁定者、分歧说明和完整参考答案');
 const errors=resolution.facts.flatMap(validateReferenceFact);if(errors.length)throw Error(errors.join('; '));
 return {...testCase,reference:{status:'adjudicated',complete:true,annotationIds:annotations.map(a=>a.id),annotatorIds:annotations.map(a=>a.annotator.id),adjudicatorId:resolution.adjudicatorId,humanIndependent:true,facts:resolution.facts,referenceHash:hash(resolution.facts),disagreements:resolution.disagreements},sealedAt:new Date().toISOString()};
}
export function scoreGoldCase(testCase,prediction){
 const ref=testCase.reference;
 const eligible=ref?.humanIndependent===true&&new Set(ref.annotatorIds||[]).size>=2&&ref.adjudicatorId&&!ref.annotatorIds.includes(ref.adjudicatorId)&&ref.referenceHash===hash(ref.facts);
 const fact=f=>({...f,id:f.reference_item_id||f.id,predicate:f.relation||f.predicate,conditions:f.condition||f.conditions||[],exceptions:f.exception||f.exceptions||[],scope:f.scope??null,sourceRole:JSON.stringify({binding:f.source_file?{file:f.source_file,location:f.source_location?.unit_id||f.source_location}:f.sourceRole??null,change_type:f.change_type??f.changeType??null}),critical:f.risk_level==='critical'||f.critical===true});
 const normalized={...testCase,reference:eligible?{...ref,facts:ref.facts.map(fact)}:{status:'absent'}};
 const claims=(prediction.claims||[]).map(fact),production=evaluateBenchmark(normalized,{...prediction,claims});
 // Score every fact candidate, including pending/error-prone ones. This copy
 // changes scorer inclusion only; it never promotes a production claim.
 const result=evaluateBenchmark(normalized,{...prediction,claims:claims.map(c=>({...c,validationStatus:'source_supported'}))});
 return {...result,matchingRule:'Exact semantic tuple plus source unit/location; all fact candidates including pending are scored one-to-one. No production promotion.',productionValidationMetrics:production.metrics,candidateFactCount:claims.length,goldVersion:GOLD_VERSION,independentReferenceEligible:!!eligible,limit:'All supplied fact assertions count, so demoting wrong claims to pending cannot hide FP. Interpretation hypotheses must be evaluated separately. Exact matching may require human adjudication of equivalent wording. Zero eligible gold means accuracy not measurable.'};
}
export {factKey};
