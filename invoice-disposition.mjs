const acceptedStatus=s=>['supported','corroborated'].includes(s);

export function modelFailureKind(error){
 const text=String(error?.message||error||'');
 return /timeout|超时|ETIMEDOUT/i.test(text)?'timeout':/context|token.*limit|输入过长|maximum.*length/i.test(text)?'input_budget':/JSON|structured|schema|结构化|协议/i.test(text)?'structured_protocol':/finish_reason|empty|没有返回|无有效返回/i.test(text)?'incomplete_model_output':/connection|network|fetch|ECONN|ENOTFOUND|HTTP\s*[45]/i.test(text)?'network':/aborted|cancel|取消/i.test(text)?'interrupted':'harness_or_provider_other';
}

export function annotateFieldDispositions(record){
 const {fields,candidates,sources,coverage={},failures=[]}=record;
 for(const [field,state]of Object.entries(fields)){
  const own=candidates.filter(c=>c.raw?.field===field),located=own.filter(c=>c.result?.evidence),roleRejected=located.filter(c=>!c.result.accepted&&['semantic_role_conflict','regional_label_relation_missing','outside_recovery_scope','vision_role_requires_source_support','table_monetary_role_unverified','native_text_requires_crosscheck','currency_not_bound_to_target_total','unsupported_explicit_currency','number_role_location_unverified'].includes(c.result.reason));
  const upstream=failures.filter(f=>f.code==='MODEL_CALL_FAILED'&&(!f.fields||f.fields.includes(field))||['OCR_FAILED','REGIONAL_OCR_FAILED','SOURCE_UNREADABLE'].includes(f.code));
  let disposition,reason;
  if(acceptedStatus(state.status)){disposition='confirmed';reason='Source role and value supported; not a claim of factual truth, independent reader or reimbursement eligibility';}
  else if(state.status==='conflict'){disposition='conflicted';reason='Competing role-supported values retained';}
  else if(field==='invoiceNumber'&&fields.documentType.value==='delivery_note'){disposition='not_applicable';reason='Delivery-note identifier is documentNumber, not a tax invoice number';}
  else if(roleRejected.length){disposition='role_unverified';reason='A candidate or quotation is located, but field role/region binding remains unverified';}
  else if(located.length){disposition='source_located';reason='Candidate evidence located but no verified field relation';}
  else if(!sources.length&&failures.some(f=>['OCR_FAILED','SOURCE_UNREADABLE'].includes(f.code))){disposition='unreadable';reason='No usable source after recorded reader failure';}
  else if(coverage.status!=='complete'){disposition='not_inspected';reason='No located field in inspected sources; incomplete source coverage prevents absence claim';}
  else {disposition='not_present';reason='No supported occurrence found in the recorded inspected sources, not a visual claim about unseen content';}
  const failedStages=failures.filter(f=>(!f.fields||f.fields.includes(field))&&/MODEL_CALL_FAILED|OCR_FAILED|REGIONAL_OCR_FAILED|llm_|harness_|ocr_|vision_|queue_wait|workspace_timeout|file_timeout|request_budget/i.test(f.code||''));
  const fieldDisposition=!acceptedStatus(state.status)&&state.status!=='conflict'&&disposition!=='not_applicable'&&failedStages.length?'blocked_upstream':disposition;
  Object.assign(state,{fieldDispositionVersion:2,fieldDisposition,contentDisposition:disposition,upstreamBlockers:failedStages.map(f=>({code:f.code,stage:f.stage||f.phase||null,requestId:f.requestId||f.id||null,pageNo:f.pageNo||null,timeoutReason:/timeout/i.test(f.code)?f.code:null,reason:f.reason||f.detail||null,resumable:f.resumable!==false})),sourceNature:acceptedStatus(state.status)?'source_explicit':'unknown',disposition,dispositionReason:reason,observedCandidateIds:own.map(c=>c.id),locatedCandidateIds:located.map(c=>c.id),upstreamFailures:upstream.map(f=>({id:f.id||null,code:f.code,phase:f.phase||null,category:f.category||null,detail:f.detail||f.reason||null})),relationIds:[...new Set(own.filter(c=>c.result.accepted&&c.result.relationId).map(c=>c.result.relationId))],businessRoles:[...new Set(own.filter(c=>c.result.accepted&&c.result.relation?.businessRole).map(c=>c.result.relation.businessRole))],extractionKinds:[...new Set(own.filter(c=>c.result.accepted).map(c=>c.result.extractionKind||'explicitly_extracted'))]});
 }
 return record;
}

