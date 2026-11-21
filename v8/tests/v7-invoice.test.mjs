import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {Store} from '../src/runtime/core.mjs';
import {Harness} from '../src/runtime/runtime.mjs';
import {Workspace} from '../src/workspace/workspace.mjs';
import {resolveArtifact} from '../src/documents/artifacts.mjs';
import {FIELDS,canonical,makeSource,locate,extractLabeled,validateCandidate,resolveFields,evaluateDocument,hash} from '../src/invoices/invoice-evidence.mjs';
import {assertInvoiceNetwork} from '../src/invoices/invoice-reliability.mjs';
import {validateEvidenceLedger} from '../src/invoices/invoice-delivery.mjs';

const file={id:'unit-file',sha256:'unit-sha'};
const src=(reader,text)=>makeSource(file,reader,text,{page:1});
const accepted=s=>extractLabeled(s).map(c=>validateCandidate({field:c.field,value:c.value,sourceId:s.id,quote:c.evidence.quote},[s]));
const doc=(sources)=>({fileId:file.id,originalSha256:file.sha256,fields:resolveFields(sources.flatMap(accepted)),visual:true,coverage:{status:'complete'},arithmeticIssues:[]});

test('布局归一化保留原文偏移，不能修复控制字符或数字',()=>{
  const s=src('ocr','<td>金额合计：</td><td>￥２６９２.００ 元</td>');
  const e=locate(s,'金额合计: ￥2692.00 元');assert(e);assert.equal(s.text.slice(e.start,e.end),e.quote);assert.equal(e.matchMode,'layout_normalized');
  assert.equal(locate(src('pdf_text','账单编\u0000 F5-0001'),'账单编号 F5-0001'),null);
  assert.equal(locate(src('ocr','号码 O12345'),'号码 012345'),null);
  assert.equal(locate(src('ocr','金额①'),'金额1'),null);assert.equal(resolveFields(accepted(src('ocr','金额合计：1²元'))).total.status,'missing');
});
test('金额合计/合计金额及小写标签均支持，不接受税额单价或部分金额',()=>{
  for(const text of ['金额合计: 2692 元','合计金额：￥2692.00','价税合计（小写）：￥2692.00'])assert(accepted(src('ocr',text)).some(c=>c.accepted&&c.field==='total'&&c.value===269200));
  for(const text of ['税额：2692.00','单价：2692.00','价税合计：12692.00']){const s=src('ocr',text);assert.equal(validateCandidate({field:'total',value:'2692.00',sourceId:s.id,quote:text},[s]).accepted,false);}
});
test('机器编号和发票代码不能充当发票号码，完整号码不能截断',()=>{
  const s=src('ocr','机器编号：667211950407\n发票代码：1100233130\n发票号码：26178724');
  assert.equal(validateCandidate({field:'invoiceNumber',value:'667211950407',sourceId:s.id,quote:s.text},[s]).accepted,false);
  assert.equal(validateCandidate({field:'invoiceNumber',value:'6178724',sourceId:s.id,quote:s.text},[s]).accepted,false);
  assert(accepted(s).some(c=>c.accepted&&c.field==='invoiceNumber'&&c.value==='26178724'));
});
test('真实故障形态：无标签正确号码保留，机器标签邻近数字不能作为确定票号',()=>{
  const ocr=src('ocr','26178724\n\n667211950407\n\n机器编号：\n\n1100233130'),vision=src('vision','发票号码：667211950407');
  const d=evaluateDocument({...doc([ocr,vision]),sources:[ocr,vision]});assert(d.fields.unclassifiedNumber.choices.some(c=>c.value==='26178724'));assert.equal(d.fields.invoiceNumber.value,null);assert(d.issues.some(i=>i.code==='SEMANTIC_ROLE_AMBIGUITY'));assert.equal(d.extractionStatus,'needs_review');
});
test('跨来源/伪造来源拒绝；错误引文可由程序回查真实来源修复',()=>{
  const a=src('ocr','发票号码：12345678'),b=src('vision','开票日期：2026年1月2日');
  assert.equal(validateCandidate({field:'invoiceNumber',value:'12345678',sourceId:'unauthorized',quote:a.text},[a,b]).reason,'unauthorized_source');
  assert.equal(validateCandidate({field:'date',value:'2026年1月2日',sourceId:a.id,quote:b.text},[a,b]).accepted,false);
  const repaired=validateCandidate({field:'invoiceNumber',value:'12345678',sourceId:a.id,quote:'账单编号：12345678'},[a,b]);assert(repaired.accepted);assert.equal(repaired.evidence.quote,'发票号码：12345678');assert.equal(repaired.recovery.method,'program_label_value_lookup');
});
test('视觉与OCR冲突不以多数投票覆盖，同一读取来源重复不算一致',()=>{
  const a=src('ocr','发票号码：12345678'),b=src('vision','发票号码：87654321');
  const f=resolveFields([...accepted(a),...accepted(a),...accepted(a),...accepted(b)]);assert.equal(f.invoiceNumber.status,'conflict');assert.equal(f.invoiceNumber.value,null);assert.equal(f.invoiceNumber.choices.length,2);
  assert.equal(resolveFields([...accepted(a),...accepted(a)]).invoiceNumber.status,'supported');
});
test('日期仅规范空白及格式，拒绝非法日期；$不猜USD',()=>{
  assert.equal(canonical('date','2024 年 7 月 15 日'),'2024-07-15');assert.equal(canonical('date','2026年2月30日'),null);
  assert.equal(canonical('currency','$'),null);assert.equal(canonical('currency','US$'),'USD');assert.equal(canonical('total','0.10'),10);
});
test('单据类型与资格分离；缺字段全部保留，覆盖不全阻止完成',()=>{
  const s=src('ocr','送(销)货单\n发票号码：7332240');const d=evaluateDocument(doc([s]));assert.equal(d.fields.documentType.value,'delivery_note');assert.equal(d.extractionStatus,'needs_review');assert.equal(d.eligibility.status,'not_evaluated');assert.deepEqual(Object.keys(d.fields),FIELDS);
  const partial=evaluateDocument({...doc([s]),coverage:{status:'partial'}});assert(partial.issues.some(i=>i.code==='SOURCE_COVERAGE'));
});
test('买卖方角色不可对调，服务期间不是开票日期',()=>{
  const s=src('ocr','购买方：甲方公司\n销售方：乙方公司\n服务期间：2026年1月1日');
  assert.equal(validateCandidate({field:'seller',value:'甲方公司',sourceId:s.id,quote:s.text},[s]).accepted,false);assert.equal(validateCandidate({field:'date',value:'2026年1月1日',sourceId:s.id,quote:s.text},[s]).accepted,false);
});
test('修改内网服务地址为外网在调用前拒绝',()=>{
  assert.throws(()=>assertInvoiceNetwork({directory:{services:{chat:{baseUrl:'https://external.example'}}}}),/允许范围/);
});
test('F01：损坏PDF不吞OCR，缺bbox不伪造坐标，数字冲突不丢任一方',()=>{
  const bad=src('pdf_text','账单编\u0000 AB123456\u0000 0001'),ocr=src('ocr','账单编号：AB123456-0001'),other=src('pdf_text','账单编号：AB123456-0002');
  assert.equal(bad.qualityStatus,'degraded');assert.equal(ocr.bbox,null);assert.equal(ocr.coordinateSystem,null);assert.equal(ocr.confidence,null);
  const f=resolveFields([...accepted(bad),...accepted(ocr)]);assert.equal(f.billNumber.value,'AB123456-0001');assert.equal(f.billNumber.status,'supported');
  assert.equal(resolveFields([...accepted(other),...accepted(ocr)]).billNumber.status,'conflict');
});
test('F03/F04：非连续引用及只有金额的候选能找到真实标签，反例不能放行',()=>{
  const s=src('ocr','价税合计（大写）\n壹拾圆整\n（小写）￥10.00\n金额合计：1228.00元');
  const stitched=validateCandidate({field:'total',value:'10.00',sourceId:s.id,quote:'价税合计（大写）壹拾圆整（小写）￥10.00'},[s]);assert(stitched.accepted);assert.equal(s.text.slice(stitched.evidence.start,stitched.evidence.end),stitched.evidence.quote);assert(stitched.recovery);
  const parking=validateCandidate({field:'total',value:'1228.00',sourceId:s.id,quote:'1228.00'},[s]);assert(parking.accepted);assert.match(parking.evidence.quote,/金额合计/);
  const tax=src('ocr','税额：1228.00\n合计金额：1300.00');assert.equal(validateCandidate({field:'total',value:'1228.00',sourceId:tax.id,quote:'1228.00'},[tax]).accepted,false);
});
test('日期/金额/号码角色分别存储，实付、余额和折扣不冒充总额',()=>{
  const s=src('ocr','订单号：ORD-1\n交易流水号：TXN-1\n开票日期：2026年1月2日\n付款日期：2026年1月3日\n到期日期：2026年1月4日\n实付金额：20.00\n余额：10.00\n税额：1.00\n金额合计：30.00\n折扣：-5.00\n付款状态：未付款');
  const f=resolveFields(accepted(s));assert.equal(f.orderNumber.value,'ORD-1');assert.equal(f.transactionNumber.value,'TXN-1');assert.equal(f.paymentDate.value,'2026-01-03');assert.equal(f.dueDate.value,'2026-01-04');assert.equal(f.paid.value,2000);assert.equal(f.balance.value,1000);assert.equal(f.total.value,3000);assert.equal(f.discount.value,-500);assert.equal(f.paymentStatus.value,'unpaid');
});
test('反例：Due/Payment/Transaction Date不能截取Date当开具日期，非法长日期不能截短',()=>{
  for(const label of ['Due Date','Payment Date','Transaction Date','Service Date']){const f=resolveFields(accepted(src('ocr',label+': 2026-01-20')));assert.equal(f.date.status,'missing',label);}
  assert.equal(resolveFields(accepted(src('ocr','开票日期：2026-01-200'))).date.status,'missing');
  assert.equal(resolveFields(accepted(src('ocr','Invoice No: INV-001 DATE:2026-01-20'))).date.value,'2026-01-20');
});
test('反例：Tax Total不是总额，逗号分组错误不改成确定金额',()=>{
  const f=resolveFields(accepted(src('ocr','Tax Total: ￥2.00')));assert.equal(f.total.status,'missing');assert.equal(f.tax.value,200);
  for(const value of ['1,50','12,34.50','1,2,300'])assert.equal(canonical('total',value),null);assert.equal(canonical('total','1,234.50'),123450);
});
test('反例：未知$金额不能借人民币银行账户判为CNY',()=>{
  const f=resolveFields(accepted(src('ocr','金额合计：$30.00\n人民币账户：123456')));assert.equal(f.total.value,3000);assert.equal(f.currency.status,'missing');
  assert.equal(resolveFields(accepted(src('ocr','金额合计：US$30.00'))).currency.value,'USD');
});
test('所有已发现的非必填冲突也必须进入问题清单',()=>{
  const a=src('ocr','税额：1.00'),b=src('vision','税额：2.00');const d=evaluateDocument(doc([a,b]));assert(d.issues.some(i=>i.code==='OPTIONAL_FIELD_CONFLICT'&&i.field==='tax'));assert.equal(d.extractionStatus,'needs_review');
});

