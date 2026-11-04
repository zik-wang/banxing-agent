// Three finite offline checks against the fixed worker-02 protocol candidate.
// Usage: node <script> <repository> <new-evidence-directory> <python-executable>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const commit='f1d83df0d805529b8c0457acda279d2f3a2bfaee',v1='23d342172e724997fb4232e53bfae31ff95d6b22';
const [repoArg,outputArg,python]=process.argv.slice(2);
if(!repoArg||!outputArg||!python)throw Error('Provide repository, new evidence directory, Python');
const repo=fs.realpathSync(repoArg),root=path.resolve(outputArg);
if(fs.existsSync(root))throw Error('Preserve previous evidence');
const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:2*1024*1024}),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(git(['cat-file','-t',commit]).toString().trim(),'commit');fs.mkdirSync(root,{recursive:true});
const snapshot=path.join(root,'candidate-source'),files=[];
for(const name of ['scripts/t2-receipt-protocol-v2.mjs','scripts/t2-receipt-verification.mjs','v8-tools/money-calculator.mjs']){
 const bytes=git(['show',commit+':'+name]),target=path.join(snapshot,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files.push({path:name,sha256:sha(bytes)});
}
const {calculateMoney}=await import(pathToFileURL(path.join(snapshot,'v8-tools/money-calculator.mjs')));
const {buildReviewMessagesV2,validateIdentityEnvelope,compareDigests,validateReceiptReview}=await import(pathToFileURL(path.join(snapshot,'scripts/t2-receipt-protocol-v2.mjs')));
const source='【合成】设备"甲"1.2万元；\n服务30元。',financePlan={operation:'sum',operands:[{value:'1.2',unit:'万元',currency:'CNY',quote:'设备"甲"1.2万元'},{value:'30',unit:'元',currency:'CNY',quote:'服务30元'}]};
const receipt=calculateMoney(source,financePlan),{messages,identity}=buildReviewMessagesV2({source,financePlan,receipt,request:'Synthetic digest QA only',archivedClaims:[]});
const wire=JSON.parse(messages[1].content),names=['sourceRawUtf8','sourceJsonStringUtf8','financePlanJson','calculatorReceiptJson','receiptCoreJson'];
assert.equal(wire.source,source);assert.deepEqual(wire.sourceIdentity,identity);assert.deepEqual(wire.calculatorReceipt,receipt);
fs.writeFileSync(path.join(root,'synthetic-wire.json'),JSON.stringify(wire));
const py=`import json,hashlib,sys\nfrom pathlib import Path\nw=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))\ndef h(x):\n b=x.encode('utf-8');return {'value':hashlib.sha256(b).hexdigest(),'byteLength':len(b)}\ndef j(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))\nr=w['calculatorReceipt']\nkeys=['version','sourceSha256','planSha256','operation','bindings','rate','results','rounding','scope']\nc={k:r[k] for k in keys}\nprint(json.dumps({'sourceRawUtf8':h(w['source']),'sourceJsonStringUtf8':h(j(w['source'])),'financePlanJson':h(j(w['financePlan'])),'calculatorReceiptJson':h(j(r)),'receiptCoreJson':h(j(c))}))\n`;
fs.writeFileSync(path.join(root,'independent-domains.py'),py);
const independent=JSON.parse(execFileSync(python,[path.join(root,'independent-domains.py'),path.join(root,'synthetic-wire.json')],{encoding:'utf8'}));
for(const name of names){assert.equal(identity.digests[name].value,independent[name].value);assert.equal(identity.digests[name].byteLength,independent[name].byteLength);assert(messages[0].content.includes(name));}
assert.notEqual(independent.sourceRawUtf8.value,independent.sourceJsonStringUtf8.value);
assert.notEqual(independent.calculatorReceiptJson.value,independent.receiptCoreJson.value);
assert.equal(receipt.receiptId,'MONEY-'+independent.receiptCoreJson.value);
assert.equal(receipt.sourceSha256,independent.sourceJsonStringUtf8.value);assert.equal(receipt.planSha256,independent.financePlanJson.value);
const input={source:wire.source,financePlan:wire.financePlan,receipt:wire.calculatorReceipt};
const positive=validateIdentityEnvelope(input,wire.sourceIdentity);assert(positive.passed);
const comparisons=[];
for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
 const comparison=compareDigests(identity.digests[names[i]],identity.digests[names[j]]);assert.equal(comparison.comparable,false);assert.equal(comparison.equal,null);comparisons.push({a:names[i],b:names[j],...comparison});
}
const swapped=structuredClone(identity);[swapped.digests.calculatorReceiptJson,swapped.digests.receiptCoreJson]=[swapped.digests.receiptCoreJson,swapped.digests.calculatorReceiptJson];
const swappedResult=validateIdentityEnvelope(input,swapped);assert(!swappedResult.passed);assert(swappedResult.issues.includes('IDENTITY_DIGEST_MISMATCH:calculatorReceiptJson'));assert(swappedResult.issues.includes('IDENTITY_DIGEST_MISMATCH:receiptCoreJson'));
const changedPlan=structuredClone(financePlan);changedPlan.operands[0].label='SYNTHETIC changed label, same amount';
assert.equal(calculateMoney(source,changedPlan).results[0].amount,receipt.results[0].amount);
const changedPlanResult=validateIdentityEnvelope({...input,financePlan:changedPlan},identity);assert(!changedPlanResult.passed);assert(changedPlanResult.issues.includes('CALCULATOR_RECEIPT_CONTENT_MISMATCH'));
const output={decision:'rejected',sourceSha256:identity.digests.sourceRawUtf8.value,receiptId:receipt.receiptId,operand_checks:receipt.bindings.map((b,index)=>({index,value:b.value,unit:b.unit,currency:b.currency,quote:b.quote,supported:true,yuan_value:index===0?'12000.00':'30.00'})),missing_components:[],claims:[{currency:'CNY',amount:'12030.00',receiptId:receipt.receiptId}],explanation:'Synthetic fixture; no model review was run.'};
const stillRejected=validateReceiptReview(output,{...input,identity});assert.deepEqual(stillRejected.issues,['NOT_VERIFIED']);
const preservedFiles=['v8-tools/money-calculator.mjs','scripts/t2-receipt-verification.mjs','docs/reports/2026-11-05-t2-real-verify/results.json'].map(name=>{
 const before=git(['rev-parse',v1+':'+name]).toString().trim(),after=git(['rev-parse',commit+':'+name]).toString().trim();assert.equal(before,after);return{path:name,blobUnchanged:true};
});
const result={commit,kind:'INDEPENDENT_V2_THREE_FINITE_CHECKS',newModelRequests:0,productionTouched:false,worker02WorktreeModified:false,
 checks:[{name:'wire_five_domains_independently_recomputed',passed:true},{name:'full_and_core_descriptor_swap_rejected',passed:!swappedResult.passed,actual:swappedResult},{name:'same_amount_plan_change_rejected',passed:!changedPlanResult.passed,actual:changedPlanResult}],
 independent,domainComparisons:comparisons,rejectedModelFixtureRetained:stillRejected,preservedFiles,
 limits:['Synthetic program fixtures, not model responses.','No real v2 model validation, production A-B-A or user acceptance.','Offline repair cannot prove the unique cause of the historical v1 rejection.']};
fs.writeFileSync(path.join(root,'snapshot-manifest.json'),JSON.stringify({commit,files},null,2));fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({commit,checks:result.checks,preservedFiles,newModelRequests:0}));
