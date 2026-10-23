import {parseInvoiceTableNodes} from './invoice-structure.mjs';
import {createHash} from 'node:crypto';

export const RELATION_VERSION='v7-p1-09-r4-1';
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const partyLabels=[
 ['seller','issuer',/^(?:From)(?=\s|[:：]|$)\s*[:：]?/i],
 ['buyer','bill_to',/^(?:To)(?=\s|[:：]|$)\s*[:：]?/i],
 ['other','payment_recipient',/^(?:Payment\s*Recipient|Payee|收款方|收款单位)\s*[:：]?/i],
 ['buyer','invoice_recipient',/^(?:(?:Bill\s*To|Billed\s*To)(?=\s|[:：]|$)|收票人)\s*[:：]?/i],
 ['buyer','customer',/^(?:(?:Sold\s*To|Customer)(?=\s|[:：]|$)|购买方(?:信息|名称)?|购方(?:名称)?|买方(?:名称)?)\s*[:：]?/i],
 ['seller','issuer',/^(?:(?:Invoice\s*From|Bill\s*From|Issued\s*By)(?=\s|[:：]|$)|销售方(?:信息|名称)?|销方(?:名称)?|卖方(?:名称)?)\s*[:：]?/i],
 ['seller','supplier',/^(?:(?:Vendor|Seller|Supplier)(?=\s|[:：]|$)|供应商)\s*[:：]?/i],
 ['other','consignee',/^(?:Ship\s*To|Deliver\s*To|收货单位|收货人)\s*[:：]?/i],
 ['other','payer',/^(?:Paid\s*By|Payer|付款人|付款单位)\s*[:：]?/i],
];
const excludedEntity=/^(?:信息|名称|(?:扣税|记账|抵扣|报销)(?:凭证|联)|unknown|none|null|n\/a|地址|电话|银行|开户|账户|纳税人|统一社会信用|\d|https?:|\S+@)/i;
const entity=(s,{allowRolePrefix=false}={})=>{let value=clean(s).replace(/^名称\s*[:：]?\s*/,'').split(/统一社会信用代码|纳税人识别号|税号|地址[、:：]|电话[:：]|开户行|银行账号|购买方|销售方|Invoice\s*(?:No|Date)|\bDATE\b/i)[0].trim();return value.length>=2&&value.length<=160&&/\p{L}/u.test(value)&&!excludedEntity.test(value)&&(allowRolePrefix||!partyLabels.some(x=>x[2].test(value)))?value:null;};
const validBox=b=>Array.isArray(b)&&b.length===4&&b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&b[0]<b[2]&&b[1]<b[3];
const aligned=(a,b)=>validBox(a)&&validBox(b)&&Math.min(a[2],b[2])-Math.max(a[0],b[0])>0;
const moneyToken=/(?:US\$|USD|EUR|GBP|CNY|RMB|[￥¥$€£])?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d.,%])/g;
const moneyLabel=s=>{
 const t=clean(s).replace(/\s/g,'');
 if(/^(?:税额|Tax(?:Amount|Total)?)[:：]?$/i.test(t))return 'tax';
 if(/^(?:小计|不含税金额|不含税合计|Subtotal)[:：]?$/i.test(t))return 'subtotal';
 if(/^(?:价税合计(?:[（(]大写[）)])?|[（(]小写[）)]|含税合计|含税总额|GrandTotal|TotalDue|总金额|金额合计|合计金额|应付金额|AmountDue)[:：]?$/i.test(t))return 'total';
 if(/^(?:实付金额|已付金额|AmountPaid)[:：]?$/i.test(t))return 'paid';
 if(/^(?:折扣金额|折扣|Discount)[:：]?$/i.test(t))return 'discount';
 if(/^(?:余额|未付余额|Balance)[:：]?$/i.test(t))return 'balance';
 return null;
};

/** Bounded HTML grid. Raw offsets and rowspan/colspan survive flattening. */
export const parseInvoiceTables=parseInvoiceTableNodes;