const text=(number,currency='USD',amount='30.00')=>`电子发票\n发票号码：${number}\n开票日期：2026年1月2日\n购买方：甲方公司\n销售方：乙方公司\n金额合计：${currency==='USD'?'US$':'￥'}${amount}\n币种：${currency}`;
async function fixture(t,analyze=async()=>({candidates:[]})){
  // Synthetic test material stays inside the authorized project, never os.tmpdir.
  const root=path.resolve('qa-output/p1-09-tests');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'case-'));t.after(()=>{assert.equal(path.dirname(dir),root);fs.rmSync(dir,{recursive:true,force:true});});
  const store=new Store(dir),harness=new Harness(store),workspace=new Workspace(store,harness,{analyze});return {store,workspace};
}
async function execute(workspace,input){const job=workspace.start(input);while(workspace.active.has(job.id))await new Promise(r=>setTimeout(r,5));return job;}
const artifact=(store,job,name)=>resolveArtifact(store,job.id,job.artifacts.find(a=>a.name===name).id).bytes;
test('真实工作区入口：按币种汇总、保留全部字段和原件、JSON/Excel/ZIP回读',async t=>{
  const {store,workspace}=await fixture(t);const inputs=[];for(const [i,currency]of ['USD','CNY'].entries())inputs.push(await workspace.upload({name:`sample-${i}.txt`,base64:Buffer.from(text('TEST-'+i,currency)).toString('base64')}));
  const job=await execute(workspace,{scenarioId:'09',fileIds:inputs.map(f=>f.id)});assert.equal(job.error,null);assert.equal(job.totals.valid,2);assert.deepEqual(job.totals.byCurrency,{USD:3000,CNY:3000});assert.equal(job.totals.totalCents,null);
  const ledger=JSON.parse(artifact(store,job,'票据证据与字段账本.json'));validateEvidenceLedger(ledger);assert.equal(ledger.documents.length,2);for(const d of ledger.documents)assert.equal(d.eligibility.status,'not_evaluated');
  const zip=await JSZip.loadAsync(artifact(store,job,'报销材料包.zip'));for(const d of ledger.documents)assert.equal(hash(await zip.file(d.attachment).async('nodebuffer')),d.originalSha256);
  const book=new ExcelJS.Workbook();await book.xlsx.load(artifact(store,job,'报销明细.xlsx'));assert.equal(book.getWorksheet('材料总览').rowCount,3);assert.equal(book.getWorksheet('合计核验').rowCount,3);assert(job.invoiceVerification.deliveryVerified);
  const tampered=structuredClone(ledger);tampered.documents[0].fields.invoiceNumber.choices[0].evidence[0].quote='fake';assert.throws(()=>validateEvidenceLedger(tampered));
});
test('无新增来源不重复模型会话，伪造候选仍拒绝且交付待核',async t=>{
  let calls=0;const {store,workspace}=await fixture(t,async args=>{calls++;if(args.kind==='invoice-field-recovery')throw Error('fixture unavailable');return {candidates:[{field:'invoiceNumber',value:'FAKE',sourceId:'forged',quote:'invented'}]};});
  const f=await workspace.upload({name:'partial.txt',base64:Buffer.from('发票号码：TEST-1').toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[f.id]});assert.equal(job.error,null);assert.equal(job.totals.valid,0);assert.equal(job.totals.exceptions,1);assert.equal(calls,1);
  const ledger=JSON.parse(artifact(store,job,'票据证据与字段账本.json'));assert.equal(ledger.documents[0].fields.invoiceNumber.value,'TEST-1');assert(ledger.documents[0].candidates.some(c=>c.result.reason==='unauthorized_source'));assert.equal(ledger.documents[0].recovery.attempts,0);
});
test('正确候选的技术性引文修复记账，恢复预算至多一轮，重复任务确定性候选一致',async t=>{
  let calls=0;const {store,workspace}=await fixture(t,async args=>{calls++;const source=args.documents[0];return {candidates:[{field:'total',value:'30.00',sourceId:source.id,quote:'拼接的金额原文30.00'}]};});
  const f=await workspace.upload({name:'source.txt',base64:Buffer.from(text('REC-1','CNY')).toString('base64')});const a=await execute(workspace,{scenarioId:'09',fileIds:[f.id]}),b=await execute(workspace,{scenarioId:'09',fileIds:[f.id]});
  const one=JSON.parse(artifact(store,a,'票据证据与字段账本.json')).documents[0],two=JSON.parse(artifact(store,b,'票据证据与字段账本.json')).documents[0];assert(one.recovery.records.some(r=>r.successful&&r.method==='program_label_value_lookup'));assert(one.recovery.attempts<=1);assert.deepEqual(one.fields,two.fields);assert.equal(calls,2);
});
test('取消或超时后异步分析迟到不能发布交付物',async t=>{
  const {workspace}=await fixture(t,async()=>{await new Promise(r=>setTimeout(r,30));return {candidates:[]};});const f=await workspace.upload({name:'cancel.txt',base64:Buffer.from(text('STOP-1')).toString('base64')});const job=workspace.start({scenarioId:'09',fileIds:[f.id]});workspace.cancel(job.id);while(workspace.active.has(job.id))await new Promise(r=>setTimeout(r,5));assert.equal(job.status,'cancelled');assert.equal(job.artifacts.length,0);
});
test('同销售方同单号冲突整组隔离，不能只隔离后来一份',async t=>{
  const {store,workspace}=await fixture(t),files=[];for(const amount of ['30.00','40.00','30.00'])files.push(await workspace.upload({name:amount+'.txt',base64:Buffer.from(text('SAME', 'CNY',amount)).toString('base64')}));
  const job=await execute(workspace,{scenarioId:'09',fileIds:files.map(f=>f.id)});assert.equal(job.totals.valid,0);const ledger=JSON.parse(artifact(store,job,'票据证据与字段账本.json'));assert(ledger.documents.every(d=>d.issues.some(i=>i.code==='DUPLICATE_CONFLICT')));
});
test('模板追加回读及历史公式样式保护；没有币种列时外币不混填',async t=>{
  const {store,workspace}=await fixture(t),files=[];for(const [i,currency]of ['CNY','USD'].entries())files.push(await workspace.upload({name:i+'.txt',base64:Buffer.from(text('T-'+i,currency)).toString('base64')}));
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('模板');sheet.addRow(['日期','发票号码','金额（元）','对应附件']);sheet.addRow(['历史','HISTORY',{formula:'1+2',result:3},'old.pdf']);sheet.getCell('C2').numFmt='0.00';
  const tpl=await workspace.upload({name:'template.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[...files.map(f=>f.id),tpl.id],options:{templateId:tpl.id}});assert.equal(job.error,null);
  const output=new ExcelJS.Workbook();await output.xlsx.load(artifact(store,job,'填写后的报销模板.xlsx'));assert.equal(output.getWorksheet('模板').rowCount,3);assert.equal(output.getWorksheet('模板').getCell('C2').value.formula,'1+2');assert(job.warnings.some(w=>w.includes('外币未追加')));
});
test('英文小计+税额不等于总额时严格待核',async t=>{
  const {store,workspace}=await fixture(t);const f=await workspace.upload({name:'arithmetic.txt',base64:Buffer.from(text('MATH-1')+'\nSubtotal: 100.00\nTax: 10.00').toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[f.id]});assert.equal(job.totals.valid,0);const d=JSON.parse(artifact(store,job,'票据证据与字段账本.json')).documents[0];assert(d.arithmeticIssues.some(s=>s.includes('11000')));
});
test('扩大明确标签语法的定向恢复确实能更新缺失字段，不靠重复投票',async t=>{
  const {store,workspace}=await fixture(t);const f=await workspace.upload({name:'copula.txt',base64:Buffer.from(text('RECOVER-1','CNY').replace('发票号码：','发票号码为 ')).toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[f.id]});const d=JSON.parse(artifact(store,job,'票据证据与字段账本.json')).documents[0];assert.equal(d.fields.invoiceNumber.value,'RECOVER-1');assert(d.recovery.records.some(r=>r.field==='invoiceNumber'&&r.beforeStatus==='missing'&&r.afterStatus==='supported'&&r.successful));assert.equal(d.recovery.attempts,0);
});
test('第101项候选及模型未决原因保留，异常候选也有处置',async t=>{
  const {store,workspace}=await fixture(t,async()=>({candidates:[...Array.from({length:101},(_,i)=>({field:'total',value:String(i+1),sourceId:'not-authorized'})),null],unresolved:[{field:'tax',reason:'税额无法确定'}]}));const f=await workspace.upload({name:'many.txt',base64:Buffer.from(text('MANY-1')).toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[f.id]});assert.equal(job.error,null);const d=JSON.parse(artifact(store,job,'票据证据与字段账本.json')).documents[0];assert.equal(d.candidates.filter(c=>c.phase==='initial').length,102);assert(d.modelNotes.some(n=>n.reason==='税额无法确定'));assert(d.issues.some(i=>i.code==='MODEL_UNRESOLVED'));
});
test('人民币固定金额列即使有币种列也不填写USD',async t=>{
  const {store,workspace}=await fixture(t),f=await workspace.upload({name:'usd.txt',base64:Buffer.from(text('USD-1')).toString('base64')}),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('模板');sheet.addRow(['日期','发票号码','金额（元）','币种','对应附件']);const tpl=await workspace.upload({name:'yuan.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[f.id,tpl.id],options:{templateId:tpl.id}});const out=new ExcelJS.Workbook();await out.xlsx.load(artifact(store,job,'填写后的报销模板.xlsx'));assert.equal(out.getWorksheet('模板').rowCount,1);assert(job.warnings.some(w=>w.includes('外币未追加')));
});
