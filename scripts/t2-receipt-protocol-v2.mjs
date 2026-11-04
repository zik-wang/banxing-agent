import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {calculateMoney} from '../v8-tools/money-calculator.mjs';
import {REVIEW_SYSTEM as V1_SYSTEM,validateReceiptReview as validateV1} from './t2-receipt-verification.mjs';

export const PROMPT_VERSION='t2-archived-finance-receipt-review-v2';
export const IDENTITY_SCHEMA='typed-digest-envelope-v2';
const error=code=>Object.assign(Error(code),{code});
const common={algorithm:'SHA-256',encoding:'UTF-8',normalization:'none',normalizationVersion:'no-normalization-v1'};
const rawProfile={representation:'utf8-text-bytes',serialization:'none',serializationVersion:'none-v1'};
const jsonProfile={representation:'json-serialized-text-bytes',serialization:'ECMAScript JSON.stringify',serializationVersion:'no-replacer-no-space-v1'};
const domainKeys=['objectId','objectType','algorithm','encoding','representation','serialization','serializationVersion','normalization','normalizationVersion'];
function text(value){if(typeof value!=='string'||!value.isWellFormed())throw error('WELL_FORMED_TEXT_REQUIRED');return value;}
function jsonData(value,seen=new Set()){
 if(value===null||typeof value==='boolean'||typeof value==='string')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(typeof value!=='object'||seen.has(value))throw error('PLAIN_JSON_DATA_REQUIRED');
 const prototype=Object.getPrototypeOf(value);
 if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)throw error('PLAIN_JSON_DATA_REQUIRED');
 seen.add(value);
 if(Array.isArray(value))for(let i=0;i<value.length;i++){if(!Object.hasOwn(value,i))throw error('SPARSE_ARRAY_UNSUPPORTED');jsonData(value[i],seen);}
 else for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){if(descriptor.get||descriptor.set)throw error('PLAIN_JSON_DATA_REQUIRED');if(descriptor.enumerable)jsonData(descriptor.value,seen);}
 seen.delete(value);
}
function digest(bytes,objectId,objectType,profile){
 if(typeof objectId!=='string'||!objectId)throw error('DIGEST_OBJECT_ID_REQUIRED');
 return {objectId,objectType,...common,...profile,byteLength:bytes.length,value:createHash('sha256').update(bytes).digest('hex')};
}
// This hashes the exact UTF-8 encoding of the supplied parsed text value. It
// is NOT a physical DOCX/PDF/file-byte digest. No trim, EOL or Unicode rewrite.
export const rawTextDigest=(source,objectId='source_text')=>digest(Buffer.from(text(source),'utf8'),objectId,'text',rawProfile);
export function jsonDigest(value,objectId='source_text'){
 jsonData(value);const serialized=JSON.stringify(value);
 return digest(Buffer.from(serialized,'utf8'),objectId,typeof value==='string'?'text':'json-data',jsonProfile);
}
function checkDescriptor(d){
 if(!d||Object.keys(common).some(k=>d[k]!==common[k])||typeof d.objectId!=='string'||!d.objectId||!['text','json-data'].includes(d.objectType)||!Number.isInteger(d.byteLength)||d.byteLength<0||!/^[a-f0-9]{64}$/.test(d.value||''))throw error('UNSUPPORTED_DIGEST_DESCRIPTOR');
 const profile=d.representation===rawProfile.representation?rawProfile:d.representation===jsonProfile.representation?jsonProfile:null;
 if(!profile||Object.keys(profile).some(k=>d[k]!==profile[k]))throw error('UNSUPPORTED_DIGEST_DESCRIPTOR');
}
export function compareDigests(a,b){
 checkDescriptor(a);checkDescriptor(b);
 if(domainKeys.some(k=>a[k]!==b[k]))return {comparable:false,equal:null,reason:'DIFFERENT_DIGEST_DOMAINS'};
 return {comparable:true,equal:a.value===b.value&&a.byteLength===b.byteLength,reason:a.value===b.value&&a.byteLength===b.byteLength?'MATCH':'MISMATCH'};
}
export function createIdentityEnvelope({source,financePlan,receipt}){
 if(receipt.version!=='money-rational-v1')throw error('UNSUPPORTED_RECEIPT_HASH_PROTOCOL');
 const recomputed=calculateMoney(source,financePlan),{receiptId:ignored,...receiptCore}=recomputed;
 const digests={sourceRawUtf8:rawTextDigest(source),sourceJsonStringUtf8:jsonDigest(source),financePlanJson:jsonDigest(financePlan,'finance_plan'),calculatorReceiptJson:jsonDigest(receipt,'calculator_receipt')};
 digests.receiptCoreJson=jsonDigest(receiptCore,'calculator_receipt_core:money-rational-v1');
 if(receipt.sourceSha256!==digests.sourceJsonStringUtf8.value)throw error('LEGACY_RECEIPT_SOURCE_MISMATCH');
 if(!isDeepStrictEqual(recomputed,receipt))throw error('CALCULATOR_RECEIPT_CONTENT_MISMATCH');
 if(receipt.planSha256!==digests.financePlanJson.value||receipt.receiptId!=='MONEY-'+digests.receiptCoreJson.value)throw error('LEGACY_RECEIPT_DIGEST_MISMATCH');
 return {schema:IDENTITY_SCHEMA,digests,legacySourceBinding:{receiptVersion:receipt.version,receiptField:'sourceSha256',digestRef:'sourceJsonStringUtf8',checkedByHost:true},legacyPlanBinding:{receiptField:'planSha256',digestRef:'financePlanJson',checkedByHost:true},legacyReceiptIdBinding:{receiptField:'receiptId',prefix:'MONEY-',digestRef:'receiptCoreJson',derivation:'Host recomputes money-rational-v1 core excluding receiptId, using that calculator constructor field order.',checkedByHost:true},limitations:['Host verified digest computations/bindings only, not semantic completeness or business correctness.','JSON object member order follows ECMAScript JSON.stringify; no canonical sorting is performed.','calculatorReceiptJson hashes the full supplied receipt representation; it is NOT the receiptId suffix.']};
}
export function validateIdentityEnvelope(input,envelope){
 const issues=[];
 try{
  const expected=createIdentityEnvelope(input);
  if(envelope?.schema!==IDENTITY_SCHEMA)issues.push('IDENTITY_SCHEMA_MISMATCH');
  for(const [name,d]of Object.entries(expected.digests)){
   const compared=compareDigests(d,envelope?.digests?.[name]);
   if(!compared.comparable||!compared.equal)issues.push('IDENTITY_DIGEST_MISMATCH:'+name);
  }
  for(const name of ['legacySourceBinding','legacyPlanBinding','legacyReceiptIdBinding'])for(const [key,value]of Object.entries(expected[name]))if(envelope?.[name]?.[key]!==value)issues.push('LEGACY_BINDING_MISMATCH:'+name+':'+key);
 }catch(e){issues.push(e.code||'IDENTITY_INVALID');}
 return {passed:issues.length===0,issues};
}

