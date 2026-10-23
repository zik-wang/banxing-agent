import {bindInvoiceSourceGeometry} from './invoice-structure.mjs';
import {createHash} from 'node:crypto';
import {resolveSourceRelations,RELATION_VERSION} from './invoice-relations.mjs';

export const INVOICE_VERSION=RELATION_VERSION;
export const FIELDS=['documentType','invoiceNumber','documentNumber','billNumber','invoiceCode','machineNumber','orderNumber','transactionNumber','verificationCode','unclassifiedNumber','date','transactionDate','serviceDate','paymentDate','dueDate','buyer','seller','subtotal','tax','total','paid','balance','discount','amount','currency','paymentStatus'];
export const REQUIRED=['documentType','invoiceNumber','date','buyer','seller','total','currency'];
export const MONEY_FIELDS=['subtotal','tax','total','paid','balance','discount','amount'];
export const DATE_FIELDS=['date','transactionDate','serviceDate','paymentDate','dueDate'];
export const NUMBER_FIELDS=['invoiceNumber','documentNumber','billNumber','invoiceCode','machineNumber','orderNumber','transactionNumber','verificationCode','unclassifiedNumber'];
export const numberField=fields=>fields.documentType.value==='delivery_note'?'documentNumber':fields.documentType.value!=='tax_invoice'&&fields.billNumber.status!=='missing'?'billNumber':'invoiceNumber';
export const requiredFields=fields=>REQUIRED.map(f=>f==='invoiceNumber'?numberField(fields):f);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const escapeRE=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const layoutFold=text=>Array.from(text,char=>{const code=char.codePointAt(0);return code>=0xff01&&code<=0xff5e?String.fromCodePoint(code-0xfee0):char==='\u3000'?' ':char;}).join('');

