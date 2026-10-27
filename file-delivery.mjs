import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import {guardSourcePresentation} from './source-presentation.mjs';
import ExcelJS from 'exceljs';
import {observed,fingerprint} from './qa-events.mjs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType,PageOrientation,Footer,PageNumber,AlignmentType} from 'docx';
import {writeArtifact,resolveArtifact} from './artifacts.mjs';
import {capability,readBinary} from './multimodal.mjs';

export const FILE_FORMATS=['docx','xlsx','pdf'];
export const DELIVERY_TABLE_LIMITS=Object.freeze({columns:100,rows:3000,cells:30000,sheets:32});
export const FILE_MIMES={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'};
const plain=s=>String(s??'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1 ($2)').trim();
export function requestedFormats(request=''){
 // A format in an input filename alone is not an output request.
 const patterns={docx:/word|docx|Word文档/i,xlsx:/excel|excal|xlsx|电子表格/i,pdf:/pdf/i};
 const clauses=String(request).split(/[；;。\n]/).filter(s=>/(?:导出|生成|下载|输出|交付|给我|做成|报成|整理成|转成|转\s*(?:word|docx|pdf|excel)|弄成|转换|制作|保存|另存)/.test(s));
 return FILE_FORMATS.filter(f=>clauses.some(s=>patterns[f].test(s)&&!new RegExp('(?:不要|不用|无需|不必|不需要|别|不生成|不导出|不制作|不输出)[^，,；;。\\n]{0,20}'+(f==='xlsx'?'(?:excel|excal|xlsx|电子表格)':f==='docx'?'(?:word|docx)':'pdf'),'i').test(s)&&!new RegExp('(?:读取|分析|根据|按照?|上传|附件)[^，,]{0,30}'+(f==='xlsx'?'(?:Excel|excal|xlsx)':f==='docx'?'(?:Word|docx)':'pdf')+'[^，,]{0,15}(?:生成|整理|分析|做成)','i').test(s)));
}
export function deliveryFormats(values=[],request=''){
 if(!Array.isArray(values)||values.some(v=>!FILE_FORMATS.includes(v)))throw Error('下载格式仅支持docx、xlsx、pdf');
 return [...new Set([...requestedFormats(request),...values])];
}
const splitRow=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(s=>plain(s.replace(/\\\|/g,'|')));
export function parseDocument(markdown){
 const lines=String(markdown||'').replace(/\r/g,'').split('\n'),blocks=[];let paragraph=[];
 const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:plain(paragraph.join('\n'))});paragraph=[];}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')){
   flush();const headers=splitRow(line),rows=[];i++;
   while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){const row=splitRow(lines[++i]);if(row.length!==headers.length)throw Error('表格各行列数不一致，请修正后导出');rows.push(row);}
   blocks.push({type:'table',headers,rows});continue;
  }
  const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*(?:[-*+]\s+|\d+[.)、]\s+)(.+)$/.exec(line);
  if(heading){flush();blocks.push({type:'heading',level:Math.min(3,heading[1].length),text:plain(heading[2])});}
  else if(bullet){flush();blocks.push({type:'bullet',text:plain(bullet[1])});}
  else if(!line.trim()){flush();}else paragraph.push(line);
 }
 flush();return blocks;
}
const canonicalCell=v=>{const s=String(v??'').trim();return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)&&s.replace(/[-.]/g,'').length<16?String(Number(s)):s;};
const tableKey=t=>JSON.stringify([t.headers,...t.rows].map(row=>row.map(canonicalCell)));
function normalizeSheets(sheets,blocks){
 const tables=[...(sheets||[])],known=new Set(tables.map(tableKey));let heading='';
 for(const b of blocks){if(b.type==='heading')heading=b.text;else if(b.type==='table'&&!known.has(tableKey(b))){tables.push({name:heading||'明细'+(tables.length+1),headers:b.headers,rows:b.rows.map(row=>row.map(value=>/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&value.replace(/[-.]/g,'').length<16?Number(value):value))});known.add(tableKey(b));}}
 if(!tables.length)return [{name:'正文',headers:['内容'],rows:blocks.filter(b=>b.text).map(b=>[b.text])}];
 if(tables.length>DELIVERY_TABLE_LIMITS.sheets)throw Error('最多导出'+DELIVERY_TABLE_LIMITS.sheets+'个工作表；总单元格限制仍为'+DELIVERY_TABLE_LIMITS.cells);
 let cells=0;const names=new Set();return tables.map((s,i)=>{
  if(!Array.isArray(s.headers)||!s.headers.length||s.headers.length>DELIVERY_TABLE_LIMITS.columns||!Array.isArray(s.rows)||s.rows.length>DELIVERY_TABLE_LIMITS.rows)throw Error('表格需1至'+DELIVERY_TABLE_LIMITS.columns+'列，每表最多'+DELIVERY_TABLE_LIMITS.rows+'行');
  if(s.rows.some(r=>!Array.isArray(r)||r.length!==s.headers.length))throw Error('表格各行列数不一致');
  const headers=s.headers.map(v=>String(v));if(headers.some(v=>!v.trim()||v.length>200))throw Error('表头需要1至200字符');
  const rows=s.rows.map(r=>r.map(v=>{if(v===null)return null;if(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))throw Error('单元格只支持文字、有限数值、布尔值和空值，不接受公式对象');if(String(v).length>8000)throw Error('单元格超过8000字，请拆分');return v;}));
  cells+=(rows.length+1)*headers.length;if(cells>DELIVERY_TABLE_LIMITS.cells)throw Error('本次表格超过'+DELIVERY_TABLE_LIMITS.cells+'格，请拆分');
  let name=String(s.name||'明细'+(i+1)).replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').slice(0,27).trim()||'明细';let suffix=1,base=name;while(names.has(name.toLowerCase()))name=base+' '+(++suffix);names.add(name.toLowerCase());
  return {name,headers,rows};
 });
}
export function prepareDelivery({title='交付文件',content='',sheets=[]}){
 if(typeof title!=='string'||!title.trim()||title.length>120)throw Error('文件标题需要1至120字');
 if(typeof content!=='string'||content.length>scaledLimit(100000))throw Error('正文最多250000字');
 if(!content.trim()&&!sheets?.length)throw Error('需要实际正文或表格，不能创建空文件');
 const blocks=parseDocument(content);if(blocks[0]?.type==='heading'&&blocks[0].level===1)blocks.shift();const tables=normalizeSheets(sheets,blocks);
 const known=new Set(blocks.filter(b=>b.type==='table').map(tableKey));
 if(sheets?.length)for(const t of tables)if(!known.has(tableKey(t))){blocks.push({type:'heading',level:2,text:t.name},{type:'table',headers:t.headers,rows:t.rows});known.add(tableKey(t));}
 return {title:title.trim(),blocks,sheets:tables};
}
function runs(text,style={}){return String(text??'').split('\n').map((s,i)=>new TextRun({...style,text:s,...i?{break:1}:{}}));}
export async function renderWord(spec){
 const blocks=spec.blocks.flatMap(b=>{if(b.type!=='table'||b.headers.length<=8)return [b];const result=[];for(let start=1;start<b.headers.length;start+=7){const cols=[0,...Array.from({length:Math.min(7,b.headers.length-start)},(_,i)=>start+i)];result.push({type:'heading',level:3,text:'同一记录的第'+(start+1)+'至'+Math.min(start+7,b.headers.length)+'列'}, {...b,headers:cols.map(i=>b.headers[i]),rows:b.rows.map(row=>cols.map(i=>row[i]))});}return result;});
 const wide=spec.blocks.some(b=>b.type==='table'&&b.headers.length>5),children=[new Paragraph({text:spec.title,heading:HeadingLevel.TITLE})];
 const usable=wide?14440:9638;
 for(const block of blocks){
  if(block.type==='heading'){if(block.text===spec.title)continue;children.push(new Paragraph({text:block.text,heading:[null,HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][block.level]}));}
  else if(block.type==='table'){
   const size=block.headers.length>7?18:20,widths=block.headers.map(()=>Math.floor(usable/block.headers.length));
   children.push(new Table({width:{size:usable,type:WidthType.DXA},columnWidths:widths,layout:'fixed',rows:[block.headers,...block.rows].map((row,i)=>new TableRow({cantSplit:true,tableHeader:i===0,children:row.map((cell,col)=>new TableCell({width:{size:widths[col],type:WidthType.DXA},margins:{top:90,bottom:90,left:100,right:100},shading:i===0?{fill:'E9EDF2'}:undefined,children:[new Paragraph({spacing:{after:30},children:runs(cell,{size,bold:i===0})})]}))}))}));children.push(new Paragraph({text:'',spacing:{after:80}}));
  }else children.push(new Paragraph({children:runs(block.text),...(block.type==='bullet'?{bullet:{level:0}}:{})}));
 }
 return Packer.toBuffer(new Document({
  creator:'伴行 V6',title:spec.title,
  styles:{default:{document:{run:{font:{ascii:'Calibri',eastAsia:'Microsoft YaHei'},size:22,color:'222222'},paragraph:{spacing:{after:140,line:330}}},
   title:{run:{font:{eastAsia:'Microsoft YaHei'},size:36,bold:true,color:'000000'},paragraph:{spacing:{after:240}}},
   heading1:{run:{size:28,bold:true,color:'000000'},paragraph:{spacing:{before:240,after:140},keepNext:true}},
   heading2:{run:{size:24,bold:true,color:'000000'},paragraph:{spacing:{before:180,after:100},keepNext:true}}}},
  sections:[{properties:{page:{size:{width:11906,height:16838,orientation:wide?PageOrientation.LANDSCAPE:PageOrientation.PORTRAIT},margin:{top:1200,bottom:1200,left:1134,right:1134}}},
   footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:[PageNumber.CURRENT]})]})]})},children}]
 }));
}
export async function renderWorkbook(spec){
 const book=new ExcelJS.Workbook();book.creator='伴行 V6';book.title=spec.title;
 const sheets=[...spec.sheets];
 if(spec.blocks.some(b=>b.text)&&!sheets.some(s=>s.name==='正文')){let name='报告正文';while(sheets.some(s=>s.name.toLowerCase()===name.toLowerCase()))name+='附';sheets.push({name,headers:['内容'],rows:spec.blocks.filter(b=>b.text).map(b=>[b.text])});}
 for(const s of sheets){
  const sheet=book.addWorksheet(s.name,{views:[{state:'frozen',ySplit:1}],pageSetup:{paperSize:9,orientation:s.headers.length>5?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,repeatRows:'1:1',margins:{left:.3,right:.3,top:.5,bottom:.5,header:.2,footer:.2}}});
  sheet.addRow(s.headers);sheet.addRows(s.rows);sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rows.length+1),column:s.headers.length}};
  sheet.columns.forEach((c,i)=>{let longest=String(s.headers[i]).length*2;for(const r of s.rows)longest=Math.max(longest,Math.min(48,String(r[i]??'').replace(/[^\x00-\xff]/g,'aa').length));c.width=Math.min(55,Math.max(14,longest+3));});
  sheet.eachRow((row,n)=>{let lineCount=1;row.eachCell({includeEmpty:true},(cell,c)=>{cell.font={name:'Microsoft YaHei',size:11,...n===1?{bold:true,color:{argb:'FFFFFFFF'}}:{}};cell.alignment={vertical:'top',wrapText:true};if(n===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF35465A'}};else if(n%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F6F8'}};if(typeof cell.value==='number'&&!Number.isInteger(cell.value))cell.numFmt='#,##0.00';lineCount=Math.max(lineCount,String(cell.value??'').split('\n').reduce((sum,v)=>sum+Math.max(1,Math.ceil(v.replace(/[^\x00-\xff]/g,'aa').length/(sheet.getColumn(c).width-2))),0));});if(lineCount*16+8>409)throw Error('Excel第'+n+'行文字过长，超过可完整显示的行高，请拆分内容');row.height=Math.max(24,lineCount*16+8);});
  sheet.headerFooter.oddFooter='第 &P 页 / 共 &N 页';
 }
 return Buffer.from(await book.xlsx.writeBuffer());
}
export async function validateDelivery(format,bytes,spec){
 return observed('file_readback',{metadata:{format,bytes:bytes.length,sha256:fingerprint(bytes),columnCounts:spec.sheets?.map(s=>s.headers.length)||[]}},()=>validateDeliveryContent(format,bytes,spec));
}
async function validateDeliveryContent(format,bytes,spec){
 if(format==='docx'){
  const zip=await JSZip.loadAsync(bytes);if(!zip.file('word/document.xml'))throw Error('Word文件结构无效');
  const text=(await mammoth.extractRawText({buffer:bytes})).value,compact=s=>String(s??'').replace(/\s/g,'');if(!compact(text).includes(compact(spec.title)))throw Error('Word回读缺少标题');
  for(const b of spec.blocks){const expected=b.type==='table'?[b.headers,...b.rows].flat().map(v=>String(v??'')):[b.text];if(expected.some(s=>compact(s)&&!compact(text).includes(compact(s))))throw Error('Word回读发现内容缺失');}
  return {format,characters:text.length,verified:true};
 }
 if(format==='xlsx'){
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  for(const s of spec.sheets){const sheet=book.getWorksheet(s.name);if(!sheet||sheet.rowCount!==s.rows.length+1)throw Error('Excel工作表或行数不一致');for(const [r,row]of [s.headers,...s.rows].entries())for(const [c,value]of row.entries())if((sheet.getCell(r+1,c+1).value??null)!==(value??null))throw Error('Excel回读内容或数值类型不一致');}
  return {format,sheets:book.worksheets.length,rows:book.worksheets.reduce((n,s)=>n+s.rowCount,0),verified:true};
 }
 if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('转换服务未返回真正的PDF');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});let doc;
 try{doc=await task.promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=(await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join('');const compact=s=>String(s??'').replace(/\s/g,'');if(!text.trim()||!compact(text).includes(compact(spec.title)))throw Error('PDF回读没有找到可检索标题，可能为空白或文字丢失');for(const b of spec.blocks){const expected=b.type==='table'?[b.headers,...b.rows].flat():[b.text];if(expected.some(s=>compact(s)&&!compact(text).includes(compact(s))))throw Error('PDF回读发现正文或表格文字缺失');}return {format,pages:doc.numPages,characters:text.length,verified:true};}finally{await task.destroy();}
}
export async function generateDeliverables(harness,spec,formats,signal){
 const results=[],failures=[];let word;
 for(const format of formats){try{
  signal?.throwIfAborted();let bytes;
  if(format==='xlsx')bytes=await renderWorkbook(spec);
  else{word||=await renderWord(spec);if(format==='docx')bytes=word;else{const c=capability(harness,'convert'),form=new FormData();form.append('file',new Blob([word]),'document.docx');bytes=(await readBinary(await fetch(c.baseUrl+'/convert/pdf',{method:'POST',body:form,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(scaledLimit(90000))])}))).bytes;}}
  signal?.throwIfAborted();results.push({format,bytes,check:await validateDelivery(format,bytes,spec)});
 }catch(error){if(signal?.aborted)throw error;failures.push({format,message:error.message});}}
 return {results,failures};
}
export async function sourceJobContent(store,job){
 if(['queued','running','cancelled','failed','interrupted'].includes(job.status))throw Error('来源任务尚未交付有效结果');
 if(job.exportSource)return job.exportSource;
 const files=job.artifacts.filter(a=>/\.(md|txt)$/i.test(a.name)&&a.kind!=='audit');
 let content=files.map(a=>resolveArtifact(store,job.id,a.id).bytes.toString('utf8')).join('\n\n');
 const rows=job.workResult?.items;
 const sheets=rows?.length?[{name:'事项明细',headers:['事项','状态','说明','负责人','期限','下一步','原文依据'],rows:rows.map(r=>[r.title,r.status,r.summary||'',r.owner||'',r.dueText||'',r.nextAction||'',[...(r.basis||[]),...(r.evidence||[])].map(e=>e.name+' 第'+e.line+'行：'+e.quote).join('\n')])}]:[];
 if(!content){
  const word=job.artifacts.find(a=>a.name.endsWith('.docx'));if(word)content=(await mammoth.extractRawText({buffer:resolveArtifact(store,job.id,word.id).bytes})).value;
  let sourceCells=0;for(const artifact of job.artifacts.filter(a=>a.name.endsWith('.xlsx'))){
   const book=new ExcelJS.Workbook();await book.xlsx.load(resolveArtifact(store,job.id,artifact.id).bytes);
   for(const sheet of book.worksheets){
    if(sheet.columnCount>DELIVERY_TABLE_LIMITS.columns||sheet.rowCount>DELIVERY_TABLE_LIMITS.rows+1)throw Error('已有表格超过'+DELIVERY_TABLE_LIMITS.columns+'列或'+DELIVERY_TABLE_LIMITS.rows+'行，请按区域拆分后导出');
    sourceCells+=sheet.columnCount*sheet.rowCount;if(sourceCells>DELIVERY_TABLE_LIMITS.cells)throw Error('已有表格超过'+DELIVERY_TABLE_LIMITS.cells+'格，请按区域拆分后导出');
    const values=[];sheet.eachRow(row=>values.push(Array.from({length:sheet.columnCount},(_,i)=>{const cell=row.getCell(i+1);if(cell.formula&&cell.result===undefined)throw Error('已有文件包含无缓存的公式，不能假装已重算');const v=cell.result??cell.value;if(v===null||['string','number','boolean'].includes(typeof v))return v;return cell.text;})));
    if(values.length)sheets.push({name:sheet.name,headers:values[0].map(v=>String(v??'未命名列')),rows:values.slice(1)});
   }
  }
  content||=job.summary?'## 执行结果\n\n'+job.summary:'';
 }
 if(!content&&!sheets.length)throw Error('此任务没有可导出的报告正文；请下载已有文件或提供具体内容');
 return {title:job.title,content,sheets};
}
export async function attachDeliverables(store,harness,job,input,formats,signal){
 if(!job.responseIntegrity){const scope=job.dataScope||[],files=scope.map(s=>store.state.workspaceFiles?.find(f=>f.id===s.id&&f.sha256===s.sha256)).filter(Boolean),run=store.state.runs?.find(r=>r.id===job.chatRunId)||{id:job.chatRunId,conversationId:job.conversationId};const checked=guardSourcePresentation(input,{run,files,previous:store.state.runs||[]});input=checked.input;job.responseIntegrity=checked.audit;if(checked.audit.issues.length)job.warnings.push('术语展示或核验断言有待核偏差，已保留原文及验证记录。');}
 job.exportSource=input;
 const spec=prepareDelivery(input),result=await generateDeliverables(harness,spec,formats,signal);signal?.throwIfAborted();
 for(const {format,bytes,check}of result.results){writeArtifact(store,job,spec.title.replace(/(?:\.(?:xlsx|docx|pdf))+$/i,'')+'.'+format,bytes,'document');job.checks.push({label:format.toUpperCase()+'文件生成并回读校验通过',passed:true,...check});}
 for(const failure of result.failures){job.warnings.push(failure.format.toUpperCase()+'未交付：'+failure.message);job.checks.push({label:failure.format.toUpperCase()+'文件交付',passed:false,error:failure.message});}
 return result;
}
