import {createHash} from 'node:crypto';
export const MEDIA_VERIFICATION_VERSION='media-fields-2';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=v=>String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export function classifyMediaValue(value){
 let text=String(value??'').trim();if(!text)return {state:'missing',reason:'empty'};
 if(/^(["'“‘]).*["'”’]$/s.test(text))text=text.slice(1,-1).trim();
 const marker='(?:[-—…?.]+|null|n\\/?a|unknown|unavailable|unreadable|not (?:visible|provided|available|identified|recogni[sz]ed)|tbc|tbd|待(?:核(?:对|实|验)?|确认|复核|识别|查)|未(?:知|提供|取得|识别|列明|给出|确认|注明|显示|检测|标注)|无法(?:识别|辨认|读取|确定|确认|核对)|不(?:详|确定|明确)|需(?:要)?(?:核对|确认|核实|复核)|暂无(?:信息|数据|结果)?|空白|缺失)';
 if(new RegExp('^'+marker+'[。.]?$','i').test(text))return {state:'missing',reason:'placeholder'};
 const qualified=new RegExp('^'+marker+'\\s*(?:（([^（）\\r\\n]{1,120})）|\\(([^()\\r\\n]{1,120})\\)|[:：,，]\\s*([^\\r\\n]{1,120}))[。.]?$','i').exec(text);
 if(qualified){const reason=qualified[1]||qualified[2]||qualified[3];if(/^(?:未|待|需|缺|无|不|模糊|不可读|not\b|no\b|missing\b|blurred\b|illegible\b|unreadable\b|awaiting\b|manual\b|review\b)|(?:未|没有|无法|不能|模糊|不清|不足|缺少|空白|待核|待确认|\bnot\b|\bblank\b|blur|\bmissing\b|unreadable)/i.test(reason.trim()))return {state:'missing',reason:'qualified_placeholder'};}
 return {state:'present',reason:null};
}
const unknown=v=>classifyMediaValue(v).state==='missing';
// Offsets stay in the raw line. Odd backslashes escape a pipe; even ones do not.
export function mediaTableCells(line){
 const cuts=[];for(let i=0;i<line.length;i++)if(line[i]==='|'){let n=0;for(let j=i-1;j>=0&&line[j]==='\\';j--)n++;if(n%2===0)cuts.push(i);}
 if(!cuts.length)return [];
 const edges=[-1,...cuts,line.length],cells=[];
 for(let i=0;i<edges.length-1;i++){let start=edges[i]+1,end=edges[i+1];while(start<end&&/\s/.test(line[start]))start++;while(end>start&&/\s/.test(line[end-1]))end--;if((i===0||i===edges.length-2)&&start===end)continue;const quote=line.slice(start,end);cells.push({start,end,quote,value:quote.replace(/\\([\\|])/g,'$1')});}
 return cells;
}

// Only explicit labelled/table values become evidence. A list of column names
// or free prose is never promoted to field data. Span offsets refer to raw text.
export function extractMediaFields(text,receiptId){
 text=typeof text==='string'?text:'';const fields=[];let record='',offset=0,headers=null;
 const add=(label,value,span,recordKey,encoding='plain')=>{
  if(!label||!recordKey||/^(?:note|注|说明)$/i.test(label))return;
  const valueState=classifyMediaValue(value);
  fields.push({id:'field-'+hash([receiptId,span,label,recordKey]).slice(0,20),recordKey:key(recordKey),record:recordKey,label:key(label),labelRaw:label,value,valueState:valueState.state,missingReason:valueState.reason,span,quote:text.slice(span.start,span.end),encoding});
 };
 for(const line of text.split('\n')){
  const clean=line.trim(),start=offset;offset+=line.length+1;
  const cells=mediaTableCells(line);
  if(cells.length>1){
   if(cells.every(x=>/^:?-{3,}:?$/.test(x.value)))continue;
   if(!headers){headers=cells.map(c=>c.value);continue;}
   if(cells.length===headers.length)for(let i=1;i<cells.length;i++)add(headers[i],cells[i].value,{start:start+cells[i].start,end:start+cells[i].end},cells[0].value,'markdown-cell');
   continue;
  }
  headers=null;
  const heading=/^#{1,6}\s+(.+)$/.exec(clean);
  const pair=/^\s*(?:[-*]\s+)?([^:：]{1,70})[:：]\s*(.*)$/d.exec(line);
  if(pair){const raw=pair[2],leading=raw.length-raw.trimStart().length,value=raw.trim();add(pair[1].trim(),value,{start:start+pair.indices[2][0]+leading,end:start+pair.indices[2][0]+leading+value.length},record);continue;}
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
 receipt.fields=extractMediaFields(text,receipt.id);receipt.fieldSchemaVersion=MEDIA_VERIFICATION_VERSION;receipt.valueStatus=receipt.fields.some(f=>!unknown(f.value))?'labelled_values':'no_labelled_values';
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
  const usableA=a.filter(f=>!unknown(f.value)),usableB=b.filter(f=>!unknown(f.value));
  const state=!usableA.length&&!usableB.length?'missing':a.length>1||b.length>1?'insufficient_evidence':!usableA.length||!usableB.length?'one_sided':usableA[0].value===usableB[0].value?'match':'conflict';
  return {recordKey:k.split('\0')[0],field:k.split('\0')[1],state,left:a.map(f=>({id:f.id,value:f.value,span:f.span,quote:f.quote})),right:b.map(f=>({id:f.id,value:f.value,span:f.span,quote:f.quote}))};
 });
}
export function mediaVerification(readings=[],scope){
 const valid=readings.filter(r=>!scope||scope.some(f=>f.id===r.fileId&&f.sha256===r.inputHash)).map(r=>{if(typeof r.text!=='string')return r;const fields=extractMediaFields(r.text,r.id);return {...r,fields,fieldSchemaVersion:MEDIA_VERIFICATION_VERSION,valueStatus:r.valueStatus==='blocked'?'blocked':fields.some(f=>!unknown(f.value))?'labelled_values':'no_labelled_values'};});
 const ids=[...new Set(valid.map(r=>r.fileId))];
 const files=ids.map(fileId=>{
  const r=valid.filter(r=>r.fileId===fileId),vision=r.filter(x=>x.reader==='read_with_vision'),ocr=r.filter(x=>x.reader==='ocr_document'),native=r.filter(x=>x.reader==='read_attachment_text');
  const fields=kind=>r.filter(x=>x.reader===kind&&x.valueStatus!=='blocked').flatMap(x=>x.fields||[]);
  const compared=compareMediaFields(fields('read_with_vision'),fields('ocr_document'));
  const textLayerComparison=compareMediaFields(fields('ocr_document'),fields('read_attachment_text'));
  const counts={match:0,conflict:0,one_sided:0,missing:0,insufficient_evidence:0};for(const c of compared)counts[c.state]++;
  if(!compared.length)counts.missing=1;
  const coverageComplete=vision.length>0&&ocr.length>0&&vision.every(x=>x.coverage?.complete)&&ocr.every(x=>x.coverage?.complete);
  return {fileId,inputHash:r[0].inputHash,state:counts.conflict?'conflict':!counts.match?'unverified':counts.missing||counts.one_sided||counts.insufficient_evidence||!coverageComplete?'partial':'observed_fields_matched',counts,coverageComplete,readings:r.map(x=>({id:x.id,reader:x.reader,valueStatus:x.valueStatus,fieldCount:(x.fields||[]).filter(f=>!unknown(f.value)).length,missingFieldCount:(x.fields||[]).filter(f=>unknown(f.value)).length,coverage:x.coverage})),compared,textLayerComparison,semanticCorrectness:'not_established'};
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