export function planSemanticRecovery({fields,candidates,sources,focus}){
 const priorRegions=sources.filter(s=>s.roiId);
 const labels={invoiceNumber:/发票号码|Invoice\s*(?:No|Number|#)/i,documentNumber:/单据编号|送货单号|Document\s*(?:No|Number)/i,billNumber:/账单编号|Bill\s*(?:No|Number)/i,date:/开票日期|发出日期|Invoice\s*Date|Issue\s*Date/i,buyer:/购买方(?!扣税|记账|抵扣|报销)|Bill\s*To|Billed\s*To|Customer|收票人/i,seller:/销售方|销方(?!开户|银行|账户)|Seller|Vendor|Supplier|Issued\s*By|Invoice\s*From/i,subtotal:/Subtotal|小计|不含税金额/i,tax:/税额|Tax\s*Amount/i,total:/价税合计|小写|Grand\s*Total|Amount\s*Due|金额合计/i,currency:/Currency|币种|人民币|CNY|USD|￥|¥/i};
 return focus.map(field=>{
  const state=fields[field],observed=candidates.some(c=>c.raw?.field===field&&c.result?.evidence),attempted=priorRegions.filter(s=>s.targetFields?.includes(field));
  const anchored=labels[field]&&sources.some(s=>(s.layoutRecords||s.spatialRecords||[]).some(b=>Array.isArray(b.bbox)&&b.bbox.length===4&&labels[field].test(b.text||b.content||'')));
  let action,reason,allowOcr=false,allowModel=false;
  if(acceptedStatus(state.status)){action='existing_semantic_evidence';reason='Existing source relation already supports field';}
  else if(field==='invoiceNumber'&&fields.documentType.value==='delivery_note'){action='not_applicable';reason='Retain delivery-note documentNumber separately';}
  else if(['paymentStatus','paymentDate'].includes(field)){action='needs_human_review';reason='No explicit payment evidence; repeated invoice OCR cannot establish actual payment';}
  else if(field==='amount'){action='semantic_review';reason='Unclassified amount is not an alternative for a typed total/subtotal/tax';}
  else if(state.status==='conflict'){action='preserve_conflict';reason='Repeated reading of the same sources is not conflict resolution';}
  else if(attempted.length){action='semantic_review_no_repeat';reason='Prior actual local regions already inspected for this field; preserve unresolved role and avoid repeating identical OCR';}
  else if(observed){action='local_structure_review';reason='Candidate exists; evaluate saved labels/cells/blocks before any new OCR';}
  else {action='targeted_ocr_if_located';reason=anchored?'Existing role-label block supplies a localized OCR search target':'First bounded recovery allowed; locator must honestly label any fallback, preserve budget and leave unverified fields pending';allowOcr=true;allowModel=true;}
  return {field,action,reason,allowOcr,allowModel,previousRoiIds:attempted.map(s=>s.roiId),repeatedReaderIndependent:false};
 });
}

export function monetaryConsistency(fields){
 const values=['subtotal','tax','total'].map(f=>fields[f]?.value);
 if(values.some(v=>!Number.isSafeInteger(v)))return {status:'unverified',reason:'All three explicitly extracted values are required; no subtraction invents a printed field',derived:[]};
 const currencyOf=f=>[...new Set((fields[f]?.choices||[]).flatMap(c=>(c.evidence||[]).flatMap(e=>[...String(e.quote).matchAll(/US\$|USD|CNY|RMB|[￥¥€£]|EUR|GBP/g)].map(m=>/^(?:US\$|USD)$/.test(m[0])?'USD':/^(?:CNY|RMB|[￥¥])$/.test(m[0])?'CNY':/^(?:EUR|€)$/.test(m[0])?'EUR':'GBP'))))];
 const currencies=Object.fromEntries(['subtotal','tax','total'].map(f=>[f,currencyOf(f)]));
 if(new Set(Object.values(currencies).flat()).size>1)return {status:'currency_conflict',method:'exact_integer_minor_units',currencies,derived:[],reason:'Explicit source operands use different currencies; do not add them even if numbers happen to balance'};
 const [subtotal,tax,total]=values.map(BigInt),sum=subtotal+tax;
 return {status:sum===total?'consistent':'inconsistent',method:'exact_integer_minor_units',equation:{subtotal:subtotal.toString(),tax:tax.toString(),computedTotal:sum.toString(),printedTotal:total.toString()},operandKind:'explicitly_extracted',derived:[{field:'computedTotal',value:sum.toString(),kind:'deterministically_derived',adoptedAsPrintedField:false}],reason:'Arithmetic consistency does not create missing source evidence or reimbursement eligibility'};
}
