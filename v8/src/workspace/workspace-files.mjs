import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {extractUploadWorker} from '../documents/uploads.mjs';
import {AUDIO_EXTENSIONS,isAudioExtension} from '../media/audio-formats.mjs';
import {id,isBase64Payload,now} from '../runtime/core.mjs';
export const MAX_WORKSPACE_FILE=PROCESSING_LIMITS.fileBytes;
export const MAX_WORKSPACE_FILES=scaledLimit(2000);
export const MAX_WORKSPACE_BYTES=scaledLimit(2*1024*1024*1024);
export function workspaceStorage(store){const files=store.state.workspaceFiles||[];return {files:files.length,bytes:files.reduce((sum,f)=>sum+f.bytes,0),maxFiles:MAX_WORKSPACE_FILES,maxBytes:MAX_WORKSPACE_BYTES};}
export function assertWorkspaceCapacity(store,bytes,count=1){const usage=workspaceStorage(store);if(usage.files+count>usage.maxFiles||usage.bytes+bytes>usage.maxBytes)throw new Error(`本机文件库容量不足（已用${usage.files}/${usage.maxFiles}个文件，${(usage.bytes/1024/1024).toFixed(1)}/${(usage.maxBytes/1024/1024).toFixed(0)}MB）；请减少本次上传量或调整文件库容量。`);return usage;}
export const WORKSPACE_EXTENSIONS=['.txt','.md','.csv','.json','.log','.docx','.pdf','.xlsx','.png','.jpg','.jpeg','.eml','.ics','.js','.cjs','.mjs','.py','.ts',...AUDIO_EXTENSIONS];
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertZipBudget(bytes,{excel=true}={}){let total=0,count=0;for(let i=0;i<bytes.length-46;i++){if(bytes.readUInt32LE(i)===0x02014b50){total+=bytes.readUInt32LE(i+24);count++;if(total>(excel?30*1024*1024:scaledLimit(30*1024*1024))||count>(excel?2000:scaledLimit(2000)))throw new Error('压缩文档展开后过大，请缩小文件');i+=45+bytes.readUInt16LE(i+28)+bytes.readUInt16LE(i+30)+bytes.readUInt16LE(i+32);}}if(!count)throw new Error('压缩文档结构不完整');}
export function safeName(value){return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').replace(/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i,'_$1$2').slice(0,100)||'未命名';}
export function inside(root,...parts){const absolute=path.resolve(root,...parts),base=path.resolve(root)+path.sep;if(!absolute.startsWith(base))throw new Error('路径越界');return absolute;}
export function originalPath(store,file){return inside(store.directory,'workspace-files',file.id,'original'+file.extension);}
export function readOriginal(store,file){const bytes=fs.readFileSync(originalPath(store,file));if(digest(bytes)!==file.sha256)throw new Error('原件校验失败：'+file.name);return bytes;}
export async function addWorkspaceFile(store,input){
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>180||/[\\/\x00-\x1f]/.test(input.name))throw new Error('文件名不合法');
  if(typeof input.base64!=='string'||input.base64.length>Math.ceil(MAX_WORKSPACE_FILE/3)*4||!isBase64Payload(input.base64))throw new Error('文件编码不合法或超过50MB');
  const bytes=Buffer.from(input.base64,'base64');if(!bytes.length||bytes.length>MAX_WORKSPACE_FILE)throw new Error('单个文件须非空且不超过50MB');
  store.state.workspaceFiles||=[];
  assertWorkspaceCapacity(store,bytes.length);
  const extension=path.extname(input.name).toLowerCase();if(extension==='.xlsx'&&bytes.length>20*1024*1024)throw Error('Excel单个文件仍需不超过20MB');
  if(!WORKSPACE_EXTENSIONS.includes(extension))throw new Error('支持文本文档、源码、日历、DOCX、PDF、XLSX、常见录音、票据图片、EML，以及 zip、rar、7z 压缩包');
  if(['.xlsx','.docx'].includes(extension))assertZipBudget(bytes,{excel:extension==='.xlsx'});
  let content='',parseStatus='ready',parseError=null,truncated=false;
  if(isAudioExtension(extension)){parseStatus='audio';}
  else if(['.png','.jpg','.jpeg'].includes(extension)){parseStatus='needs_ocr';parseError='需要内网OCR并核对文字后才能提取票据字段';}
  else if(extension==='.xlsx'){
    try{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);let count=0;const lines=[];for(const sheet of workbook.worksheets){lines.push('工作表：'+sheet.name);sheet.eachRow((row,n)=>{if(count++<2500)lines.push(`${n}: `+row.values.slice(1).map(v=>typeof v==='object'?JSON.stringify(v):String(v??'')).join(' | '));});}content=lines.join('\n');truncated=count>2500||content.length>60000;content=content.slice(0,60000);}catch{parseStatus='failed';parseError='Excel无法解析，请上传未加密的XLSX';}
  }else if(bytes.length>scaledLimit(5*1024*1024)){parseStatus='failed';parseError='文档正文解析上限12.5MB，原件已保留用于整理；请缩小文档后重试';}
  else{
    try{const parsed=await extractUploadWorker({...input,name:['.eml','.ics','.js','.cjs','.mjs','.py','.ts'].includes(extension)?input.name+'.txt':input.name});content=parsed.content;truncated=parsed.truncated;}catch(error){parseStatus=extension==='.pdf'?'needs_ocr':'failed';parseError=error.message;}
  }
  const file={id:id(),name:input.name,extension,bytes:bytes.length,sha256:digest(bytes),content,parseStatus,parseError,truncated,createdAt:now()};
  // Parsing awaits a worker. Recheck at commit so concurrent uploads cannot
  // both consume the last slot or exceed the byte budget.
  assertWorkspaceCapacity(store,bytes.length);
  const target=originalPath(store,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
  store.state.workspaceFiles.push(file);store.save();return file;
}