export const REVIEW_SYSTEM=V1_SYSTEM+`
摘要协议v2：sourceIdentity明确声明每个摘要的对象、SHA-256算法、UTF-8编码、表示方式、序列化与规范化版本。sourceSha256及输出同名字段指sourceRawUtf8；旧calculatorReceipt.sourceSha256明确引用sourceJsonStringUtf8，即SHA256(JSON.stringify(原文字符串))。两者对象相同但表示域不同，摘要通常不同；禁止直接相等比较，也不能只因不同而推断原文被修改。
旧planSha256引用financePlanJson。receiptId是MONEY-前缀加receiptCoreJson，后者由宿主按money-rational-v1构造顺序重新计算并排除receiptId自身；它不是完整回执calculatorReceiptJson的摘要。各关系均由宿主重算核对，不要求模型猜测序列化顺序。
只有对象/算法/编码/表示/序列化版本/规范化版本完全相同的摘要才可比较。宿主分别重算并核验同域摘要及旧回执绑定；checkedByHost只证明这些确定性检查，不证明金额完整或业务正确。原文不trim、不调整换行、不做Unicode归一化。JSON对象按ECMAScript JSON.stringify规则保留成员次序，不宣称排序规范化。若描述缺失或版本不支持，应明确待核，不能猜算法。
继续独立核对取数、换算、遗漏和最终引用，不因为宿主校验摘要通过就自动给verified。`;
export function buildReviewMessagesV2({source,request,financePlan,receipt,archivedClaims}){
 const input={source,financePlan,receipt},identity=createIdentityEnvelope(input),validation=validateIdentityEnvelope(input,identity);
 if(!validation.passed)throw error('IDENTITY_NOT_VALIDATED');
 const messages=[{role:'system',content:REVIEW_SYSTEM},{role:'user',content:JSON.stringify({scope:'prospective independent verification of archived host-orchestrated finance output; no production route completion implied',source,sourceSha256:identity.digests.sourceRawUtf8.value,sourceIdentity:identity,request,financePlan,calculatorReceipt:receipt,archivedClaims})}];
 return {messages,identity};
}
export function validateReceiptReview(output,{source,financePlan,receipt,identity}){
 const identityResult=validateIdentityEnvelope({source,financePlan,receipt},identity);
 if(!identityResult.passed)return {passed:false,issues:identityResult.issues,scope:'offline typed digest protocol validation failed'};
 return validateV1(output,{source,receipt,sourceSha256:identity.digests.sourceRawUtf8.value});
}
