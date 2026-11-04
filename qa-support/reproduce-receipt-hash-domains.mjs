// Finite offline protocol probe. No operator profiles, real material or network.
// Usage: node <script> <git-repository> <new-evidence-directory> <python-executable>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const commit='23d342172e724997fb4232e53bfae31ff95d6b22';
const [repoArg,outputArg,python]=process.argv.slice(2);
if(!repoArg||!outputArg||!python)throw Error('Provide repository, new evidence directory and Python executable');
const repo=fs.realpathSync(repoArg),root=path.resolve(outputArg),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(fs.existsSync(root))throw Error('Preserve previous evidence; use a new isolated directory');
const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:2*1024*1024});
assert.equal(git(['cat-file','-t',commit]).toString().trim(),'commit');
fs.mkdirSync(root,{recursive:true});
const snapshot=path.join(root,'candidate-source'),files=[];
for(const name of ['v8-tools/money-calculator.mjs','scripts/t2-receipt-verification.mjs','scripts/t2-real-receipt-verify.mjs']){
 const bytes=git(['show',commit+':'+name]),target=path.join(snapshot,name);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files.push({path:name,sha256:sha(bytes)});
}
// Import only the pure calculator and verifier. Never execute the real API entry.
const {calculateMoney}=await import(pathToFileURL(path.join(snapshot,'v8-tools/money-calculator.mjs')));
const {validateReceiptReview,REVIEW_SYSTEM,PROMPT_VERSION}=await import(pathToFileURL(path.join(snapshot,'scripts/t2-receipt-verification.mjs')));
const source='【合成】设备"甲"1.2万元；\n服务30元。';
const plan={operation:'sum',operands:[{value:'1.2',unit:'万元',currency:'CNY',quote:'设备"甲"1.2万元'},{value:'30',unit:'元',currency:'CNY',quote:'服务30元'}]};
const rawBytes=Buffer.from(source,'utf8'),serialized=JSON.stringify(source),serializedBytes=Buffer.from(serialized,'utf8');
const rawSha256=sha(rawBytes),jsonStringSha256=sha(serializedBytes),receipt=calculateMoney(source,plan);
fs.writeFileSync(path.join(root,'synthetic-input.json'),JSON.stringify({source},null,2));
const pythonCode=`import hashlib,json,sys\nfrom pathlib import Path\ns=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['source']\na=s.encode('utf-8')\nb=json.dumps(s,ensure_ascii=False).encode('utf-8')\nprint(json.dumps({'rawSha256':hashlib.sha256(a).hexdigest(),'jsonStringSha256':hashlib.sha256(b).hexdigest(),'rawBytes':len(a),'jsonBytes':len(b)}))\n`;
fs.writeFileSync(path.join(root,'independent-hash.py'),pythonCode);
const independentlyComputed=JSON.parse(execFileSync(python,[path.join(root,'independent-hash.py'),path.join(root,'synthetic-input.json')],{encoding:'utf8'}));
assert.equal(independentlyComputed.rawSha256,rawSha256);assert.equal(independentlyComputed.jsonStringSha256,jsonStringSha256);
assert.notEqual(rawSha256,jsonStringSha256);assert.equal(receipt.sourceSha256,jsonStringSha256);
assert.equal(independentlyComputed.rawBytes,rawBytes.length);assert.equal(independentlyComputed.jsonBytes,serializedBytes.length);
const {receiptId,...body}=receipt;assert.equal(receiptId,'MONEY-'+sha(JSON.stringify(body)));
assert(receipt.bindings.every(b=>source.slice(b.start,b.end)===b.quote));
const payload={source,sourceSha256:rawSha256,calculatorReceipt:receipt};
assert.equal(JSON.parse(JSON.stringify(payload)).source,source);
const make=()=>({decision:'verified',receiptId,sourceSha256:rawSha256,operand_checks:receipt.bindings.map((b,index)=>({index,value:b.value,unit:b.unit,currency:b.currency,quote:b.quote,supported:true,yuan_value:index===0?'12000.00':'30.00'})),missing_components:[],claims:[{currency:'CNY',amount:'12030.00',receiptId}],explanation:'Synthetic protocol fixture only; not a model response or contract acceptance.'});
const context={sourceSha256:rawSha256,source,receipt};
const acceptedRaw=validateReceiptReview(make(),context);
const usesReceiptDomain=make();usesReceiptDomain.sourceSha256=jsonStringSha256;
const receiptDomainOutput=validateReceiptReview(usesReceiptDomain,context);
const rejectsDecision=make();rejectsDecision.decision='rejected';
const modelRejectsWhileEchoingRaw=validateReceiptReview(rejectsDecision,context);
assert(acceptedRaw.passed);assert.deepEqual(receiptDomainOutput.issues,['SOURCE_HASH_MISMATCH']);
assert.deepEqual(modelRejectsWhileEchoingRaw.issues,['NOT_VERIFIED']);
const result={commit,promptVersion:PROMPT_VERSION,kind:'ONE_SYNTHETIC_INPUT_OFFLINE_HASH_DOMAIN_PROBE',newModelRequests:0,productionTouched:false,worker02WorktreeModified:false,
 raw:{domain:'SHA256(UTF8(source))',sha256:rawSha256,byteLength:rawBytes.length},
 serialized:{domain:'SHA256(UTF8(JSON.stringify(source)))',sha256:jsonStringSha256,byteLength:serializedBytes.length},
 independentPython:independentlyComputed,sourceRoundTripUnchanged:true,quoteSpansMatch:true,receiptIdRecomputed:true,
 sameFieldNameDifferentDomains:true,promptExplainsOuterRawUtf8:REVIEW_SYSTEM.includes('输入原文的UTF8 SHA256'),promptExplainsNestedJsonDomain:REVIEW_SYSTEM.includes('JSON.stringify(source)'),
 receiptSourceHashDomainMetadata:Object.keys(receipt).filter(k=>/domain|encoding|serialization/i.test(k)),
 validator:{rawVerified:acceptedRaw,jsonDomainVerified:receiptDomainOutput,rawRejected:modelRejectsWhileEchoingRaw},
 inferenceBoundary:'Confirms a deterministic unlabelled hash-domain conflict. Does not prove the unique cause of any historical model decision, content corruption, or successful business verification.'};
assert(result.promptExplainsOuterRawUtf8);assert(!result.promptExplainsNestedJsonDomain);assert.equal(result.receiptSourceHashDomainMetadata.length,0);
fs.writeFileSync(path.join(root,'snapshot-manifest.json'),JSON.stringify({commit,files},null,2));
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
