import fs from 'node:fs';import {createHash} from 'node:crypto';
export const PACK_SCHEMA_VERSION='contract-reference-1';
export function inspectPack(pack){
 const errors=[];
 for(const key of ['packId','version','templateFamily','split','stance','region','reviewTime','files','dataClass'])if(!Object.hasOwn(pack,key))errors.push('missing '+key);
 if(!['engineering_fixture','human_adjudicated_reference','pending_annotation'].includes(pack.dataClass))errors.push('dataClass invalid');
 if(!['development','validation','holdout'].includes(pack.split))errors.push('split invalid');
 for(const f of pack.files||[]){if(!/^[a-f0-9]{64}$/.test(f.sha256||''))errors.push('invalid SHA '+f.path);if(f.path&&fs.existsSync(f.path)&&createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)errors.push('changed file '+f.path);}
 if(pack.dataClass==='human_adjudicated_reference'&&(!pack.adjudication?.reviewerId||pack.adjudication?.independent!==true||pack.adjudication?.status!=='adjudicated'))errors.push('independent human adjudication required');
 return {valid:!errors.length,errors};
}
// No model or fuzzy self-scoring. Match decisions and usability labels are supplied
// by an independent reviewer and must bind exact reference + run versions.
export function scoreReference(pack,reference,predictions,judgments){
 const valid=inspectPack(pack);
 const blocked=why=>({status:'not_measurable',reason:why,gold_count:0,critical_miss_rate:null,false_positive_count:null,evidence_location_rate:null,suggestion_usability:null});
 if(!valid.valid)return blocked(valid.errors.join('; '));
 if(pack.dataClass!=='human_adjudicated_reference')return blocked('No independently adjudicated human reference');
 if(!judgments?.reviewerId||judgments.independent!==true||judgments.referenceVersion!==reference.version||judgments.packVersion!==pack.version||judgments.predictionFingerprint!==createHash('sha256').update(JSON.stringify(predictions)).digest('hex'))return blocked('Missing or mismatched independent prediction judgments');
 const refs=reference.issues||[],propositions=predictions.propositions||[],rows=judgments.propositions||[];
 if(new Set(rows.map(r=>r.propositionId)).size!==rows.length||propositions.some(p=>!rows.some(r=>r.propositionId===p.id))||rows.some(r=>!propositions.some(p=>p.id===r.propositionId)))return blocked('Every independent proposition needs one judgment');
 const matches=judgments.matches||[];
 if(matches.some(m=>!refs.some(r=>r.referenceIssueId===m.referenceIssueId)||!propositions.some(p=>p.id===m.propositionId)))return blocked('Unknown reference or proposition in match');
 const hit=new Set(matches.filter(m=>m.decision==='hit').map(m=>m.referenceIssueId)),critical=refs.filter(r=>r.severity==='critical'),ratio=(n,d)=>d?n/d:null;
 const evidence=rows.filter(r=>typeof r.evidenceLocationCorrect==='boolean');
 return {status:'measured_by_independent_human',gold_count:1,reference_issue_count:refs.length,critical_miss_rate:ratio(critical.filter(r=>!hit.has(r.referenceIssueId)).length,critical.length),false_positive_count:rows.filter(r=>['unsupported','refuted'].includes(r.support)).length,evidence_location_rate:ratio(evidence.filter(r=>r.evidenceLocationCorrect).length,evidence.length),suggestion_usability:{adoptable:rows.filter(r=>r.suggestionUsability==='adoptable').length,needs_revision:rows.filter(r=>r.suggestionUsability==='needs_revision').length,unusable:rows.filter(r=>r.suggestionUsability==='unusable').length},execution:predictions.execution,referenceVersion:reference.version};
}
