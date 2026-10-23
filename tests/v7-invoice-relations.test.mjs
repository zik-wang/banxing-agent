import test from 'node:test';import assert from 'node:assert/strict';
import {makeSource,sourceRelations,extractRelationCandidates,validateCandidate,resolveFields,FIELDS} from '../invoice-evidence.mjs';
import {parseInvoiceTables} from '../invoice-relations.mjs';
import {annotateFieldDispositions,planSemanticRecovery,monetaryConsistency,modelFailureKind} from '../invoice-disposition.mjs';
const source=(text,metadata={})=>makeSource({id:'fixture-document',sha256:'fixture-sha'},'ocr',text,{page:1,...metadata});
const graph=s=>sourceRelations(s).relations;
const field=(s,f)=>graph(s).filter(r=>r.field===f&&r.validationStatus==='supported');
const accepted=(s,f,value)=>validateCandidate({field:f,value,sourceId:s.id,quote:String(value)},[s],{recovery:true});
const positioned=(items)=>{const text=items.map(i=>i.text).join('\n');return source(text,{spatialRecords:items.map((i,n)=>({blockIndex:n,...i,coordinateSystem:'normalized_0_1'}))});};

for(const label of ['Invoice From','Bill From','Issued By','Vendor','Seller','Supplier','销售方'])test('explicit issuing-party relation '+label,()=>{
 const s=source(label+': Example Labs');assert.equal(field(s,'seller')[0]?.value,'Example Labs');assert(accepted(s,'seller','Example Labs').accepted);
});
for(const label of ['Bill To','Billed To','Sold To','Customer','购买方'])test('explicit customer relation '+label,()=>{const s=source(label+': Example Customer');assert.equal(field(s,'buyer')[0]?.value,'Example Customer');});
test('recipient section crosses OCR block into first table cell and retains both raw spans',()=>{
 const s=positioned([{text:'账单',bbox:[.05,.03,.15,.06]},{text:'收票人',bbox:[.4,.15,.48,.18]},{text:'<table><tr><td>ACME CUSTOMER</td></tr><tr><td>12 Street Road</td></tr></table>',bbox:[.4,.19,.65,.3]}]);
 const r=field(s,'buyer')[0];assert.equal(r.value,'ACME CUSTOMER');assert.equal(r.businessRole,'invoice_recipient');assert.equal(r.paymentIdentityConfirmed,false);assert.equal(r.relationMethod,'section_scope');assert.equal(r.labelEvidence.length,1);assert.equal(r.valueEvidence[0].quote,'ACME CUSTOMER');
 for(const e of r.evidenceSpans)assert.equal(s.text.slice(e.start,e.end),e.quote);
});
test('two competing neighbouring entity blocks do not bind the label',()=>{
 const s=positioned([{text:'Bill To',bbox:[.2,.1,.5,.15]},{text:'Company One',bbox:[.2,.16,.35,.2]},{text:'Company Two',bbox:[.36,.16,.5,.2]}]);assert.equal(field(s,'buyer').length,0);
});
test('same-row Chinese party labels stay in their own adjacent cells',()=>{
 const s=source('<table><tr><td>购买方信息</td><td>名称:甲方科技有限公司 税号:111</td><td>销售方信息</td><td>名称:乙方服务有限公司 税号:222</td></tr></table>');assert.equal(field(s,'buyer')[0].value,'甲方科技有限公司');assert.equal(field(s,'seller')[0].value,'乙方服务有限公司');
});
test('bank account name and seller bank label are not seller entities',()=>{
 const s=source('形式发票\n账户名称：Example Holdings\n<table><tr><td>销方开户银行:Example Bank; 银行账号:123456</td></tr></table>');assert.equal(field(s,'seller').length,0);assert.equal(accepted(s,'seller','Example Holdings').accepted,false);
});
test('consignee and payer observations do not become buyer or prove payment',()=>{
 const s=source('Delivery Note\nShip To: Example Warehouse\nPayer: Example Person');assert.equal(field(s,'buyer').length,0);assert(graph(s).some(r=>r.businessRole==='consignee'));assert.equal(accepted(s,'buyer','Example Warehouse').accepted,false);
});
test('footer purchase-copy text is not a buyer name',()=>{for(const tail of ['扣税凭证','抵扣联','记账凭证','报销凭证']){const s=source('购买方'+tail);assert.equal(field(s,'buyer').length,0);assert.equal(accepted(s,'buyer',tail).accepted,false);}});
test('arbitrary entity occurrence does not establish any party role',()=>{const s=source('Note: Example Labs participated in this project.');assert.equal(field(s,'seller').length,0);});
function invoicePane({email='billing@examplelabs.com',mark='ExampleLabs AI',caption='ExampleLabs'}={}){
 return positioned([{text:'Invoice',bbox:[.04,.03,.15,.06]},{text:mark,bbox:[.75,.04,.95,.08]},{text:'Invoice No: ABC-123',bbox:[.04,.09,.28,.11]},{text:caption,bbox:[.04,.16,.17,.18]},{text:'<table><tr><td>12 Main Street</td></tr><tr><td>'+email+'</td></tr></table>',bbox:[.04,.19,.3,.29]},{text:'Bill To',bbox:[.4,.16,.48,.18]},{text:'<table><tr><td>Customer Limited</td></tr><tr><td>8 Other Road</td></tr></table>',bbox:[.4,.19,.65,.29]}]);
}
test('generic invoice issuer template uses header/contact/domain/recipient together',()=>{const s=invoicePane(),r=field(s,'seller')[0];assert.equal(r.value,'ExampleLabs');assert.equal(r.relationMethod,'document_template');assert(r.labelEvidence.length>=5);});
test('issuer template rejects unrelated email domain',()=>{const s=invoicePane({email:'help@other.example'});assert.equal(field(s,'seller').length,0);});
test('issuer template rejects absent matching header mark',()=>{const s=invoicePane({mark:'Partner logo'});assert.equal(field(s,'seller').length,0);});
test('unlabelled side company alone cannot satisfy issuer template',()=>{const s=positioned([{text:'Invoice',bbox:[0,0,.2,.1]},{text:'Random Business',bbox:[.1,.2,.3,.3]}]);assert.equal(field(s,'seller').length,0);});
test('rowspan and colspan preserve explicit column coordinates',()=>{
 const t=parseInvoiceTables('<table><tr><td rowspan="2">party</td><td colspan="2">amount</td></tr><tr><td>3</td><td>4</td></tr></table>')[0];assert.equal(t.rows[1][0].col,1);assert.equal(t.rows[1][1].col,2);assert.equal(t.rows[0][1].colspan,2);assert.equal(t.error,null);
});
test('HTML pathological column spans are quarantined within limits',()=>{assert.equal(parseInvoiceTables('<table><tr><td colspan="1000000">bad</td></tr></table>')[0].error,'cell_geometry_budget_exceeded');});
test('nested tables do not create flattened monetary relations',()=>{const s=source('<table><tr><td><table><tr><td>税额</td><td>1.00</td></tr></table></td></tr></table>');assert.equal(field(s,'tax').length,0);});
const vat=(summary='合计 ¥120.25 ¥7.22',header='项目名称 数量 单价 金额 税率/征收率 税额')=>'电子发票（普通发票）\n<table><tr><td colspan="7">'+header+'</td></tr><tr><td colspan="7">'+summary+'</td></tr><tr><td>价税合计(大写)</td><td>壹佰贰拾柒元肆角柒分 (小写)¥127.47</td></tr></table>';
test('collapsed VAT summary requires header order plus separate tax-inclusive total',()=>{
 const s=source(vat());assert.equal(field(s,'subtotal')[0].value,12025);assert.equal(field(s,'tax')[0].value,722);assert.equal(field(s,'total')[0].value,12747);assert.equal(field(s,'subtotal')[0].extractionKind,'explicitly_extracted');
});
test('two arbitrary amounts cannot become subtotal and tax without VAT headers',()=>{const s=source(vat('合计 ¥120.25 ¥7.22','备注'));assert.equal(field(s,'subtotal').length,0);assert.equal(field(s,'tax').length,0);});
test('an extra number invalidates collapsed two-column VAT association',()=>{const s=source(vat('合计 ¥120.25 ¥7.22 ¥90.00'));assert.equal(field(s,'subtotal').length,0);});
test('swapped/unknown flattened column order is not silently repaired',()=>{const s=source(vat('合计 ¥120.25 ¥7.22','税额 金额 税率'));assert.equal(field(s,'subtotal').length,0);});
test('explicit summary columns ignore unit price and quantity in detail rows',()=>{
 const s=source('<table><tr><td>项目</td><td>数量</td><td>单价</td><td>金额</td><td>税额</td></tr><tr><td>Service</td><td>2</td><td>50.00</td><td>100.00</td><td>6.00</td></tr><tr><td colspan="3">合计</td><td>100.00</td><td>6.00</td></tr></table>');
 assert.equal(field(s,'subtotal')[0].value,10000);assert.equal(field(s,'tax')[0].value,600);const observations=sourceRelations(s).observations;assert(observations.some(o=>o.role==='unitPrice'&&!o.adoptedAsSummary));assert(observations.some(o=>o.role==='quantity'&&!o.adoptedAsSummary));assert.equal(accepted(s,'total','50.00').accepted,false);
});
test('table header Tax followed by a detail row does not imply document tax',()=>{const s=source('<table><tr><td>Item</td><td>Amount</td><td>Tax</td></tr><tr><td>ABC</td><td>50.00</td><td>3.00</td></tr></table>');assert.equal(field(s,'tax').length,0);assert.equal(accepted(s,'tax','3.00').accepted,false);});
test('HTML Tax Total is tax, never a substring total; Grand Total stays total',()=>{const s=source('<table><tr><td>Tax Total: US$6.00</td></tr><tr><td>Grand Total: US$106.00</td></tr></table>');assert.equal(accepted(s,'total','6.00').accepted,false);assert.equal(accepted(s,'tax','6.00').accepted,true);assert.equal(accepted(s,'total','106.00').accepted,true);});
test('summary spacers retain labeled amount-column relation',()=>{const s=source('<table><tr><td></td><td>Subtotal</td><td></td><td>US$12.34</td></tr></table>');assert.equal(field(s,'subtotal')[0].value,1234);assert.equal(field(s,'currency')[0].value,'USD');});
test('printed paid amount is separate from total and not proof of transaction',()=>{const s=source('<table><tr><td>Amount Paid</td><td>US$5.00</td></tr></table>');assert.equal(field(s,'paid')[0].value,500);assert.equal(field(s,'total').length,0);assert.equal(accepted(s,'paymentStatus','paid').accepted,false);});
test('unknown small-write prefix leaves numeric value intact and currency unverified',()=>{
 const s=source('(小写) 夹789.15',{targetFields:['subtotal'],layoutRecords:[{text:'(小写) 夹789.15',bbox:[.1,.2,.5,.3]}]});const r=field(s,'total')[0];assert.equal(r.value,78915);assert.equal(r.uncertainPrefix,'夹');assert.equal(accepted(s,'total','789.15').accepted,true);assert.equal(field(s,'currency').length,0);assert.equal(accepted(s,'currency','CNY').accepted,false);
});
test('no numeric repair through OCR O/0 substitutions',()=>{const s=source('(小写) 夹789.OO');assert.equal(field(s,'total').length,0);});
test('actual printed small-write currency prefix is separately supported without OCR substitution',()=>{const s=source('(小写)¥789.15',{targetFields:['total','currency'],layoutRecords:[]});assert.equal(accepted(s,'total','789.15').accepted,true);assert.equal(accepted(s,'currency','CNY').accepted,true);assert.equal(field(s,'currency')[0].valueEvidence[0].quote,'¥789.15');});
test('unknown prefix in an unrelated field does not authorize cross-region values',()=>{const s=source('Tax 9.50',{targetFields:['buyer'],layoutRecords:[{text:'Tax 9.50'}]});assert.equal(accepted(s,'tax','9.50').reason,'outside_recovery_scope');});
test('competing structured party values stay conflicted without last-writer win',()=>{const a=source('Seller: Alpha Limited'),b=makeSource({id:'fixture-document',sha256:'fixture-sha'},'vision','Seller: Beta Limited');const rows=[...extractRelationCandidates(a),...extractRelationCandidates(b)].map(raw=>validateCandidate(raw,[a,b]));assert.equal(resolveFields(rows).seller.status,'conflict');});
test('delivery document number is independently typed and invoice number not applicable',()=>{
 const s=source('送(销)货单 1234567');assert.equal(field(s,'documentNumber')[0].value,'1234567');assert.equal(accepted(s,'invoiceNumber','1234567').reason,'field_not_applicable');
});
test('dispositions distinguish located role failure, incomplete coverage and applicability',()=>{
 const s=source('送货单 1234567\nExample Name'),fields=resolveFields([]);fields.documentType.value='delivery_note';const record=annotateFieldDispositions({fields,sources:[s],candidates:[{id:'c1',raw:{field:'seller'},result:{accepted:false,reason:'semantic_role_conflict',evidence:{quote:'Example Name'}}}],coverage:{status:'partial'},failures:[]});assert.equal(record.fields.invoiceNumber.disposition,'not_applicable');assert.equal(record.fields.seller.disposition,'role_unverified');assert.equal(record.fields.tax.disposition,'not_inspected');
});
test('upstream model timeout stays alongside source disposition',()=>{
 const fields=resolveFields([]),record=annotateFieldDispositions({fields,sources:[source('some text')],candidates:[],coverage:{status:'complete'},failures:[{id:'failure1',code:'MODEL_CALL_FAILED',phase:'initial',category:'timeout',fields:['seller'],detail:'actual timeout'}]});assert.equal(record.fields.seller.disposition,'not_present');assert.equal(record.fields.seller.upstreamFailures[0].category,'timeout');assert.equal(record.fields.buyer.upstreamFailures.length,0);
});
test('reader failure without sources is unreadable rather than absent',()=>{const record=annotateFieldDispositions({fields:resolveFields([]),candidates:[],sources:[],coverage:{status:'partial'},failures:[{code:'OCR_FAILED'}]});assert.equal(record.fields.total.disposition,'unreadable');});
test('router skips payment proof and already-attempted company ROI',()=>{
 const fields=resolveFields([]),routes=planSemanticRecovery({fields,candidates:[],sources:[source('old crop',{roiId:'r1',targetFields:['seller']}),positioned([{text:'金额合计',bbox:[.1,.2,.3,.25]}])],focus:['seller','paymentStatus','total']});assert.equal(routes[0].allowOcr,false);assert.equal(routes[0].action,'semantic_review_no_repeat');assert.equal(routes[1].action,'needs_human_review');assert.equal(routes[2].allowOcr,true);
});
test('router resolves existing supported fields before proposing OCR',()=>{const fields=resolveFields([]);fields.total={status:'supported',value:123,choices:[]};assert.equal(planSemanticRecovery({fields,candidates:[],sources:[],focus:['total']})[0].allowOcr,false);});
test('exact minor-unit arithmetic is consistency only, never missing field extraction',()=>{
 const fields=resolveFields([]);fields.subtotal.value=10;fields.tax.value=20;fields.total.value=30;const c=monetaryConsistency(fields);assert.equal(c.status,'consistent');assert.equal(c.derived[0].kind,'deterministically_derived');assert.equal(c.derived[0].adoptedAsPrintedField,false);fields.subtotal.value=null;assert.equal(monetaryConsistency(fields).status,'unverified');assert.equal(fields.subtotal.value,null);
});
for(const [message,kind]of [['模型处理超时','timeout'],['Connection error.','network'],['Stream ended without finish_reason','incomplete_model_output'],['JSON schema invalid','structured_protocol'],['模型未完成：aborted','interrupted']])test('failure cause retained: '+kind,()=>assert.equal(modelFailureKind(Error(message)),kind));
