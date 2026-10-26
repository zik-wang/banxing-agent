import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import {readOriginal} from './workspace-files.mjs';
import {readJson} from './intranet.mjs';
import {splitWav} from './wav.mjs';
import {audioMime,isAudioExtension} from './audio-formats.mjs';
import {pcmWavFromAudio} from './audio-decode.mjs';
export function mediaStatus(directory){return Object.fromEntries(['asr','ocr'].map(kind=>[kind,{ready:!!directory.services[kind]?.ready,model:directory.services[kind]?.model|| (kind==='asr'?'内网 Qwen3-ASR':'内网 MinerU'),device:directory.services[kind]?.transport==='local-worker'?'cuda:0':'intranet-api',provider:directory.services[kind]?.transport==='local-worker'?'local':'intranet'}]));}
const stamp=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
async function asrChunks(store,file){
  if(!isAudioExtension(file.extension))throw new Error('这不是可转写的录音格式');
  const original=readOriginal(store,file);
  try{return {chunks:splitWav(original),whole:false};}
  catch(error){if(/最多\d+秒/.test(error.message))throw error;const wav=await pcmWavFromAudio(original,file.extension);if(wav)return {chunks:splitWav(wav),whole:false};return {chunks:null,whole:true,original};}
}
export async function transcribeIntranet(store,directory,file,signal,log=()=>{}){
  if(directory.localMedia)return directory.localMedia.transcribe(store,file,signal,log);
  const service=directory.get('asr'),prepared=await asrChunks(store,file),limited=AbortSignal.any([signal,AbortSignal.timeout(PROCESSING_LIMITS.modelTimeoutMs)]);
  if(prepared.whole){limited.throwIfAborted();log('progress','内网转写整段录音','本机未能按PCM分段，时长限制由识别服务判断',{done:0,total:1});const form=new FormData();form.append('model',service.model);form.append('file',new Blob([prepared.original],{type:audioMime(file.extension)}),'audio'+file.extension);const payload=await readJson(await directory.fetch(service.baseUrl+'/v1/audio/transcriptions',{method:'POST',body:form,signal:limited,redirect:'error'}));if(typeof payload.text!=='string'||!payload.text.trim())throw new Error('内网ASR未返回有效文字');log('progress','已转写整段录音','',{done:1,total:1});return {content:'[整段] '+payload.text.trim(),segments:1,model:service.model,device:'intranet-api'};}
  const chunks=prepared.chunks,lines=[];
  for(let index=0;index<chunks.length;index++){
    limited.throwIfAborted();log('progress',`内网转写第 ${index+1}/${chunks.length} 段`,'',{done:index,total:chunks.length});const chunk=chunks[index],form=new FormData();form.append('model',service.model);form.append('file',new Blob([chunk.bytes],{type:'audio/wav'}),'segment.wav');
    const payload=await readJson(await directory.fetch(service.baseUrl+'/v1/audio/transcriptions',{method:'POST',body:form,signal:limited,redirect:'error'}));if(typeof payload.text!=='string'||!payload.text.trim())throw new Error('内网ASR未返回有效文字');lines.push(`[${stamp(chunk.start)}–${stamp(chunk.end)}] ${payload.text.trim()}`);
    log('progress',`已转写 ${index+1}/${chunks.length} 段`,'',{done:index+1,total:chunks.length});
  }
  return {content:lines.join('\n'),segments:chunks.length,model:service.model,device:'intranet-api'};
}
export async function recognizeIntranet(store,directory,file,signal,log=()=>{}){
  if(directory.localMedia)return directory.localMedia.recognize(store,file,signal,log);
  if(!['.png','.jpg','.jpeg','.pdf'].includes(file.extension))throw new Error('文档识别支持PNG、JPG和PDF');
  const service=directory.get('ocr'),bytes=readOriginal(store,file);
  if(file.extension==='.pdf'){
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,stopAtErrors:true});
    try{const pdf=await loading.promise;if(pdf.numPages>PROCESSING_LIMITS.ocrPages)throw new Error('本轮扫描PDF最多'+PROCESSING_LIMITS.ocrPages+'页，请拆分后重试');}finally{await loading.destroy();}
  }
  log('progress','内网 MinerU 正在解析材料','',{done:null,total:null});const form=new FormData();form.append('files',new Blob([bytes],{type:file.extension==='.pdf'?'application/pdf':file.extension==='.png'?'image/png':'image/jpeg'}),'source'+file.extension);
  for(const [key,value]of Object.entries({backend:'vlm-engine',return_md:'true',return_content_list:'true',return_images:'false',formula_enable:'false',image_analysis:'false',response_format_zip:'false',start_page_id:'0',end_page_id:String(PROCESSING_LIMITS.ocrPages-1)}))form.append(key,value);
  const result=await readJson(await directory.fetch(service.baseUrl+'/file_parse',{method:'POST',body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(scaledLimit(120000))]),redirect:'error'}));
  if(result.status!=='completed'||result.error)throw new Error('内网文档解析未完成：'+String(result.error||result.status));
  const items=Object.values(result.results||{});if(items.length!==1||typeof items[0].md_content!=='string'||!items[0].md_content.trim())throw new Error('文档解析未返回本次文件的文字');
  let records=[];try{records=typeof items[0].content_list==='string'?JSON.parse(items[0].content_list):items[0].content_list||[];}catch{throw new Error('文档页码来源无法解析，请重试');}
  if(!Array.isArray(records)||records.length>scaledLimit(1500)||items[0].md_content.length>PROCESSING_LIMITS.parsedTextChars)throw new Error('识别结果过多，请拆分材料');
  log('progress','内网文档解析完成','',{done:1,total:1});return {content:items[0].md_content,records:records.map((r,index)=>({page:Number(r.page_idx||0)+1,line:index+1,text:r.text||r.table_body||'',box:r.bbox||null})),model:service.model,device:'intranet-api',remoteTaskId:result.task_id};
}

