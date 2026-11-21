import {assertConversationAttachment} from './attachment-context.mjs';
import ExcelJS from 'exceljs';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readOriginal,assertZipBudget} from './workspace-files.mjs';

export function parseCellRange(range,maxCells=400){
 if(typeof range!=='string')throw Error('请指定A1:D20这样的单元格范围');
 const match=range.toUpperCase().match(/^([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/);
 if(!match)throw Error('范围格式应为A1:D20，不支持整列或外部引用');
 const column=value=>[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),startCol=column(match[1]),startRow=Number(match[2]),endCol=column(match[3]||match[1]),endRow=Number(match[4]||match[2]);
 if(startCol>endCol||startRow>endRow||endCol>16384||endRow>1048576||(endCol-startCol+1)*(endRow-startRow+1)>maxCells)throw Error('单次读取最多'+maxCells+'个单元格，请缩小范围并分段读取');
 return {startCol,startRow,endCol,endRow,range:range.toUpperCase()};
}
function valueOf(cell){
 const v=cell.value;if(v===null||v===undefined)return {value:null};
 if(v instanceof Date)return {value:v.toISOString(),valueType:'date'};
 if(typeof v!=='object')return {value:typeof v==='string'?v.slice(0,700):v,valueType:typeof v,truncated:typeof v==='string'&&v.length>700};
 if('formula'in v||'sharedFormula'in v){const result=v.result instanceof Date?v.result.toISOString():v.result??null;return {value:result&&typeof result==='object'?null:result,formula:String(cell.formula||v.formula||v.sharedFormula).slice(0,700),valueType:result?.error?'error':'formula',cachedResultOnly:true,missingCachedResult:result===null,...result?.error?{error:result.error}:{}};}
 if(v.richText)return {value:v.richText.map(t=>t.text).join('').slice(0,700),valueType:'text'};
 if(v.hyperlink)return {value:String(v.text||'').slice(0,700),valueType:'hyperlink',note:'只读取显示文字，不访问链接'};
 if(v.error)return {value:null,valueType:'error',error:v.error};return {value:String(cell.text||'').slice(0,700),valueType:'text'};
}
export async function readSpreadsheetBytes(bytes,input){
 assertZipBudget(bytes);const book=new ExcelJS.Workbook();try{await book.xlsx.load(bytes);}catch{throw Error('无法打开Excel，请使用未加密且完整的.xlsx文件');}
 if(input.operation==='inspect')return {worksheets:book.worksheets.map(s=>({name:s.name,state:s.state,rows:s.rowCount,columns:s.columnCount,nonEmptyRows:s.actualRowCount})),limits:{readCells:400,calculationCells:10000},formulaPolicy:'不运行公式，只返回文件中已有缓存结果；缓存可能未刷新。'};
 const sheet=input.worksheet?book.getWorksheet(input.worksheet):book.worksheets.find(s=>s.state==='visible')||book.worksheets[0];if(!sheet)throw Error('找不到所选工作表，请先查看工作表目录');
 const bounds=parseCellRange(input.range||(input.operation==='read'?'A1:T20':''),input.operation==='calculate'?10000:400),cells=[];
 for(let row=bounds.startRow;row<=bounds.endRow;row++)for(let col=bounds.startCol;col<=bounds.endCol;col++){const cell=sheet.getCell(row,col);cells.push({address:cell.address,...valueOf(cell),...(cell.isMerged&&cell.master.address!==cell.address?{mergedInto:cell.master.address}:{})});}
 if(input.operation==='read'){if(JSON.stringify(cells).length>24000)throw Error('该区域文字过多，请缩小单元格范围后读取');return {worksheet:sheet.name,range:bounds.range,cells,formulaPolicy:'公式未重新计算，value为已有缓存；mergedInto为合并引用，不应重复计数。'};}
 if(input.operation!=='calculate'||!['sum','average','count','min','max'].includes(input.method))throw Error('不支持该表格计算');
 const unique=cells.filter(c=>!c.mergedInto),numbers=unique.filter(c=>typeof c.value==='number'&&Number.isFinite(c.value)),missing=unique.filter(c=>c.missingCachedResult||c.valueType==='error');
 let sum=0,compensation=0;for(const c of numbers){const next=c.value-compensation,total=sum+next;compensation=(total-sum)-next;sum=total;}
 const result=missing.length?null:input.method==='count'?numbers.length:!numbers.length?null:input.method==='sum'?Number(sum.toPrecision(15)):input.method==='average'?Number((sum/numbers.length).toPrecision(15)):input.method==='min'?Math.min(...numbers.map(c=>c.value)):Math.max(...numbers.map(c=>c.value));
 return {worksheet:sheet.name,range:bounds.range,method:input.method,result,numericCells:numbers.length,ignoredCells:unique.length-numbers.length,unavailableCells:missing.map(c=>c.address).slice(0,30),cachedFormulaResults:numbers.filter(c=>c.cachedResultOnly).length,note:missing.length?'范围存在无缓存公式或错误单元格，未给出不完整合计':'只统计数值，忽略文字、空白与合并引用；公式缓存未重算'};
}
function inWorker(bytes,input){return new Promise((resolve,reject)=>{
 const child=fork(fileURLToPath(import.meta.url),['--spreadsheet-worker'],{windowsHide:true,execArgv:['--max-old-space-size=384'],stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot||'',TEMP:process.env.TEMP||'',TMP:process.env.TMP||''}});let settled=false;
 const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();error?reject(error):resolve(result);};
 const timer=setTimeout(()=>finish(Error('Excel读取超时，请缩小工作簿')),25000);child.once('message',m=>m.ok?finish(null,m.result):finish(Error(m.error)));child.once('error',e=>finish(e));child.once('exit',()=>finish(Error('Excel读取进程已退出，文件可能过大或损坏')));child.send({base64:bytes.toString('base64'),input});
});}
export function createAttachmentAccess(store,sources,conversationId){
 const allowed=new Map(sources.map(f=>[f.id,f]));
 function file(id){if(conversationId)assertConversationAttachment(store,conversationId,id);const source=allowed.get(id),f=store.state.workspaceFiles?.find(f=>f.id===id);if(!source||!f||f.sha256!==source.sha256)throw Error('附件不在本次对话的授权范围内，或版本已变化');return f;}
 return {list:()=>[...allowed.values()].map(f=>({fileId:f.id,name:f.name})),spreadsheet:async input=>{const f=file(input.file_id);if(f.extension!=='.xlsx')throw Error('表格工具仅支持.xlsx；旧版.xls请先另存为.xlsx');return {fileId:f.id,name:f.name,...await inWorker(readOriginal(store,f),input)};},text:input=>{const f=file(input.file_id);readOriginal(store,f);if(f.parseStatus!=='ready'||f.recognition&&!f.recognition.confirmedAt)throw Error('附件正文尚未解析或核对');const offset=input.offset??0;if(!Number.isInteger(offset)||offset<0)throw Error('正文偏移无效');return {fileId:f.id,name:f.name,offset,text:f.content.slice(offset,offset+5000),hasMore:offset+5000<f.content.length,truncated:f.truncated};}};
}
if(process.send&&process.argv.includes('--spreadsheet-worker'))process.once('message',async m=>{try{const result=await readSpreadsheetBytes(Buffer.from(m.base64,'base64'),m.input);process.send({ok:true,result});}catch(error){process.send({ok:false,error:String(error.message).slice(0,500)});}});