export function resolveSourceRelations(source,{canonical,locate,normalizeWithMap}){
 const text=source.text,relations=[],observations=[],tables=parseInvoiceTables(text);
 const ref=(start,end)=>start>=0&&end>start&&end<=text.length?{...locate(source,text.slice(start,end)),start,end,quote:text.slice(start,end),line:text.slice(0,start).split('\n').length}:null;
 const exact=(needle,from=0)=>{const at=text.indexOf(needle,from);return at<0?null:ref(at,at+needle.length);};
 const inferredType=/形式发票|Pro\s*forma\s*Invoice/i.test(text)?'proforma':/送\s*[（(]?销[）)]?\s*货单|送货单|销货单|Delivery\s*Note/i.test(text)?'delivery_note':/电子发票|增值税.*发票|普通发票|专用发票/.test(text)?'tax_invoice':/账单|Invoice|发票/i.test(text)?'bill':'unknown';
 const add=(field,value,labels,values,method,extra={})=>{
  const normalized=canonical(field,value);if(normalized===null||!values.length||values.some(e=>!e)||labels.some(e=>!e))return;
  const spans=[...labels,...values].filter((e,i,all)=>all.findIndex(x=>x.start===e.start&&x.end===e.end)===i);
  if(!spans.length)return;const id='relation-'+createHash('sha256').update(source.id+'|'+field+'|'+normalized+'|'+method+'|'+spans.map(e=>e.start+':'+e.end).join(',')).digest('hex').slice(0,20);
  relations.push({id,documentId:source.fileId,sourceId:source.id,originalSha256:source.originalSha256,page:source.page??null,field,role:field==='buyer'||field==='seller'?field:'other',value:normalized,rawValue:value,labelEvidenceIds:labels.map(e=>source.id+':'+e.start+':'+e.end),valueEvidenceIds:values.map(e=>source.id+':'+e.start+':'+e.end),labelEvidence:labels,valueEvidence:values,evidence:values[0],evidenceSpans:spans,relationMethod:method,validationStatus:'supported',extractionKind:'explicitly_extracted',sourceNature:'source_explicit',version:RELATION_VERSION,...extra});
 };
 const blocks=[],claimedPartyCells=new Set();let cursor=0;
 for(const b of source.layoutRecords||source.spatialRecords||[]){const raw=b.text||b.content||'';if(!raw)continue;let start=text.indexOf(raw,cursor);if(start<0)start=text.indexOf(raw);if(start<0)continue;cursor=start+raw.length;blocks.push({...b,raw,start,end:start+raw.length,text:clean(raw),box:b.bbox});}
 // Providers can omit title/section blocks from content_list. Preserve an
 // explicit raw-text party label even when other blocks have geometry.
 if(blocks.length){let at=0;for(const raw of text.split('\n')){const value=raw.replace(/^\s*#{1,6}\s*/,'').trim();if(value&&partyLabels.some(x=>x[2].test(value))&&!blocks.some(b=>b.start===at||b.text===value)){const start=text.indexOf(value,at);if(start>=at&&start<at+raw.length)blocks.push({raw:value,text:value,start,end:start+value.length,box:null});}at+=raw.length+1;}}
 // Text-only input still supports explicit same-line and short section labels.
 if(!blocks.length){let at=0;for(const line of text.split('\n')){if(line.trim())blocks.push({raw:line,text:clean(line),start:at,end:at+line.length,box:null});at+=line.length+1;}}
 const labelOf=t=>partyLabels.filter(x=>!/^\s*(?:From|To)\s*[:：]?/i.test(t)||inferredType!=='unknown').map(([role,businessRole,re])=>{const m=t.match(re);if(!m)return null;const tail=t.slice(m[0].length);if(tail.trim()&&/^(?:Customer|Supplier|Vendor|Seller)\b/i.test(t)&&!m[0].includes(':')&&!m[0].includes('：'))return null;return {role,businessRole,label:m[0],tail};}).find(Boolean);
 const addParty=(labelBlock,valueBlock,label,method,cell)=>{
  const value=entity(cell?.text??(labelBlock===valueBlock?label.tail:valueBlock.text),{allowRolePrefix:!!cell});if(!value)return;
  // A substring must exist verbatim in this source. No semantic spelling repair.
  const valueRef=exact(value,cell?.start??valueBlock.start),labelRef=ref(labelBlock.start,Math.min(labelBlock.end,labelBlock.start+labelBlock.raw.length));
  if(!valueRef||valueRef.end>(cell?.end??valueBlock.end))return;if(cell)claimedPartyCells.add(cell.start);
  add(label.role==='other'?'partyOther':label.role,value,[labelRef],[valueRef],method,{businessRole:label.businessRole,semanticRole:label.role==='seller'?'issuer':label.role==='buyer'?(label.businessRole==='customer'?'customer':'bill_to'):label.businessRole,paymentIdentityConfirmed:false,otherRole:label.role==='other'});
 };
 // partyOther is retained as an observation, never promoted to buyer/seller.
 for(const b of blocks){const label=labelOf(b.text);if(!label||b.raw.includes('<table')||b.geometryOrigin&&tables.some(t=>t.rows.flat().some(c=>b.start>=c.start&&b.end<=c.end)))continue;
  if(label.tail.trim()){addParty(b,b,label,'same_cell');continue;}
  const near=blocks.filter(v=>v!==b&&(b.box&&v.box?aligned(b.box,v.box)&&v.box[1]>=b.box[3]-0.005&&v.box[1]-b.box[3]<0.065:v.start>=b.end&&v.start-b.end<6));
  if(near.length===1){const target=near[0],table=tables.find(t=>t.start===target.start);if(table&&!table.error){const first=table.rows[0]?.[0];if(first)addParty(b,target,label,'section_scope',first);}else if(!labelOf(target.text))addParty(b,target,label,'adjacent_block');}
 }
 for(const table of tables.filter(t=>!t.error))for(const row of table.rows){
  for(let i=0;i<row.length;i++){const cell=row[i];if(claimedPartyCells.has(cell.start))continue;const label=labelOf(cell.text);if(!label)continue;
   const b={raw:cell.raw,text:cell.text,start:cell.start,end:cell.end};
   if(label.tail.trim())addParty(b,b,label,'same_cell');
   else{const next=row[i+1];if(next&&!labelOf(next.text)&&next.col===cell.col+cell.colspan)addParty(b,{raw:next.raw,text:next.text,start:next.start,end:next.end},label,'same_cell',next);}
  }
 }
 // Generic two-column invoice template: unique issuer contact pane, opposite a
 // labeled invoice-recipient pane, matching issuer email domain and header mark.
 // Neither position nor a company name alone is sufficient; no vendor names here.
 const recipients=blocks.filter(b=>/^收票人\s*[:：]?$|^(?:Bill\s*To|Billed\s*To)\s*[:：]?$/i.test(b.text));
 const heading=text.match(/账单|\bInvoice\b/i),number=text.match(/账单编号\s*[A-Za-z0-9-]+|Invoice\s*(?:No\.?|Number|#)\s*[:：]?\s*[A-Za-z0-9-]+/i);
 if(inferredType==='bill'&&recipients.length===1&&heading&&number){
  const recipient=recipients[0],issuers=[];
  for(const b of blocks){const value=entity(b.text);if(!value||labelOf(b.text)||!validBox(b.box)||!validBox(recipient.box)||Math.abs(b.box[1]-recipient.box[1])>0.035||b.box[2]>recipient.box[0]-0.08)continue;
   const contacts=blocks.filter(v=>v!==b&&validBox(v.box)&&aligned(b.box,v.box)&&v.box[1]>=b.box[3]-0.005&&v.box[1]-b.box[3]<0.04&&/@/.test(v.text));
   const own=contacts.filter(v=>{const domain=v.text.match(/@([A-Za-z0-9.-]+)/)?.[1]?.split('.')[0]?.toLowerCase();return domain&&value.toLowerCase().replace(/[^a-z0-9]/g,'')===domain;});
   const marks=blocks.filter(v=>v!==b&&validBox(v.box)&&v.box[1]<b.box[1]&&new RegExp('^'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s+[A-Za-z]+)?$','i').test(v.text));
   if(own.length===1&&marks.length===1)issuers.push({b,value,contact:own[0],mark:marks[0]});
  }
  for(const item of issuers)add('seller',item.value,[exact(heading[0]),exact(number[0]),ref(recipient.start,recipient.end),ref(item.contact.start,item.contact.end),ref(item.mark.start,item.mark.end)],[exact(item.value,item.b.start)],'document_template',{businessRole:'invoice_issuer',paymentIdentityConfirmed:false,validationStatus:issuers.length===1?'supported':'ambiguous',template:'two_column_invoice_contact_and_bill_to_v1'});
 }
 // Cross-reader geometry: exact OCR strings are anchored to original PDF
 // blocks. The recipient label/value remains OCR evidence, and there must be
 // a unique same-height issuer pane with its own matching contact domain.
 const recipientRelations=relations.filter(r=>r.field==='buyer'&&r.validationStatus==='supported');
 const recipientsByName=[...new Set(recipientRelations.map(r=>r.value))];
 if(inferredType==='bill'&&source.geometryBindings?.length&&recipientsByName.length===1&&heading&&number&&/应付金额|Amount\s*Due|Grand\s*Total|价税合计/i.test(text)){
  const buyer=recipientRelations.find(r=>r.value===recipientsByName[0]),buyerBlocks=blocks.filter(b=>b.text===buyer.rawValue&&b.geometryOrigin&&validBox(b.box)),issuerMatches=[];
  if(buyerBlocks.length===1){const recipient=buyerBlocks[0];
   for(const b of blocks){const value=entity(b.text);if(!value||!b.geometryOrigin||!validBox(b.box)||labelOf(b.text)||b.box[1]>.45||Math.abs(b.box[1]-recipient.box[1])>.04||b.box[2]>recipient.box[0]-.08)continue;
    const before=text.slice(Math.max(0,b.start-65),b.start);if(/(?:Powered\s*by|Processed\s*by|Payment\s*Recipient|技术支持|平台提供)\s*[:：]?\s*$/i.test(before))continue;
    const own=blocks.filter(v=>v!==b&&v.geometryOrigin&&validBox(v.box)&&aligned(b.box,v.box)&&v.box[1]>=b.box[3]-.005&&v.box[1]-b.box[3]<.16&&/@/.test(v.text)&&v.text.match(/@([A-Za-z0-9.-]+)/)?.[1]?.split('.')[0]?.toLowerCase()===value.toLowerCase().replace(/[^a-z0-9]/g,''));
    if(own.length===1)issuerMatches.push({b,value,contact:own[0]});
   }
   if(issuerMatches.length===1){const item=issuerMatches[0];add('seller',item.value,[exact(heading[0]),exact(number[0]),...buyer.labelEvidence,ref(item.contact.start,item.contact.end)],[ref(item.b.start,item.b.end)],'document_structure',{businessRole:'invoice_issuer',semanticRole:'issuer',paymentIdentityConfirmed:false,template:'cross_reader_invoice_party_panes_v1',crossSourceEvidence:[item.b.geometryOrigin,item.contact.geometryOrigin,recipient.geometryOrigin],geometryIndependent:false});}
  }
 }
 const monetaryTokens=(raw,start)=>[...raw.matchAll(moneyToken)].filter(m=>/\d/.test(m[0])).map(m=>({raw:m[0].trim(),ref:ref(start+m.index,start+m.index+m[0].length),value:canonical('total',m[0].trim())})).filter(m=>m.value!==null);
 for(const table of tables.filter(t=>!t.error)){
  for(const cell of table.rows.flat()){
   const norm=normalizeWithMap(cell.raw);
   for(const m of norm.text.matchAll(/([（(]\s*小写\s*[）)])\s*[:：]?\s*([^\d\sA-Za-z\-.,]{0,1})\s*(\d[\d,]*\.\d{2})(?![\d.,])/g)){
    const prefix=norm.text.slice(Math.max(0,m.index-45),m.index);if(/(?:税额|Tax(?:\s*Amount)?|Balance|余额|折扣|Discount|单价|Unit\s*Price)\s*[:：]?\s*$/i.test(prefix))continue;
    const labelAt=m.index,valueAt=m.index+m[0].lastIndexOf(m[3]),symbol=/^[￥¥$€£]$/.test(m[2]),start=symbol?m.index+m[0].lastIndexOf(m[2]):valueAt;
    const mapped=(at,len)=>ref(cell.start+norm.map[at].start,cell.start+norm.map[at+len-1].end);
    add('total',(symbol?m[2]:'')+m[3],[mapped(labelAt,m[1].length)],[mapped(start,valueAt+m[3].length-start)],'same_cell',{tableStart:table.start,row:cell.row,column:cell.col,template:'explicit_small_write_in_dom_cell_v1',uncertainPrefix:m[2]&&!symbol?m[2]:null,crossRecoveryScopeAllowed:true});
   }
  }
  const detailedTable=table.rows.flat().some(c=>/数量|单价|Quantity|Unit\s*Price/i.test(c.text));
  for(const cell of table.rows.flat()){
   const norm=normalizeWithMap(cell.raw),patterns=[['subtotal','小计|不含税金额|不含税合计|Subtotal'],['total','金额合计|合计金额|总金额|应付金额|Amount\\s*Due|Grand\\s*Total|Total\\s*Due|Total|[（(]小写[）)]'],['paid','实付金额|已付金额|Amount\\s*Paid'],['balance','未付余额|余额|Balance'],['discount','折扣金额|折扣|Discount'],...(!detailedTable?[['tax','税额|Tax(?:\\s*(?:Amount|Total))?']]:[])];
   for(const [field,label]of patterns){const re=new RegExp('(?:^|[\\s:：])('+label+')\\s*[:：]?\\s*((?:US\\$|USD|EUR|GBP|CNY|RMB|[￥¥$€£])?\\s*\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.,])','gi');
    for(const m of norm.text.matchAll(re)){const labelAt=m.index+m[0].indexOf(m[1]),valueAt=m.index+m[0].lastIndexOf(m[2]),a=norm.map[labelAt]?.start,b=norm.map[labelAt+m[1].length-1]?.end,c=norm.map[valueAt]?.start,d=norm.map[valueAt+m[2].length-1]?.end;
     if(field==='total'&&/^Total$/i.test(m[1])&&/\b[A-Za-z]+\s+$/.test(norm.text.slice(0,labelAt)))continue;
     if([a,b,c,d].every(Number.isInteger))add(field,m[2].trim(),[ref(cell.start+a,cell.start+b)],[ref(cell.start+c,cell.start+d)],'same_cell',{tableStart:table.start,row:cell.row,column:cell.col});
    }
   }
  }
  const headerRows=table.rows.filter(row=>row.some(c=>/^(?:金额|Amount)$/i.test(c.text))&&row.some(c=>/^(?:税额|Tax)$/i.test(c.text)));
  if(headerRows.length===1){const header=headerRows[0],roles=header.map(c=>({cell:c,role:/^(?:金额|Amount)$/i.test(c.text)?'subtotal':/^(?:税额|Tax)$/i.test(c.text)?'tax':/^(?:单价|Unit\s*Price)$/i.test(c.text)?'unitPrice':/^(?:数量|Quantity|Qty)$/i.test(c.text)?'quantity':null})).filter(c=>c.role&&c.cell.colspan===1);
   for(const row of table.rows.filter(row=>row[0]?.row>header[0].row)){
    const summary=row.some(c=>/^(?:合\s*计|小计|Subtotal|Total)\s*[:：]?$/i.test(c.text));
    for(const {cell:heading,role}of roles){const values=row.filter(c=>c.col===heading.col&&c.colspan===1),tokens=values.length===1?monetaryTokens(values[0].raw,values[0].start):[];if(tokens.length!==1||clean(values[0].raw).replace(tokens[0].raw,'').trim())continue;
     observations.push({sourceId:source.id,tableStart:table.start,row:values[0].row,column:heading.col,role:summary?role:role==='subtotal'?'lineAmount':role==='tax'?'lineTax':role,semanticRole:role==='unitPrice'?'unit_price':role==='subtotal'?(summary?'subtotal':'line_amount'):role==='tax'?'tax':role,rowKind:summary?'summary':'detail',rawValue:tokens[0].raw,evidence:tokens[0].ref,labelEvidence:ref(heading.start,heading.end),adoptedAsSummary:summary&&['subtotal','tax'].includes(role)});
     if(summary&&['subtotal','tax'].includes(role))add(role,tokens[0].raw,[ref(heading.start,heading.end),ref(row[0].start,row[0].end)],[tokens[0].ref],'same_cell',{tableStart:table.start,row:values[0].row,column:heading.col,columnRole:role});
    }
   }
  }
  for(const row of table.rows){
   for(let i=0;i<row.length;i++){const cell=row[i],field=moneyLabel(cell.text);if(!field)continue;const next=row[i+1];
    if(next&&next.col===cell.col+cell.colspan){const tokens=monetaryTokens(next.raw,next.start);if(tokens.length===1&&clean(next.raw).replace(tokens[0].raw,'').trim()==='')add(field,tokens[0].raw,[ref(cell.start,cell.end)],[tokens[0].ref],'same_cell',{tableStart:table.start,row:cell.row,column:next.col});}
    // Rightmost summary cell may be separated by empty spacer cells.
    const rest=row.slice(i+1);if(rest.length>1&&rest.slice(0,-1).every(c=>!c.text)){const last=rest.at(-1),tokens=monetaryTokens(last.raw,last.start);if(tokens.length===1&&clean(last.raw).replace(tokens[0].raw,'').trim()==='')add(field,tokens[0].raw,[ref(cell.start,cell.end)],[tokens[0].ref],'same_cell',{tableStart:table.start,row:cell.row,column:last.col});}
   }
  }
  // VAT collapsed summary only: same table preserves the amount/rate/tax header
  // order and a separate tax-inclusive total row. Reject extra numbers/columns.
  if(inferredType==='tax_invoice'){
   const totalRow=table.rows.flat().find(c=>/价税合计/.test(c.text)),header=table.rows.flat().find(c=>/金额\s*税率(?:\/征收率)?\s*税额/.test(c.text));
   if(totalRow&&header)for(const row of table.rows){if(row.length!==1||!/^合\s*计\s*[￥¥]/.test(row[0].text))continue;const c=row[0],tokens=monetaryTokens(c.raw,c.start);if(tokens.length!==2||tokens.some(t=>!/[￥¥]/.test(t.raw)))continue;
    const residue=clean(c.raw).replace(/^合\s*计/,'').replace(/[￥¥]\s*\d[\d,]*(?:\.\d{1,2})?/g,'').trim();if(residue)continue;
    for(const [i,field]of ['subtotal','tax'].entries())add(field,tokens[i].raw,[ref(header.start,header.end),ref(c.start,c.end),ref(totalRow.start,totalRow.end)],[tokens[i].ref],'document_template',{template:'vat_collapsed_amount_rate_tax_summary_v1',tableStart:table.start,row:c.row,columnRole:field,collapsedColumns:true});
   }
  }
 }
 // A labeled small-write amount survives an unknown *prefix* glyph, without
 // replacing that glyph with currency or repairing any numeric characters.
 for(const b of blocks.filter(b=>!b.raw.includes('<table'))){const m=b.raw.match(/([（(]\s*小写\s*[）)])\s*[:：]?\s*([^\d\sA-Za-z\-.,]{0,1})\s*(\d[\d,]*\.\d{2})(?![\d.,])/);if(m&&!/(?:税额|Tax(?:\s*Amount)?|Balance|余额|折扣|Discount|单价|Unit\s*Price)\s*[:：]?\s*$/i.test(b.raw.slice(0,m.index))){const at=b.start+m.index,valueAt=at+m[0].lastIndexOf(m[3]),symbol=/^[￥¥$€£]$/.test(m[2]),valueStart=symbol?at+m[0].lastIndexOf(m[2]):valueAt;add('total',(symbol?m[2]:'')+m[3],[ref(at,at+m[1].length)],[ref(valueStart,valueAt+m[3].length)],'same_cell',{uncertainPrefix:m[2]&&!symbol?m[2]:null,crossRecoveryScopeAllowed:true});}}
 if(inferredType==='delivery_note'){const m=text.match(/(送\s*[（(]?销[）)]?\s*货单|送货单|销货单|Delivery\s*Note)\s*(?:No\.?|编号|号码|#|[:：])?\s*([A-Za-z0-9][A-Za-z0-9/-]{2,60})/i);if(m)add('documentNumber',m[2],[exact(m[1])],[exact(m[2],m.index+m[1].length)],'section_scope',{documentType:'delivery_note'});}
 // Currency may follow a structured monetary field, never a bank account or
 // unclassified body symbol. Unknown OCR prefixes do not become currency.
 for(const r of [...relations].filter(r=>['total','subtotal','tax'].includes(r.field)&&r.validationStatus==='supported')){
  const evidence=r.valueEvidence[0],raw=evidence.quote,token=raw.match(/^(?:US\$|USD|EUR|GBP|CNY|RMB|[￥¥€£])/i)?.[0];
  if(token)add('currency',token,r.labelEvidence,[evidence],r.relationMethod,{amountRelationId:r.id,currencyScope:'explicit_monetary_value',crossRecoveryScopeAllowed:!!r.crossRecoveryScopeAllowed});
 }
 return {version:RELATION_VERSION,sourceId:source.id,documentType:inferredType,relations,observations,tables:tables.map(t=>({start:t.start,end:t.end,error:t.error,rows:t.rows.length,cells:t.rows.flat().map(({raw,...c})=>c)})),limits:{tables:20,rows:300,columns:64,cells:5000},unresolved:relations.filter(r=>r.validationStatus!=='supported')};
}
