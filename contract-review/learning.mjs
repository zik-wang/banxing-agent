import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {atomic} from '../v8-tools/resource-space.mjs';
import {CHECKS} from './rules.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
export function evaluateLearningRule(rule,content){return rule.triggerTerms.every(t=>content.includes(t))&&!rule.safeguardTerms.some(t=>content.includes(t));}
export class ReviewLearning{
 constructor(root){this.file=path.join(root,'review-learning.json');fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(this.file))atomic(this.file,{schemaVersion:1,revision:1,feedback:[],candidates:[],events:[]});}
 load(){const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(d.schemaVersion!==1)fail('反馈数据版本不支持');return d;}
 save(d){d.revision++;atomic(this.file,d);return structuredClone(d);}
 feedback(input,source){if(!['accepted','rejected','corrected','irrelevant','insufficient_evidence'].includes(input.decision)||!text(input.comment,3000))fail('请填写反馈类型和具体依据');
  const d=this.load(),item={id:randomUUID(),createdAt:new Date().toISOString(),decision:input.decision,comment:input.comment,...structuredClone(source)};d.feedback.push(item);
  const candidate={id:randomUUID(),feedbackId:item.id,state:'draft',version:1,title:source.title||'合同审核改进候选',guidance:input.comment,checkId:source.checkIds?.[0]||CHECKS[0].id,triggerTerms:[],safeguardTerms:[],tests:[],testReceipt:null,createdAt:item.createdAt};d.candidates.push(candidate);d.events.push({action:'feedback_and_candidate_created',feedbackId:item.id,candidateId:candidate.id,at:item.createdAt});this.save(d);return {feedback:item,candidate};
 }
 update(id,input){const d=this.load(),c=d.candidates.find(c=>c.id===id);if(!c)fail('候选不存在',404);if(input.expectedVersion!==c.version)fail('候选版本已变化',409);if(c.state==='active')fail('已启用规则不可原地改写；先停用并创建新候选',409);
  if(!CHECKS.some(x=>x.id===input.checkId)||!text(input.guidance,2000))fail('请选择必审项并填写指导');for(const key of ['triggerTerms','safeguardTerms'])if(!Array.isArray(input[key])||input[key].length>12||input[key].some(t=>!text(t,80)))fail('条件词须为最多12个非空短语');if(!input.triggerTerms.length)fail('至少一个触发短语');
  if(!Array.isArray(input.tests)||input.tests.length<4||input.tests.length>40||input.tests.some(t=>!text(t.text,4000)||typeof t.expected!=='boolean')||input.tests.filter(t=>t.expected).length<2||input.tests.filter(t=>!t.expected).length<2||new Set(input.tests.map(t=>t.text)).size!==input.tests.length)fail('至少提供2个正例和2个反例，各例须不同，expected为布尔值');
  Object.assign(c,{checkId:input.checkId,guidance:input.guidance,triggerTerms:input.triggerTerms,safeguardTerms:input.safeguardTerms,tests:input.tests,state:'draft',testReceipt:null,version:c.version+1});this.save(d);return c;
 }
 test(id){const d=this.load(),c=d.candidates.find(c=>c.id===id);if(!c||!c.triggerTerms.length||c.tests.length<4)fail('请先配置候选规则和正反测试');if(c.state==='active')fail('已启用版本不可修改测试记录',409);const rows=c.tests.map(t=>({textSha256:digest(t.text),expected:t.expected,actual:evaluateLearningRule(c,t.text)})),passed=rows.every(r=>r.actual===r.expected);
  c.testReceipt={id:randomUUID(),at:new Date().toISOString(),candidateVersion:c.version,fingerprint:digest({guidance:c.guidance,checkId:c.checkId,triggerTerms:c.triggerTerms,safeguardTerms:c.safeguardTerms,tests:c.tests}),rows,passed,kind:'deterministic_positive_negative_examples',semanticQualityProven:false};c.state=passed?'tested':'test_failed';d.events.push({action:'tested',candidateId:id,receiptId:c.testReceipt.id,passed,at:c.testReceipt.at});this.save(d);return c;
 }
 activate(id,input){const d=this.load(),c=d.candidates.find(c=>c.id===id);if(!c)fail('候选不存在',404);if(input.expectedVersion!==c.version)fail('候选版本已变化',409);const r=c.testReceipt;if(c.state!=='tested'||!r?.passed||r.candidateVersion!==c.version||r.fingerprint!==digest({guidance:c.guidance,checkId:c.checkId,triggerTerms:c.triggerTerms,safeguardTerms:c.safeguardTerms,tests:c.tests}))fail('必须通过当前版本正反例测试后才能启用');c.state='active';c.activatedAt=new Date().toISOString();d.events.push({action:'human_activated',candidateId:id,testReceiptId:r.id,at:c.activatedAt});this.save(d);return c;}
 disable(id){const d=this.load(),c=d.candidates.find(c=>c.id===id);if(!c)fail('候选不存在',404);c.state='disabled';d.events.push({action:'disabled',candidateId:id,at:new Date().toISOString()});this.save(d);return c;}
 active(){const d=this.load();return {revision:d.revision,rules:d.candidates.filter(c=>c.state==='active').map(c=>({id:c.id,version:c.version,checkId:c.checkId,guidance:c.guidance,triggerTerms:c.triggerTerms,safeguardTerms:c.safeguardTerms,feedbackId:c.feedbackId,testReceiptId:c.testReceipt.id}))};}
}
export function learningHints(active,units){return (active?.rules||[]).flatMap(r=>units.filter(u=>evaluateLearningRule(r,u.raw_text)).map(u=>({ruleId:r.id,ruleVersion:r.version,check_id:r.checkId,unit_id:u.id,guidance:r.guidance,state:'candidate_hint_only',testReceiptId:r.testReceiptId})));}
