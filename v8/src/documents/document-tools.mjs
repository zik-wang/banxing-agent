import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import {parallelListWarnings} from '../evidence/source-field-guard.mjs';
import JSZip from 'jszip';
import {now} from '../runtime/core.mjs';
import {readOriginal} from '../workspace/workspace-files.mjs';
import {describeImageBytes,imageKind} from '../media/vision.mjs';
import {convertFile} from '../media/multimodal.mjs';
export const VISUAL_EXTENSIONS=['.pdf','.png','.jpg','.jpeg'];
export function visualFiles(store,sources){return sources.flatMap(source=>{const file=store.state.workspaceFiles?.find(f=>f.id===source.id&&f.sha256===source.sha256);return file&&VISUAL_EXTENSIONS.includes(file.extension)?[file]:[];});}
export function planText(files){return files.map((file,index)=>`${index+1}. ${file.name}：先由多模态读一遍，再由OCR读一遍，然后逐项对照`).join('；')+'。号码、日期、金额、抬头两边相同才写成确定值，并标明两边一致；不同就并列两份原文，标待核对。不要折中，不要只信一边。';}
export function audioPlanText(files){return files.map((file,index)=>`${index+1}. ${file.name}：先由内网ASR转写一遍，再由27B通读转写`).join('；')+'。只标出听不清、前后矛盾或和问题对不上的地方。不改ASR原文，不补人名。转写和判断分成两段。';}
const clip=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,500);
async function pdfPageCount(store,file){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(readOriginal(store,file)),isEvalSupported:false,useSystemFonts:false});try{return (await task.promise).numPages;}finally{await task.destroy();}}
export async function imageFromConverted(bytes){
 const kind=imageKind(bytes);if(kind)return {bytes,count:1};
 if(bytes?.subarray(0,2).toString('ascii')!=='PK')throw Error('PDF转图片没有得到PNG或JPEG');
 const zip=await JSZip.loadAsync(bytes),names=Object.keys(zip.files).filter(name=>/\.(png|jpe?g)$/i.test(name)&&!zip.files[name].dir).sort();
 if(!names.length)throw Error('PDF转图片没有得到PNG或JPEG');
 const image=await zip.files[names[0]].async('nodebuffer');if(!imageKind(image))throw Error('PDF转图片没有得到PNG或JPEG');
 return {bytes:image,count:names.length};
}
export async function ocrForChat(workspace,fileId,signal=AbortSignal.timeout(PROCESSING_LIMITS.modelTimeoutMs),log=()=>{}){
 const file=workspace.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('文件不存在');
 if(!VISUAL_EXTENSIONS.includes(file.extension))throw new Error('OCR只接受PDF、PNG、JPG');
 if(file.parseStatus==='needs_ocr')return workspace.recognizeForChat(fileId,signal,log);
 if(file.ocrSupplement?.originalSha256===file.sha256&&file.ocrSupplement.text)return ocrReceipt(file,true);
 const result=await workspace.recognize(file,signal,log);if(signal.aborted)throw new Error('识别已取消');
 const text=result.content;if(typeof text!=='string'||!text.trim()||text.length>PROCESSING_LIMITS.parsedTextChars)throw new Error('需要不超过150000字符的有效识别文字');
 file.ocrSupplement={originalSha256:file.sha256,text,model:result.model||'内网 MinerU',coverage:result.coverage||null,at:now()};workspace.store.save();
 return ocrReceipt(file,false);
}
function ocrReceipt(file,cached){return {fileId:file.id,name:file.name,worker:'intranet-ocr',model:file.ocrSupplement.model,reviewed:false,cached,coverage:file.ocrSupplement.coverage||null,relationWarnings:parallelListWarnings(file.ocrSupplement.text),text:file.ocrSupplement.text,preview:clip(file.ocrSupplement.text),textLayer:file.parseStatus==='ready'&&file.content?file.content.slice(0,PROCESSING_LIMITS.inlineTextChars):null,note:'这是OCR的一次读取，不是核验结论。页码和字段值以实际回执为准；框架、空值和未识别页不能计为逐项一致。'};}
export async function lookForChat(workspace,fileId,question,signal=AbortSignal.timeout(PROCESSING_LIMITS.modelTimeoutMs),log=()=>{}){
 const file=workspace.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('文件不存在');
 if(!VISUAL_EXTENSIONS.includes(file.extension))throw new Error('多模态阅读只接受PDF、PNG、JPG');
 const asked=typeof question==='string'&&question.trim()?question.trim().slice(0,scaledLimit(800)):'请读出可见的发票号码、日期、销售方、金额和币种。看不清就写不确定，不要编。';
 const describe=workspace.describeImage||describeImageBytes;let bytes,note,coverage;
 if(file.extension==='.pdf'){log('step','把PDF转成图片',file.name);let totalPages=null;try{totalPages=await pdfPageCount(workspace.store,file);}catch{/* Conversion may be available when local page enumeration is not. Keep unknown. */}const converted=await (workspace.convertFile||convertFile)(workspace.harness,workspace.store,file,'png',signal);const image=await imageFromConverted(converted);bytes=image.bytes;coverage={totalPages,pages:totalPages===1?[1]:[],pageMapping:totalPages===1?'exact':'unknown',convertedImages:image.count,imagesSent:1,selection:'first_converter_image_only'};note='这是多模态第一遍，只发送'+(image.count>1?`按文件名排序的第一张（共${image.count}张）`:'转出的这一张')+'。原PDF共'+(totalPages??'未知')+'页，转换图片数量不等于已阅读页数。它不是最终结论，读完后还要做OCR；两次调用不代表字段一致，未发送页和未取得字段仍待核。';}
 else {bytes=readOriginal(workspace.store,file);coverage={totalPages:1,pages:[1],pageMapping:'exact',imagesSent:1};note='这是单张图片的一次视觉读取，不是最终核验；以返回的实际字段值为准，空值不能与OCR认定一致。';}
 const text=await describe(workspace.harness,bytes,asked,signal);const model=workspace.harness.directory.capabilities?.find(item=>item.kind==='vision'&&item.ready)?.model||'内网视觉模型';
 file.visionSupplement={originalSha256:file.sha256,text,model,question:asked,coverage,at:now()};workspace.store.save();
 return {fileId:file.id,name:file.name,worker:'intranet-vision',model,text,preview:clip(text),coverage,note};
}
