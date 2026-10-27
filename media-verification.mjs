import {createHash} from 'node:crypto';
export const MEDIA_VERIFICATION_VERSION='media-fields-1';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=v=>String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const unknown=v=>!String(v??'').trim()||/^(?:[-—…?.]+|null|n\/?a|unknown|unavailable|not (?:visible|provided)|未(?:知|提供|取得|识别)|不(?:详|确定)|待核|需核对)$/i.test(String(v).trim());
const row=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(s=>s.replace(/\\\|/g,'|').trim());

// Only explicit labelled/table values become evidence. A list of column names
// or free prose is never promoted to field data. Span offsets refer to raw text.
export function extractMediaFields(text,receiptId){
 text=typeof text==='string'?text:'';const fields=[];let record='',offset=0,headers=null;
 const add=(label,value,line,start,recordKey)=>{
  if(unknown(value)||!label||!recordKey||/^(?:note|注|说明)$/i.test(label))return;
  const local=line.indexOf(value);if(local<0)return;
  const span={start:start+local,end:start+local+value.length};
  fields.push({id:'field-'+hash([receiptId,span,label,recordKey]).slice(0,20),recordKey:key(recordKey),record:recordKey,label:key(label),labelRaw:label,value,span,quote:text.slice(span.start,span.end)});
 };
 for(const line of text.split('\n')){
  const clean=line.trim(),start=offset;offset+=line.length+1;
  if(clean.includes('|')){
   const cells=row(clean);
   if(cells.every(x=>/^:?-{3,}:?$/.test(x)))continue;
   if(!headers){headers=cells;continue;}
   if(cells.length===headers.length&&cells.length>1)for(let i=1;i<cells.length;i++)add(headers[i],cells[i],line,start,cells[0]);
   continue;
  }
  headers=null;
  const heading=/^#{1,6}\s+(.+)$/.exec(clean);
  const pair=/^(?:[-*]\s+)?([^:：]{1,70})[:：]\s*(\S.*)$/.exec(clean);
  if(pair){add(pair[1].trim(),pair[2].trim(),line,start,record);continue;}
  if(heading)record=heading[1].trim();
  else if(clean&&clean.length<=150&&!/[。.!?：:]/.test(clean)&&/[\p{L}]/u.test(clean))record=clean;
 }
 return fields;
}

function validCoverage(raw={}){
 const totalPages=Number.isInteger(raw.totalPages)&&raw.totalPages>0?raw.totalPages:null;
 const pages=Array.isArray(raw.pages)?[...new Set(raw.pages.filter(p=>Number.isInteger(p)&&p>0&&(!totalPages||p<=totalPages)))].sort((a,b)=>a-b):[];
 const unmappedRecordCount=Number.isInteger(raw.unmappedRecordCount)?raw.unmappedRecordCount:null;
 return {totalPages,pages,pageMapping:raw.pageMapping==='exact'?'exact':'unknown',imagesSent:Number.isInteger(raw.imagesSent)?raw.imagesSent:null,convertedImages:Number.isInteger(raw.convertedImages)?raw.convertedImages:null,unmappedRecordCount,complete:!!totalPages&&raw.pageMapping==='exact'&&(!unmappedRecordCount)&&pages.length===totalPages&&pages.every((p,i)=>p===i+1)};
}
export function recordMediaReading(run,file,reader,result){
 if(!['read_with_vision','ocr_document','read_attachment_text'].includes(reader))return result;
 if(reader==='read_attachment_text'&&!['.pdf','.png','.jpg','.jpeg'].includes(file.extension))return result;
 const text=typeof result?.text==='string'?result.text:'';
 const receipt={id:'read-'+hash([file.id,file.sha256,reader,text,result?.offset??0]).slice(0,24),fileId:file.id,inputHash:file.sha256,reader,model:result?.model||null,runId:run.id||null,text,textHash:hash(text),status:result?.status||'returned',coverage:validCoverage(result?.coverage),recordedAt:new Date().toISOString()};
 receipt.fields=extractMediaFields(text,receipt.id);receipt.valueStatus=receipt.fields.length?'labelled_values':'no_labelled_values';
 if(result?.status==='blocked')receipt.valueStatus='blocked';
 run.mediaReadings||=[];
 if(!run.mediaReadings.some(r=>r.id===receipt.id))run.mediaReadings.push(receipt);
 run.mediaVerification=mediaVerification(run.mediaReadings);
 return {...result,readingId:receipt.id,fieldEvidence:receipt.fields,coverage:receipt.coverage,valueStatus:receipt.valueStatus,verification:run.mediaVerification};
}

