import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { id, isBase64Payload, now } from './core.mjs';

export const MAX_UPLOAD = scaledLimit(5 * 1024 * 1024);
export function extractUploadWorker(input) {
  return new Promise((resolve,reject)=>{
    const worker=fork(fileURLToPath(import.meta.url),[],{windowsHide:true,execArgv:['--max-old-space-size=256'],stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot||'',TEMP:process.env.TEMP||'',TMP:process.env.TMP||''}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.kill();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('文件解析超时，请缩小文件后重试')),scaledLimit(25000));
    worker.once('message',message=>message.ok?finish(null,message.result):finish(new Error(message.error)));
    worker.once('error',error=>finish(error));worker.once('exit',()=>finish(new Error('文件解析进程已结束，文件可能过大或格式不支持')));
    worker.send(input);
  });
}
export async function extractUpload(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180 || /[\\/\x00-\x1f]/.test(input.name)) throw new Error('文件名不合法');
  const extension = path.extname(input.name).toLowerCase();
  if (!['.txt','.md','.csv','.json','.log','.docx','.pdf'].includes(extension)) throw new Error('支持 TXT、MD、CSV、JSON、LOG、DOCX 和文字版 PDF');
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(MAX_UPLOAD / 3) * 4 || !isBase64Payload(input.base64)) throw new Error('文件数据不正确或超过12.5MB');
  const buffer = Buffer.from(input.base64, 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD) throw new Error('请选择非空且不超过12.5MB的文件');
  let content = '';
  if (extension === '.docx') {
    const mammoth = await import('mammoth');
    content = (await mammoth.extractRawText({buffer}, {externalFileAccess:false})).value;
  } else if (extension === '.pdf') {
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,stopAtErrors:true});
    try {
      const document = await task.promise;
      if (document.numPages > scaledLimit(200)) throw new Error('单个PDF最多500页');
      for (let pageNo=1;pageNo<=document.numPages;pageNo++) {
        const page=await document.getPage(pageNo), text=await page.getTextContent();
        content += text.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n\n';
        if(content.length>PROCESSING_LIMITS.parsedTextChars)break;
      }
    } finally { await task.destroy(); }
  } else {
    const encoding=buffer[0]===0xff&&buffer[1]===0xfe?'utf-16le':buffer[0]===0xfe&&buffer[1]===0xff?'utf-16be':'utf-8';
    try { content=new TextDecoder(encoding,{fatal:true}).decode(buffer); }
    catch { content=new TextDecoder('gb18030',{fatal:true}).decode(buffer); }
    if (content.includes('\u0000')) throw new Error('文件含二进制数据，无法作为文本读取');
  }
  content=content.replace(/\r\n/g,'\n').trim();
  if(!content)throw new Error('没有提取到文字；扫描PDF需要先做OCR，当前尚未支持');
  const truncated=content.length>PROCESSING_LIMITS.parsedTextChars;
  return {name:input.name,content:content.slice(0,PROCESSING_LIMITS.parsedTextChars),bytes:buffer.length,truncated};
}

export function importUpload(store, file) {
  const count=Math.ceil(file.content.length/scaledLimit(15000));
  if(store.state.notes.length+count>scaledLimit(40))throw new Error('笔记空间不足，Demo最多保存100份笔记或文件分段');
  const documentId=id(), notes=[];
  for(let i=0;i<count;i++)notes.push({id:id(),title:(file.name.slice(0,75)+(count>1?` · ${i+1}/${count}`:'')).slice(0,100),body:file.content.slice(i*scaledLimit(15000),(i+1)*scaledLimit(15000)),updatedAt:now(),source:{documentId,name:file.name,bytes:file.bytes,part:i+1,parts:count,truncated:file.truncated}});
  store.state.notes.push(...notes);store.save();
  return {documentId,name:file.name,characters:file.content.length,parts:count,truncated:file.truncated,noteIds:notes.map(n=>n.id)};
}

if(process.send && process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.once('message',async input=>{
  try{process.send({ok:true,result:await extractUpload(input)});}catch(error){process.send({ok:false,error:String(error.message).slice(0,300)});}
});