// Only layout transformations are allowed. Every character maps back to raw text.
// Control characters and OCR substitutions are deliberately not repaired here.
export function normalizeWithMap(raw){
  let text='',map=[];
  const add=(s,start,end)=>{for(const char of s){if(/\s/u.test(char)){if(text.endsWith(' ')){map[map.length-1].end=end;continue;}text+=' ';map.push({start,end});}else{text+=char;for(let i=0;i<char.length;i++)map.push({start,end});}}};
  for(let i=0;i<raw.length;){
    const rest=raw.slice(i),tag=rest.match(/^<\/?[A-Za-z][^>]*>/),entity=rest.match(/^&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i);
    if(tag){add(' ',i,i+tag[0].length);i+=tag[0].length;continue;}
    if(entity){const name=entity[1],known={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};let value=known[name];if(value===undefined){const n=name[1]?.toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));value=Number.isInteger(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):entity[0];}add(layoutFold(value),i,i+entity[0].length);i+=entity[0].length;continue;}
    const ch=String.fromCodePoint(raw.codePointAt(i));add(layoutFold(ch).replace(/[‐‑–−]/g,'-'),i,i+ch.length);i+=ch.length;
  }
  return {text,map};
}
export const prepareInvoiceSources=bindInvoiceSourceGeometry;
export function makeSource(file,reader,text,metadata={}){
  const id=hash(file.id+'|'+reader+'|'+(metadata.page||'')+'|'+(metadata.roiId?metadata.roiId+'|':'')+hash(text)).slice(0,24),qualityStatus=!text.trim()?'unusable':/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)?'degraded':'unknown';
  return {id,fileId:file.id,originalSha256:file.sha256,reader,sourceType:reader,text,textSha256:hash(text),textSpan:{start:0,end:text.length},page:null,recognitionRunId:metadata.recognitionRunId||'content-'+id,qualityStatus,qualityBasis:'启发式：空白/控制字符检测，不是正确概率',parserOrModel:metadata.model||reader,rawOutputRef:{container:'票据证据与字段账本.json',documentFileId:file.id,sourceId:id,scope:'embedded unmodified adapter text; transport payload not recorded'},offsetUnit:'UTF-16 code units',spanBase:'EvidenceSource.text (unmodified)',pageNumbering:'1-based; null means not recorded',bbox:null,coordinateSystem:null,confidence:null,...metadata};
}
export function locate(source,quote){
  if(typeof quote!=='string'||!quote.trim())return null;
  let start=source.text.indexOf(quote),end=start+quote.length,mode='exact';
  if(start<0){const norm=normalizeWithMap(source.text),q=normalizeWithMap(quote).text.trim(),at=norm.text.indexOf(q);if(!q||at<0||norm.text.indexOf(q,at+1)>=0)return null;start=norm.map[at].start;end=norm.map[at+q.length-1].end;mode='layout_normalized';}
  return {sourceId:source.id,reader:source.reader,originalSha256:source.originalSha256,textSha256:source.textSha256,start,end,quote:source.text.slice(start,end),matchMode:mode,page:source.page??null,line:source.text.slice(0,start).split('\n').length,model:source.model||null};
}
export function canonical(field,value){
  let text=layoutFold(String(value??'')).replace(/[‐‑–−]/g,'-').trim();
  if(!text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return null;
  if(MONEY_FIELDS.includes(field)){
    text=text.replace(/^(?:US\$|USD|EUR|GBP|CNY|RMB|[￥¥$€£])\s*/i,'').replace(/\s*(?:元|美元)$/,'');
    if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)||field==='total'&&text.startsWith('-'))return null;
    text=text.replace(/,/g,'');
    const negative=text.startsWith('-'),[whole,frac='']=text.replace(/^-/,'').split('.'),n=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));return n<=999999999999n?Number(negative?-n:n):null;
  }
  if(DATE_FIELDS.includes(field)){
    const m=text.match(/^(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?$/);if(!m)return null;
    const [y,mo,d]=m.slice(1).map(Number),dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  if(field==='currency'){if(/^(?:CNY|RMB|人民币|￥|¥|元)$/i.test(text))return 'CNY';if(/^(?:USD|US\$|美元)$/i.test(text))return 'USD';if(/^(?:EUR|欧元|€)$/i.test(text))return 'EUR';if(/^(?:GBP|英镑|£)$/i.test(text))return 'GBP';return null;}
  if(NUMBER_FIELDS.includes(field))return /^[A-Za-z0-9][A-Za-z0-9.\/-]{2,79}$/.test(text)?text:null;
  if(field==='documentType')return ['tax_invoice','proforma','delivery_note','bill','unknown'].includes(text)?text:null;
  if(field==='paymentStatus')return ['paid','unpaid','unknown'].includes(text)?text:null;
  if(['buyer','seller'].includes(field)&&/^(?:原标签|原值|字段值|候选字段)\s*[:：]/.test(text))return null;
  if(['buyer','seller'].includes(field)&&/^(?:未知|不详|未识别|无法识别|无法辨认|看不清|未提供|未注明|未填写|空白|无|unknown|n\/a|not\s+(?:available|provided|specified)|unreadable|blank|none|[-—]+)[。.!！?？]?$/i.test(text))return null;
  return text.length<=200?text:null;
}
const ROLE={
  documentNumber:'单据编号|送货单号|销货单号|送销货单号|Document\\s*(?:No\\.?|Number)',
  invoiceNumber:'发票号码|发票号(?!码)|票据号码|票据号(?!码)|Invoice\\s*(?:No\\.?|Number)|Invoice\\s*#',
  billNumber:'账单编号|账单号码|账单号(?!码)|Bill\\s*(?:No\\.?|Number)',
  invoiceCode:'发票代码',machineNumber:'机器编号|机器号码|机打号码',
  orderNumber:'订单编号|订单号码|订单号|Order\\s*(?:No\\.?|Number|#)',
  transactionNumber:'交易编号|交易流水号|流水号|Transaction\\s*(?:ID|No\\.?|Number)',verificationCode:'校验码|校验号码|Verification\\s*Code',
  date:'开票日期|发票日期|出具日期|发出日期|出票日期|Invoice\\s*Date|Issue\\s*Date|Issued\\s*(?:on)?|(?<![A-Za-z])DATE',
  transactionDate:'交易日期|Transaction\\s*Date',serviceDate:'服务日期|Service\\s*Date',paymentDate:'付款日期|支付日期|Payment\\s*Date|Paid\\s*on',dueDate:'到期日期|到期日|付款期限|Due\\s*Date',
  buyer:'购买方(?:名称|信息)?|购方(?:名称)?|买方(?:名称)?|Customer|Bill\\s*to',
  seller:'销售方(?:名称|信息)?|销方(?:名称)?|卖方(?:名称)?|供应商|商户|Seller|Vendor',
  total:'价税合计(?:\\s*[（(]大写[）)])?|[（(]小写[）)]|小写|含税总额|含税合计|报销金额|总金额|合计金额|金额合计|应付金额|Amount\\s*Due|Total\\s*Due|Grand\\s*Total|(?<![A-Za-z])Total(?![A-Za-z])',
  subtotal:'不含税金额|不含税合计|税前金额|小计|Subtotal',tax:'(?<!价)税额|Tax\\s*(?:Amount|Total)?',paid:'实付金额|已付金额|支付金额|Amount\\s*Paid',balance:'未付余额|剩余应付|余额|Balance',discount:'折扣金额|折扣|优惠金额|Discount',amount:'金额待定|未分类金额',
};
const TOTAL='(?:US\\$|USD|EUR|GBP|CNY|RMB|[￥¥$€£])?\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.,])';
const VALUE={invoiceNumber:'([A-Za-z0-9][A-Za-z0-9.\\/-]{2,79})(?![A-Za-z0-9.\\/-])',invoiceCode:'([0-9]{6,20})(?![0-9])',machineNumber:'([A-Za-z0-9-]{3,40})(?![A-Za-z0-9-])',date:'(\\d{4}\\s*[-年/.]\\s*\\d{1,2}\\s*[-月/.]\\s*\\d{1,2}(?!\\d)\\s*日?)(?![\\d年/月.])',total:TOTAL};
for(const field of NUMBER_FIELDS.filter(f=>f!=='unclassifiedNumber'))VALUE[field]||=VALUE.invoiceNumber;
for(const field of DATE_FIELDS)VALUE[field]||=VALUE.date;
for(const field of MONEY_FIELDS)VALUE[field]||=TOTAL.replace('(\\d','(-?\\d');
export function extractLabeled(source,{recovery=false}={}){
  const norm=normalizeWithMap(source.text),out=[];
  const emit=(field,value,start,end,role)=>{const a=norm.map[start]?.start,b=norm.map[end-1]?.end;if(a===undefined||b===undefined)return;const evidence=locate(source,source.text.slice(a,b));if(evidence)out.push({field,value,evidence,role,origin:'program_label'});};
  for(const [field,pattern]of Object.entries(VALUE)){
    const re=new RegExp('('+ROLE[field]+')\\s*'+(recovery?'(?:[:：#]|为|是|=)?':'[:：#]?')+'\\s*'+pattern,'gi');
    for(const m of norm.text.matchAll(re)){
      const rawStart=norm.map[m.index]?.start,prefix=source.text.slice(0,rawStart).split(/\r?\n/).at(-1).replace(/<[^>]*>/g,' ');
      if(field==='total'&&/小写/.test(m[1])&&/(?:税额|Tax(?:\s*Amount)?|Balance|余额|折扣|Discount|单价|Unit\s*Price)\s*[:：]?\s*$/i.test(prefix))continue;
      // Bare Date/Total may not be stolen from a compound English role label.
      if((field==='date'&&/^date$/i.test(m[1])||field==='total'&&/^total$/i.test(m[1]))&&/\b[A-Za-z]+\s+$/.test(prefix))continue;
      if(/[\p{N}]/u.test(norm.text[m.index+m[0].length]||''))continue;
      emit(field,m[2],m.index,m.index+m[0].length,'explicit_'+field);
    }
  }
  for(const field of ['buyer','seller']){
    // Entity names end at the next role/registration/bank label. No arbitrary
    // "name occurs somewhere in the document" acceptance.
    const re=new RegExp('(?:'+ROLE[field]+')\\s*[:：]?\\s*(?:名称\\s*[:：]?\\s*)?([^\\n]{2,200})','gi');
    for(const m of norm.text.matchAll(re)){
      // A role-like word can be part of the entity name (Customer Org).
      // Inline single-word English labels require a delimiter; separate
      // label/value blocks are handled by the structured relation resolver.
      if(/^(?:Customer|Seller|Vendor)\s+(?![:：])/i.test(m[0])&&!/^(?:Customer|Seller|Vendor)\s*[:：]/i.test(m[0]))continue;
      const valueStart=m.index+m[0].indexOf(m[1]);let segment=m[1];
      for(let k=0;k<segment.length;k++){const at=norm.map[valueStart+k]?.start;if(at!==undefined&&/[\r\n]/.test(source.text.slice(at,norm.map[valueStart+k]?.end))){segment=segment.slice(0,k);break;}}
      const part=segment.split(/购买方|销售方|统一社会信用代码|纳税人识别号|税号|Invoice|DATE|Date|开票日期|金额合计|合计金额|价税合计|币种|开户行|银行账号|\s{2,}/)[0].trim();
      if(part.length>=2&& !/^(?:(?:扣税|记账|抵扣|报销)(?:凭证|联)|信息|名称|未|不|无|待|未知|看不清|[（(])/.test(part))emit(field,part,m.index,m.index+m[0].indexOf(m[1])+part.length,'explicit_'+field);
    }
  }
  const currencyToken='US\\$|USD|美元|CNY|RMB|人民币|[￥¥]|EUR|欧元|€|GBP|英镑|£|元';
  for(const m of norm.text.matchAll(new RegExp('(?:币种|Currency)\\s*[:：]?\\s*('+currencyToken+')(?![A-Za-z])','gi'))){if(documentCurrencyContext(source,norm.map[m.index]?.start??0))emit('currency',m[1],m.index,m.index+m[0].length,'document_currency');}
  // Currency must describe a labeled total or an explicit document currency.
  // Bank-account descriptions and unrelated body text are never currency proof.
  for(const c of out.filter(c=>c.field==='total')){
    const quote=normalizeWithMap(c.evidence.quote).text,at=norm.text.indexOf(quote),prefix=quote.match(new RegExp('('+currencyToken+')\\s*'+escapeRE(c.value)+'$','i')),tail=norm.text.slice(at+quote.length).match(new RegExp('^\\s*('+currencyToken+')(?![A-Za-z\u4e00-\u9fff])','i'));
    if(prefix)emit('currency',prefix[1],at,at+quote.length,'total_currency');
    if(at>=0&&tail)emit('currency',tail[1],at,at+quote.length+tail[0].length,'total_currency');
  }
  for(const [word,status]of [['已付款','paid'],['已支付','paid'],['未付款','unpaid'],['未支付','unpaid']])for(const m of norm.text.matchAll(new RegExp('(?:付款状态|支付状态)\\s*[:：]?\\s*'+word,'g')))emit('paymentStatus',status,m.index,m.index+m[0].length,'printed_payment_status');
  const types=[['proforma',/形式发票|Pro\s*forma\s*Invoice/gi],['delivery_note',/送\s*[（(]?销[）)]?\s*货单|送货单|销货单|Delivery\s*Note/gi],['tax_invoice',/电子发票|增值税.*?发票|普通发票|专用发票/gi],['bill',/账单|Invoice|发票/gi]];
  // The fallback "bill" is suppressed when a more specific type exists in this reader.
  for(const [type,re]of types){const matches=[...norm.text.matchAll(re)];if(matches.length){for(const m of matches)emit('documentType',type,m.index,m.index+m[0].length,'document_heading');if(type!=='bill')break;}}
  const known=new Set(out.filter(c=>NUMBER_FIELDS.includes(c.field)).map(c=>c.value));
  // Unlabelled OCR tokens remain visible without guessing their role by length.
  // These are plural, unclassified observations, never verified invoice numbers.
  for(const m of norm.text.matchAll(/(?<![A-Za-z0-9.])([A-Za-z0-9][A-Za-z0-9/-]{5,39})(?![A-Za-z0-9.])/g))if(/\d/.test(m[1])&&!known.has(m[1]))emit('unclassifiedNumber',m[1],m.index,m.index+m[0].length,'unknown_number_role');
  return out;
}
function documentCurrencyContext(source,start){const prefix=source.text.slice(0,start).split(/\r?\n|<\/t[dh]>/i).at(-1).replace(/<[^>]*>/g,' ');return !/(?:bank|account|银行|账户|开户|Tax|税额|Unit\s*Price|单价|Subtotal|小计)/i.test(prefix);}
const relationCache=new WeakMap();
export function sourceRelations(source){
  const old=relationCache.get(source),records=source.layoutRecords||source.spatialRecords;
  if(old&&old.text===source.text&&old.records===records)return old.graph;
  const graph=resolveSourceRelations(source,{canonical,locate,normalizeWithMap});relationCache.set(source,{text:source.text,records,graph});return graph;
}
export function extractRelationCandidates(source){
 return sourceRelations(source).relations.filter(r=>FIELDS.includes(r.field)&&r.validationStatus==='supported'&&(!source.targetFields||source.targetFields.includes(r.field)||r.crossRecoveryScopeAllowed)).map(r=>({field:r.field,value:r.rawValue,sourceId:source.id,quote:r.evidence.quote,origin:'program_structured_relation',relationId:r.id}));
}
export function validateCandidate(raw,sources,options={}){
 const result=validateCandidateInternal(raw,sources,options),source=sources.find(s=>s.id===raw?.sourceId);
 if(result.accepted&&source?.reader==='pdf_text'&&source.requiresVisualCrosscheck){result.independentReader='ocr';result.readingDependency='Risky native text accepted only through OCR agreement, not an independent image reader';}return result;
}
function validateCandidateInternal(raw,sources,{recovery=false}={}){
  const field=raw?.field,source=sources.find(s=>s.id===raw?.sourceId);if(!FIELDS.includes(field))return {accepted:false,reason:'unknown_field'};
  if(!source)return {accepted:false,reason:'unauthorized_source'};
  const quoted=locate(source,raw.quote),value=canonical(field,raw.value);
  if(source.reader==='pdf_text'&&source.requiresVisualCrosscheck&&!source.nativeConflictFields?.includes(field)){
    const peers=sources.filter(p=>p.reader==='ocr'&&p.originalSha256===source.originalSha256&&p.page===source.page),supported=peers.some(peer=>[...extractRelationCandidates(peer),...extractLabeled(peer,{recovery:true})].filter(c=>c.field===field&&canonical(field,c.value)===value).some(c=>validateCandidate(c,[peer],{recovery:true}).accepted));
    if(!supported)return {accepted:false,field,value,reason:'native_text_requires_crosscheck',evidence:quoted||locate(source,String(raw.value)),validationStatus:'source_located_role_ambiguous',riskFlags:source.nativeRiskFlags};
  }
  if(field==='currency'){
    const explicit=[...source.text.matchAll(/(?:Currency|币种)\s*[:：]?\s*([A-Z]{3})(?![A-Za-z])/gi)].filter(m=>documentCurrencyContext(source,m.index)).map(m=>m[1].toUpperCase());
    if(explicit.some(code=>!['CNY','RMB','USD','EUR','GBP'].includes(code)))return {accepted:false,field,value,reason:'unsupported_explicit_currency',evidence:quoted,validationStatus:'source_located_role_ambiguous'};
  }
  if(value===null)return {accepted:false,field,reason:'invalid_value',evidence:quoted,validationStatus:'unsupported'};
  // Vision output rewrites labels. Its generated party role cannot establish
  // itself as a document label. Require another reader's role-bound candidate;
  // if values differ, retain BOTH candidates so ordinary conflict rules apply.
  if(source.reader==='vision'&&['buyer','seller'].includes(field)){
    const roleObserved=sources.some(peer=>peer.reader!=='vision'&&[...extractRelationCandidates(peer),...extractLabeled(peer,{recovery})].filter(c=>c.field===field).some(c=>validateCandidate(c,[peer],{recovery}).accepted));
    if(!roleObserved)return {accepted:false,field,value,reason:'vision_role_requires_source_support',evidence:quoted||locate(source,String(raw.value)),validationStatus:'source_located_role_ambiguous'};
  }
  const graph=sourceRelations(source),relation=graph.relations.find(r=>r.field===field&&r.value===value&&r.validationStatus==='supported');
  if(['buyer','seller'].includes(field)&&!relation){const literal=locate(source,String(raw.value)),owner=graph.relations.find(r=>r.field===field&&r.validationStatus==='supported'&&r.value!==value&&r.valueEvidence.some(e=>literal&&literal.start>=e.start&&literal.end<=e.end));if(owner)return {accepted:false,field,value,reason:'party_name_fragment_not_entity',evidence:quoted||literal,validationStatus:'source_located_role_ambiguous',parentRelationId:owner.id};}
  if(field==='invoiceNumber'&&graph.documentType==='delivery_note')return {accepted:false,field,value,reason:'field_not_applicable',evidence:quoted,validationStatus:'not_applicable'};
  if(source.targetFields&&!source.targetFields.includes(field)&&!relation?.crossRecoveryScopeAllowed)return {accepted:false,field,value,reason:'outside_recovery_scope',evidence:quoted,validationStatus:'needs_review'};
  if(field==='currency'&&relation?.amountRelationId){
    const amount=graph.relations.find(r=>r.id===relation.amountRelationId);
    if(amount&&amount.field!=='total'&&!extractLabeled(source,{recovery:true}).some(c=>c.field==='currency'&&c.role==='document_currency'&&canonical('currency',c.value)===value)&&!graph.relations.some(r=>r.field==='total'&&r.validationStatus==='supported'&&r.valueEvidence.some(e=>canonical('currency',e.quote.match(/^(?:US\$|USD|EUR|GBP|CNY|RMB|[￥¥€£])/i)?.[0])===value)))return {accepted:false,field,value,reason:'currency_not_bound_to_target_total',evidence:relation.evidence,validationStatus:'source_located_role_ambiguous'};
  }
  if(relation)return {accepted:true,field,value,evidence:relation.evidence,evidenceSpans:relation.evidenceSpans,role:'structured_'+field,origin:raw.origin||'model',rawValue:raw.value,validationStatus:'semantic_supported',relationId:relation.id,relation,extractionKind:relation.extractionKind,sourceNature:relation.sourceNature||'source_explicit',recovery:{method:relation.relationMethod,reason:'structured_source_relation'}};
  if(source.layoutRecords&&field!=='unclassifiedNumber'){
    const supported=regionalRelations(source).some(r=>r.field===field&&canonical(field,r.value)===value);
    if(!supported)return {accepted:false,field,value,reason:'regional_label_relation_missing',evidence:quoted,validationStatus:'needs_review'};
  }
  if(value===null)return {accepted:false,reason:'invalid_value',evidence:quoted,validationStatus:'unsupported'};
  if(field==='unclassifiedNumber'){const evidence=locate(source,String(raw.value));if(!evidence)return {accepted:false,reason:'source_not_located'};return {accepted:true,field,value,evidence,role:'unknown_number_role',origin:raw.origin||'model',validationStatus:'source_located_role_unknown'};}
  // Candidate value + source ID are sufficient for programmatic lookup. The
  // model's quote is only a hint, never the authority for a fabricated span.
  const choices=extractLabeled(source,{recovery}).filter(c=>c.field===field&&canonical(field,c.value)===value);
  if(MONEY_FIELDS.includes(field)&&choices.some(c=>graph.tables.some(t=>c.evidence.start>=t.start&&c.evidence.end<=t.end)))return {accepted:false,field,value,reason:'table_monetary_role_unverified',evidence:quoted||choices[0]?.evidence,validationStatus:'source_located_role_ambiguous'};
  if(NUMBER_FIELDS.includes(field)&&field!=='unclassifiedNumber'&&source.spatialRecords?.length){
    const records=source.spatialRecords.filter(b=>b.coordinateSystem==='normalized_0_1'&&Array.isArray(b.bbox)&&b.bbox.length===4&&b.bbox.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&b.bbox[0]<b.bbox[2]&&b.bbox[1]<b.bbox[3]);
    const sameBlock=source.spatialRecords.some(b=>extractLabeled(makeSource({id:source.fileId,sha256:source.originalSha256},'ocr',b.text||b.content||''),{recovery}).some(c=>c.field===field&&canonical(field,c.value)===value&&!/[\r\n]/.test(c.evidence.quote)));
    if(!sameBlock){const label=new RegExp('^(?:'+ROLE[field]+')\\s*[:：#]?\\s*$','i');let spatiallyBound=false;
      for(const a of records.filter(b=>label.test(String(b.text||b.content||'').trim()))){
        const near=records.filter(b=>b!==a&&/^[A-Za-z0-9][A-Za-z0-9.\/-]{2,79}$/.test(String(b.text||'').trim())&&/\d/.test(String(b.text||''))&&Math.max(a.bbox[0]-b.bbox[2],b.bbox[0]-a.bbox[2],0)<0.06&&Math.max(a.bbox[1]-b.bbox[3],b.bbox[1]-a.bbox[3],0)<0.06);
        const values=[...new Set(near.map(b=>canonical(field,String(b.text).trim())).filter(v=>v!==null))];
        if(values.includes(value)&&values.length>1)return {accepted:false,field,value,reason:'semantic_role_conflict',detail:'ambiguous_spatial_number_role',evidence:quoted||locate(source,String(raw.value)),validationStatus:'source_located_role_ambiguous'};
        if(values.length===1&&values[0]===value)spatiallyBound=true;
      }
      const sameSourceLine=choices.some(c=>!/[\r\n]/.test(c.evidence.quote));
      if(source.reader==='ocr'&&!spatiallyBound&&!sameSourceLine)return {accepted:false,field,value,reason:'number_role_location_unverified',evidence:quoted||locate(source,String(raw.value)),validationStatus:'source_located_role_ambiguous',detail:'OCR reading order spans separate blocks without verified label/value geometry'};
    }
  }
  if(!choices.length){const literal=locate(source,String(raw.value));return {accepted:false,field,value,reason:literal?'semantic_role_conflict':'source_not_located',evidence:quoted||literal,validationStatus:literal?'source_located':'unsupported'};}
  const evidence=choices[0].evidence,locatedByProgram=!quoted||!extractLabeled(makeSource({id:source.fileId,sha256:source.originalSha256},source.reader,quoted.quote),{recovery}).some(c=>c.field===field&&canonical(field,c.value)===value);
  return {accepted:true,field,value,evidence,evidenceSpans:choices.map(c=>c.evidence),role:choices[0].role,origin:raw.origin||'model',rawValue:raw.value,validationStatus:'semantic_supported',recovery:locatedByProgram?{method:'program_label_value_lookup',reason:quoted?'label_not_found':'quote_format_mismatch'}:null};
}
export function resolveFields(candidates){
  return Object.fromEntries(FIELDS.map(field=>{
    const eligible=candidates.filter(c=>c.accepted&&c.field===field),groups=new Map();
    for(const c of eligible){const key=JSON.stringify(c.value);if(!groups.has(key))groups.set(key,{value:c.value,evidence:[],readers:new Set()});const g=groups.get(key);for(const e of c.evidenceSpans||[c.evidence])if(!g.evidence.some(old=>old.sourceId===e.sourceId&&old.start===e.start&&old.end===e.end))g.evidence.push(e);g.readers.add(c.independentReader||c.evidence.reader);}
    const choices=[...groups.values()].map(g=>({...g,readers:[...g.readers]}));
    if(field==='unclassifiedNumber')return [field,{status:choices.length?'unclassified':'missing',value:null,choices}];
    if(!choices.length)return [field,{status:'missing',value:null,choices:[]}];
    if(choices.length>1)return [field,{status:'conflict',value:null,choices}];
    const choice=choices[0];return [field,{status:choice.readers.length>=2?'corroborated':'supported',value:choice.value,choices}];
  }));
}
export function evaluateDocument(record){
  const fields=record.fields,issues=[];
  const ambiguous=(fields.invoiceNumber.choices||[]).some(n=>(fields.unclassifiedNumber.choices||[]).some(c=>c.value===n.value&&c.evidence.some(e=>{const source=record.sources?.find(s=>s.id===e.sourceId);return source?.reader==='ocr'&&/机器编号|机器号码/.test(source.text.slice(Math.max(0,e.start-40),e.end+40));})));
  if(ambiguous){fields.invoiceNumber={...fields.invoiceNumber,status:'conflict',value:null};issues.push({code:'SEMANTIC_ROLE_AMBIGUITY',field:'invoiceNumber',blocking:true,reason:'视觉票号候选与OCR机器编号邻近的未定角色号码相同；不确认其为发票号码，需查看票面标签/区域。OCR其他无标签号码另行保留。'});}
  const required=requiredFields(fields);
  for(const field of required){const f=fields[field];if(f.status==='missing'||f.status==='conflict')issues.push({code:f.status==='conflict'?'FIELD_CONFLICT':'FIELD_MISSING',field,blocking:true,reason:f.status==='conflict'?'不同来源的角色明确候选冲突，保留并列值':'缺少角色明确、可定位的有效字段'});}
  for(const field of FIELDS.filter(f=>!required.includes(f)))if(fields[field].status==='conflict')issues.push({code:'OPTIONAL_FIELD_CONFLICT',field,blocking:true,reason:'已发现非必填字段存在冲突，保留并复核，不冒充全部核对完成'});
  for(const field of [numberField(fields),'date','total'])if(fields[field].status==='supported'&&record.visual)issues.push({code:'SINGLE_READER',field,blocking:true,reason:'仅一类读取来源支持，尚未得到独立交叉核对'});
  const number=fields.invoiceNumber.choices.map(c=>c.value);for(const role of ['machineNumber','invoiceCode','orderNumber','transactionNumber'])if(fields[role].choices.some(c=>number.includes(c.value)))issues.push({code:'SEMANTIC_ROLE_COLLISION',field:'invoiceNumber',blocking:true,reason:'票号候选同时被另一明确标签识别为'+role+'，须核对票面标签关系'});
  if(fields.documentType.value==='unknown'||fields.documentType.value==='delivery_note')issues.push({code:'DOCUMENT_SCOPE',field:'documentType',blocking:true,reason:'单据类型待确认或属于送销货单，单独整理，不当作税务发票'});
  if(record.coverage.status!=='complete')issues.push({code:'SOURCE_COVERAGE',blocking:true,reason:'原件页面/附件/识别覆盖尚未完整确认'});
  if(record.arithmeticIssues?.length)issues.push(...record.arithmeticIssues.map(reason=>({code:'ARITHMETIC_OR_DATE',blocking:true,reason})));
  return {...record,requiredFields:required,issues,extractionStatus:issues.length?'needs_review':'ready_for_review',classification:{type:fields.documentType.value||'unknown',foreignCurrency:fields.currency.value?fields.currency.value!=='CNY':null},businessStatus:issues.length?'needs_human_review':fields.paymentStatus.value!=='paid'?'needs_payment_proof':'needs_policy_check',eligibility:{status:'not_evaluated',reason:'仅整理票面信息；票据真伪、付款状态与单位报销资格未判定'}};
}

export function regionalRelations(source){
 const blocks=source.layoutRecords||[],relations=[];
 for(const b of blocks){const text=b.text||b.content||'';
  const rows=[...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const segments=rows.length?rows.flatMap(row=>{const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>m[1].replace(/<[^>]*>/g,' ').trim());const own=cells.filter(t=>extractLabeled(makeSource({id:source.fileId,sha256:source.originalSha256},'ocr',t),{recovery:true}).length);if(own.length)return own;return cells.length===2?[cells.join(' ')]:[];}):[text];
  for(const segment of segments){const temp=makeSource({id:source.fileId,sha256:source.originalSha256},'ocr',segment);for(const c of extractLabeled(temp,{recovery:true}))relations.push({...c,relation:'same_block_or_safe_table_row',blockIndex:b.blockIndex});}
 }
 // Cross-block pairing only for a label-only block and a unique nearby value
 // in its row/column. Explicit competing role labels stop the association.
 for(const a of blocks){const at=(a.text||'').trim(),box=a.bbox;if(!box||!at||at.length>45)continue;
  const neighbours=blocks.filter(b=>b!==a&&b.bbox&&String(b.text||'').trim()&&String(b.text).length<150&&((Math.min(box[3],b.bbox[3])-Math.max(box[1],b.bbox[1])>Math.min(box[3]-box[1],b.bbox[3]-b.bbox[1])*0.4&&b.bbox[0]>=box[2]-0.01&&b.bbox[0]-box[2]<0.22)||(Math.min(box[2],b.bbox[2])-Math.max(box[0],b.bbox[0])>0&&b.bbox[1]>=box[3]-0.005&&b.bbox[1]-box[3]<0.06)));
  if(neighbours.length!==1)continue;const bt=String(neighbours[0].text).trim();
  const entityAnchor=['buyer','seller'].find(field=>new RegExp('^(?:'+ROLE[field]+')\\s*[:：]?\\s*$','i').test(at));
  const entityValue=entityAnchor&&bt.length>=2&&bt.length<=200&&/\p{L}/u.test(bt)&&!Object.values(ROLE).some(pattern=>new RegExp('^(?:'+pattern+')','i').test(bt))&&!/^(?:统一社会信用代码|纳税人识别号|税号|地址|电话|银行|开户行|unknown|n\/a|none|null)/i.test(bt);
  if(!entityValue&&!/^(?:[A-Za-z0-9￥¥$€£.,/ -]+|\d{4}年\d{1,2}月\d{1,2}日)$/.test(bt))continue;
  const temp=makeSource({id:source.fileId,sha256:source.originalSha256},'ocr',at+' '+bt);for(const c of extractLabeled(temp,{recovery:true}))relations.push({...c,relation:'unique_geometric_neighbour',blockIndex:a.blockIndex,valueBlockIndex:neighbours[0].blockIndex});
 }
 return relations;
}