// Pair by BOTH record identity and field identity, never by equal values alone.
// Multiple values under an ambiguous key cannot be silently paired in order.
export function compareMediaFields(left,right){
 const keys=new Set([...left,...right].map(f=>f.recordKey+'\0'+f.label));
 return [...keys].sort().map(k=>{
  const a=left.filter(f=>f.recordKey+'\0'+f.label===k),b=right.filter(f=>f.recordKey+'\0'+f.label===k);
  const state=!a.length&&!b.length?'missing':!a.length||!b.length?'one_sided':a.length!==1||b.length!==1?'insufficient_evidence':unknown(a[0].value)||unknown(b[0].value)?'missing':a[0].value===b[0].value?'match':'conflict';
  return {recordKey:k.split('\0')[0],field:k.split('\0')[1],state,left:a.map(f=>({id:f.id,value:f.value,span:f.span,quote:f.quote})),right:b.map(f=>({id:f.id,value:f.value,span:f.span,quote:f.quote}))};
 });
}
export function mediaVerification(readings=[],scope){
 const valid=readings.filter(r=>!scope||scope.some(f=>f.id===r.fileId&&f.sha256===r.inputHash));
 const ids=[...new Set(valid.map(r=>r.fileId))];
 const files=ids.map(fileId=>{
  const r=valid.filter(r=>r.fileId===fileId),vision=r.filter(x=>x.reader==='read_with_vision'),ocr=r.filter(x=>x.reader==='ocr_document'),native=r.filter(x=>x.reader==='read_attachment_text');
  const fields=kind=>r.filter(x=>x.reader===kind&&x.valueStatus!=='blocked').flatMap(x=>x.fields||[]);
  const compared=compareMediaFields(fields('read_with_vision'),fields('ocr_document'));
  const textLayerComparison=compareMediaFields(fields('ocr_document'),fields('read_attachment_text'));
  const counts={match:0,conflict:0,one_sided:0,missing:0,insufficient_evidence:0};for(const c of compared)counts[c.state]++;
  if(!compared.length)counts.missing=1;
  const coverageComplete=vision.length>0&&ocr.length>0&&vision.every(x=>x.coverage?.complete)&&ocr.every(x=>x.coverage?.complete);
  return {fileId,inputHash:r[0].inputHash,state:counts.conflict?'conflict':!counts.match?'unverified':counts.one_sided||counts.insufficient_evidence||!coverageComplete?'partial':'observed_fields_matched',counts,coverageComplete,readings:r.map(x=>({id:x.id,reader:x.reader,valueStatus:x.valueStatus,fieldCount:x.fields?.length||0,coverage:x.coverage})),compared,textLayerComparison,semanticCorrectness:'not_established'};
 });
 return {version:MEDIA_VERIFICATION_VERSION,files,fullDocumentVerified:false,note:'逐字段精确文字比较；调用次数、文字层与OCR一致均不等于视觉与OCR双重核验。页码未知时覆盖未知；不证明语义零遗漏。'};
}
export function verificationForSources(run,files,previous=[]){
 const readings=[...(run.mediaReadings||[])];
 if(!readings.length)for(const prior of [...previous].reverse()){
  if(prior.conversationId!==run.conversationId)continue;
  const usable=(prior.mediaReadings||[]).filter(r=>files.some(f=>f.id===r.fileId&&f.sha256===r.inputHash));
  if(usable.length){readings.push(...usable);break;}
 }
 return mediaVerification(readings,files);
}
export function verificationNotice(verification,visualFiles){
 if(!visualFiles.length)return '';
 const all=verification.files.flatMap(f=>f.compared),matches=all.filter(x=>x.state==='match').length,conflicts=all.filter(x=>x.state==='conflict').length;
 const ranges=visualFiles.map(f=>{const v=verification.files.find(x=>x.fileId===f.id),first=v?.readings.find(r=>r.reader==='read_with_vision'),second=v?.readings.find(r=>r.reader==='ocr_document');const show=r=>!r?'无回执':r.coverage.totalPages?r.coverage.pageMapping==='exact'?`已定位${r.coverage.pages.length}/${r.coverage.totalPages}页`:`已发送${r.coverage.imagesSent??'未知数量'}张图，原件${r.coverage.totalPages}页，页码映射未知`:'页数/页码未取得可靠回执';return `${f.name}：视觉${show(first)}，OCR${show(second)}`;});
 const textConflicts=verification.files.flatMap(f=>f.textLayerComparison).filter(c=>c.state==='conflict').length;
 const nativeSeen=verification.files.some(f=>f.readings.some(r=>r.reader==='read_attachment_text'&&r.fieldCount));
 const nativeNotice=nativeSeen?`OCR与文字层对齐字段中有${textConflicts}处差异；未对齐字段仍待核，不能择一称为已核验。`:'OCR与文字层尚无逐字段对照回执，不能把未检查说成无差异。';
 return `材料核验说明：未证明整份材料完成双重核验。已登记字段严格文本匹配${matches}项、冲突${conflicts}项、单侧或缺证据${all.filter(x=>x.state!=='match'&&x.state!=='conflict').length}项。${nativeNotice}${ranges.join('；')}。以下整理限于实际取得的原文；缺值、未定位页面与未比较字段保留待核。`;
}
