import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {calculateMoney} from '../v8-tools/money-calculator.mjs';
import {PROMPT_VERSION,rawTextDigest,jsonDigest,compareDigests,createIdentityEnvelope,validateIdentityEnvelope,buildReviewMessagesV2,validateReceiptReview} from '../scripts/t2-receipt-protocol-v2.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(source='设备1.2万元；\r\n服务30元。\n备注："中文报价"，不改换行。'){
 const financePlan={operation:'sum',operands:[{value:'1.2',unit:'万元',currency:'CNY',quote:'设备1.2万元'},{value:'30',unit:'元',currency:'CNY',quote:'服务30元'}]};
 const receipt=calculateMoney(source,financePlan);return {source,financePlan,receipt};
}
const review=f=>({decision:'verified',receiptId:f.receipt.receiptId,sourceSha256:rawTextDigest(f.source).value,operand_checks:f.receipt.bindings.map((b,index)=>({index,value:b.value,unit:b.unit,currency:b.currency,quote:b.quote,supported:true,yuan_value:index===0?'12000.00':'30.00'})),missing_components:[],claims:[{currency:'CNY',amount:'12030.00',receiptId:f.receipt.receiptId}],explanation:'合成离线校验对象，不冒充真实模型结果。'});

test('v2 raw UTF8 and JSON-string digests preserve Chinese, quotes and exact EOL',()=>{
 for(const source of ['中文\r\n"报价"\\路径\n','\uFEFF  前后空格\t\n','']){
  const a=rawTextDigest(source),b=jsonDigest(source);
  assert.equal(a.value,sha(Buffer.from(source,'utf8')));assert.equal(b.value,sha(Buffer.from(JSON.stringify(source),'utf8')));
  assert.equal(a.byteLength,Buffer.byteLength(source));assert.equal(a.normalization,'none');assert.equal(a.serialization,'none');assert.notEqual(a.value,b.value);
  assert.deepEqual(compareDigests(a,b),{comparable:false,equal:null,reason:'DIFFERENT_DIGEST_DOMAINS'});
  assert.equal(compareDigests(a,rawTextDigest(source)).equal,true);
 }
});
test('trim, CRLF rewriting and Unicode normalization are actual same-domain changes',()=>{
 for(const [original,changed]of [[' 原文\n','原文'],['中文\r\n报价','中文\n报价'],['\u00E9','e\u0301']]){
  const result=compareDigests(rawTextDigest(original),rawTextDigest(changed));assert.equal(result.comparable,true);assert.equal(result.equal,false);
 }
});
test('JSON object order is explicit noncanonical serialization, not raw-source identity',()=>{
 const a=jsonDigest({a:1,b:'中文'},'plan'),b=jsonDigest({b:'中文',a:1},'plan');
 assert.equal(compareDigests(a,b).comparable,true);assert.equal(compareDigests(a,b).equal,false);
 assert.equal(a.serializationVersion,'no-replacer-no-space-v1');
 assert.equal(compareDigests(a,jsonDigest({a:1,b:'中文'},'another_object')).comparable,false);
});
test('same source validates both declared domains without comparing their values',()=>{
 const f=fixture(),envelope=createIdentityEnvelope(f);assert(validateIdentityEnvelope(f,envelope).passed);
 assert.notEqual(envelope.digests.sourceRawUtf8.value,envelope.digests.sourceJsonStringUtf8.value);
 assert.equal(envelope.legacySourceBinding.digestRef,'sourceJsonStringUtf8');assert.equal(envelope.legacySourceBinding.checkedByHost,true);
 assert.equal(envelope.digests.financePlanJson.value,f.receipt.planSha256);
 assert.equal('MONEY-'+envelope.digests.receiptCoreJson.value,f.receipt.receiptId);
 assert.notEqual(envelope.digests.receiptCoreJson.value,envelope.digests.calculatorReceiptJson.value);
 const {messages,identity}=buildReviewMessagesV2({...f,request:'核对原回执',archivedClaims:review(f).claims});
 const input=JSON.parse(messages[1].content);assert.equal(input.source,f.source);assert.deepEqual(input.sourceIdentity,identity);
 assert(messages[0].content.includes('禁止直接相等比较'));assert(PROMPT_VERSION.endsWith('-v2'));
});
test('raw digest borrowed into the legacy serialized-source field is rejected',()=>{
 const f=fixture();f.receipt.sourceSha256=rawTextDigest(f.source).value;
 assert.throws(()=>buildReviewMessagesV2({...f,request:'test',archivedClaims:[]}),e=>e.code==='LEGACY_RECEIPT_SOURCE_MISMATCH');
});
test('source edits, digest edits, mapping edits and unsupported algorithm/version fail closed',()=>{
 const f=fixture(),identity=createIdentityEnvelope(f);
 assert(!validateIdentityEnvelope({...f,source:f.source+' '},identity).passed);
 for(const change of [x=>x.digests.sourceRawUtf8.value='a'.repeat(64),x=>x.digests.sourceRawUtf8.algorithm='MD5',x=>x.digests.sourceRawUtf8.normalization='trim',x=>x.digests.sourceJsonStringUtf8.serializationVersion='unknown',x=>x.legacySourceBinding.digestRef='sourceRawUtf8',x=>x.legacyReceiptIdBinding.digestRef='calculatorReceiptJson']){
  const altered=structuredClone(identity);change(altered);assert(!validateIdentityEnvelope(f,altered).passed);
 }
});
test('tampered receipt arithmetic is rejected even with a freshly generated digest',()=>{
 const f=fixture();f.receipt.results[0].amount='1.00';assert.throws(()=>createIdentityEnvelope(f),e=>e.code==='CALCULATOR_RECEIPT_CONTENT_MISMATCH');
});
test('reordered receipt object can be represented explicitly without changing business fields',()=>{
 const f=fixture(),keys=Object.keys(f.receipt).reverse();f.receipt=Object.fromEntries(keys.map(k=>[k,f.receipt[k]]));
 const identity=createIdentityEnvelope(f);assert(validateIdentityEnvelope(f,identity).passed);
 assert.equal('MONEY-'+identity.digests.receiptCoreJson.value,f.receipt.receiptId);
});
test('unsupported JSON values and malformed raw Unicode are not silently normalized',()=>{
 const circular={};circular.self=circular;
 for(const value of [NaN,undefined,{hidden:undefined},circular,new Date(),[,,]])assert.throws(()=>jsonDigest(value));
 assert.throws(()=>rawTextDigest('\ud800'),e=>e.code==='WELL_FORMED_TEXT_REQUIRED');
});
test('v2 output validation checks identity first and never upgrades a rejected model verdict',()=>{
 const f=fixture(),identity=createIdentityEnvelope(f),output=review(f);
 assert(validateReceiptReview(output,{...f,identity}).passed);
 const rejected=structuredClone(output);rejected.decision='rejected';assert(!validateReceiptReview(rejected,{...f,identity}).passed);
 const stale=structuredClone(identity);stale.digests.sourceRawUtf8.value='b'.repeat(64);assert(!validateReceiptReview(output,{...f,identity:stale}).passed);
});