// Page-aware OCR for the document completeness path. Existing invoice/audio
// workflows retain their contracts and limits.
export async function recognizePdfPages(store,directory,file,pages,signal,log=()=>{}){
 if(file.extension!=='.pdf'||!pages.length||pages.length>10||pages.some(n=>!Number.isInteger(n)||n<1))throw Error('OCR需要1至10个明确PDF页码');
 if(directory.localMedia)return directory.localMedia.recognizePages(store,file,pages,signal,log);
 const service=directory.get('ocr'),bytes=readOriginal(store,file),start=Math.min(...pages)-1,end=Math.max(...pages)-1;
 if(end-start>=10)throw Error('OCR请求跨度超过10页，需按连续页段拆分');
 const form=new FormData();form.append('files',new Blob([bytes],{type:'application/pdf'}),'source.pdf');
 for(const [key,value]of Object.entries({backend:'vlm-engine',return_md:'true',return_content_list:'true',return_images:'false',formula_enable:'false',image_analysis:'false',response_format_zip:'false',start_page_id:String(start),end_page_id:String(end)}))form.append(key,value);
 log('ocr','实际请求分页OCR',file.name+' 第'+(start+1)+'—'+(end+1)+'页');
 const payload=await readJson(await directory.fetch(service.baseUrl+'/file_parse',{method:'POST',body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(scaledLimit(120000))]),redirect:'error'}));
 if(payload.status!=='completed'||payload.error)throw Error('OCR未完成：'+String(payload.error||payload.status));
 const values=Object.values(payload.results||{});if(values.length!==1)throw Error('OCR结果文件数量与请求不一致');
 const records=typeof values[0].content_list==='string'?JSON.parse(values[0].content_list):values[0].content_list;
 if(!Array.isArray(records))return {pages:[],executed:true,model:service.model,error:'缺少页面级content_list，禁止把整段markdown分配给所有页面'};
 const mapped=new Map();for(const r of records){if(!Number.isInteger(r.page_idx)||r.page_idx<start||r.page_idx>end)return {pages:[],executed:true,model:service.model,error:'OCR页码不在请求范围内，不能假设相对页码或全页已成功'};const page=r.page_idx+1;if(!pages.includes(page))continue;const text=typeof r.text==='string'?r.text:typeof r.table_body==='string'?r.table_body:'';if(text.trim())mapped.set(page,[...(mapped.get(page)||[]),text]);}
 return {pages:[...mapped].map(([page,lines])=>({page,text:lines.join('\n')})),executed:true,model:service.model,remoteTaskId:payload.task_id||null,requestedPages:pages};
}
