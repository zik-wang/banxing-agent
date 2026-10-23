import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const canonical=v=>JSON.stringify(sort(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
export const BENCHMARK_VERSION='v7-p1-blind-1';
const accuracyKeys=['precision','recall','f1','criticalRecall','criticalFalseNegativeCount','falsePositiveCount','wrongAttributionCount','scopeErrorCount','exceptionMissCount'];
const notMeasured=reason=>Object.fromEntries(accuracyKeys.map(k=>[k,{status:'not_measurable',value:null,reason}]));
// Scope, polarity, conditions and exceptions participate in identity. A
// citation hit, similar title or project ID is never a TP by itself.
export function factKey(f){return canonical({subject:f.subject,predicate:f.predicate,object:f.object,before:f.before??null,after:f.after??null,scope:f.scope??null,conditions:f.conditions??[],exceptions:f.exceptions??[],polarity:f.polarity||'positive',sourceRole:f.sourceRole??null});}
const measure=(value,numerator,denominator)=>({status:denominator?'measured':'not_measurable',value:denominator?value:null,numerator,denominator});
export function evaluateBenchmark(testCase,prediction){
 const common={id:testCase.id,version:BENCHMARK_VERSION,referenceStatus:testCase.reference?.status||'absent',deliveryIntegrity:measure(prediction.deliveryVerified?1:0,prediction.deliveryVerified?1:0,1),humanReviewBurden:{rawRecords:prediction.rawRecordCount??null,canonicalIssues:prediction.canonicalIssueCount??null,humanReviewRequired:prediction.humanReviewRequired??null,autoVerified:prediction.autoVerified??null},matchingRule:'exact semantic tuple including scope/conditions/exceptions/polarity; one-to-one; pending claims are not verified TP'};
 const ref=testCase.reference;
 if(!ref||ref.status!=='adjudicated'||!ref.complete||!Array.isArray(ref.facts)||!ref.annotationIds?.length)return {...common,metrics:notMeasured('缺少完整独立审定reference；工程师或模型临时检查不作为blind gold')};
 if(!testCase.sealedAt||!prediction.startedAt||!Number.isFinite(Date.parse(testCase.sealedAt))||!Number.isFinite(Date.parse(prediction.startedAt))||Date.parse(testCase.sealedAt)>=Date.parse(prediction.startedAt)||testCase.usedInDevelopment!==false||!testCase.familyId)return {...common,metrics:notMeasured('缺少事前封存、独立材料族或未参与开发声明')};
 const gold=ref.facts,actual=(prediction.claims||[]).filter(c=>['deterministically_verified','source_supported'].includes(c.validationStatus)),used=new Set(),pairs=[],fp=[];
 for(const p of actual){const i=gold.findIndex((g,i)=>!used.has(i)&&factKey(g)===factKey(p));if(i>=0){used.add(i);pairs.push({predictionId:p.id,referenceId:gold[i].id});}else fp.push(p);}
 const fn=gold.filter((_,i)=>!used.has(i)),tp=pairs.length,critical=gold.filter(g=>g.critical),criticalFN=fn.filter(g=>g.critical).length;
 const near=(p,g)=>p.predicate===g.predicate&&canonical(p.object)===canonical(g.object)&&canonical(p.before??null)===canonical(g.before??null)&&canonical(p.after??null)===canonical(g.after??null);
 const wrongAttribution=fp.filter(p=>gold.some(g=>near(p,g)&&p.subject!==g.subject)).length;
 const scopeErrors=fp.filter(p=>gold.some(g=>near(p,g)&&p.subject===g.subject&&canonical(p.scope??null)!==canonical(g.scope??null))).length;
 const exceptionMiss=fn.filter(g=>g.exceptions?.length&&actual.some(p=>near(p,g)&&p.subject===g.subject&&canonical(p.exceptions||[])!==canonical(g.exceptions))).length;
 const precision=actual.length?tp/actual.length:0,recall=gold.length?tp/gold.length:0;
 return {...common,metrics:{precision:measure(precision,tp,actual.length),recall:measure(recall,tp,gold.length),f1:measure(precision+recall?2*precision*recall/(precision+recall):0,2*tp,actual.length+gold.length),criticalRecall:measure(critical.length?(critical.length-criticalFN)/critical.length:0,critical.length-criticalFN,critical.length),criticalFalseNegativeCount:{status:'measured',value:criticalFN,denominator:critical.length},falsePositiveCount:{status:'measured',value:fp.length,denominator:actual.length},wrongAttributionCount:{status:'measured',value:wrongAttribution,denominator:actual.length},scopeErrorCount:{status:'measured',value:scopeErrors,denominator:actual.length},exceptionMissCount:{status:'measured',value:exceptionMiss,denominator:gold.filter(g=>g.exceptions?.length).length}},matches:pairs,falsePositives:fp.map(p=>p.id),falseNegatives:fn.map(g=>g.id)};
}
export async function runBlindCases(manifest,{root,output,runCase}){
 if(typeof runCase!=='function')throw Error('必须提供真实运行回调，不能用默认mock替代');
 const results=[];
 for(const c of manifest.cases){
  const inputs=c.files.map(f=>{const absolute=path.resolve(root,f.path);if(!absolute.startsWith(path.resolve(root)+path.sep))throw Error('benchmark输入越界');const bytes=fs.readFileSync(absolute);if(sha(bytes)!==f.sha256)throw Error('benchmark输入哈希不一致');return {...f,bytes};});
  // The inference callback never receives gold or annotation data.
  const prediction=await runCase({id:c.id,scenarioId:c.scenarioId,rules:c.rules,inputs});
  results.push({id:c.id,prediction,evaluation:evaluateBenchmark(c,prediction)});
 }
 const report={version:BENCHMARK_VERSION,manifestHash:sha(canonical(manifest)),results,limit:'单人标注或无完整gold时准确率不可测；不会把已知回归材料包装成盲测。'};fs.writeFileSync(output,JSON.stringify(report,null,2));return report;
}
