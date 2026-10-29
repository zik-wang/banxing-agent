import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CATALOG_URL,readJson,validateServiceUrl} from '../intranet.mjs';
import {ToolError} from './harness.mjs';
import {classifyFile,decodeSource} from './file-types.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const CONVERTER='node-93--mygpt-lo--p2010',MAX=50*1024*1024;
export class PdfTools{
 constructor(docs,extras,{fetchImpl=fetch}={}){this.docs=docs;this.extras=extras;this.fetch=fetchImpl;}
 async office(bytes,name,signal){
  const options={redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)])};
  const catalog=await readJson(await this.fetch(CATALOG_URL+'/services',options));
  const s=catalog.items?.find(x=>x.id===CONVERTER);
  if(!s?.selected_base_url||s.auth&&s.auth!=='none')throw new ToolError('PDF_CONVERTER_UNAVAILABLE','Registered intranet PDF converter is unavailable or requires unconfigured credentials');
  const base=validateServiceUrl(s.selected_base_url),form=new FormData();form.set('file',new Blob([bytes]),name);
  const response=await this.fetch(base+'/convert/pdf',{...options,method:'POST',body:form}),parts=[];let size=0;
  for await(const b of response.body){size+=b.length;if(size>MAX)throw new ToolError('PDF_RESPONSE_TOO_LARGE','PDF conversion response exceeds 50MB');parts.push(b);}
  const output=Buffer.concat(parts);
  if(!response.ok)throw new ToolError('PDF_CONVERSION_HTTP_ERROR',`Intranet converter HTTP ${response.status}; no PDF delivered`);
  if(output.subarray(0,5).toString()!=='%PDF-')throw new ToolError('INVALID_PDF_RESPONSE','Converter returned non-PDF bytes; no successful artifact registered');
  return {bytes:output,receipt:{serviceId:CONVERTER,url:base+'/convert/pdf',method:'POST',httpStatus:response.status,completedAt:new Date().toISOString()}};
 }
 async convert({asset_id,artifact_id,title},{signal}={}){
  if(!!asset_id===!!artifact_id)throw new ToolError('PDF_SOURCE_REQUIRED','Choose exactly one registered asset_id or artifact_id, never an arbitrary path or URL');
  let a,source;
  if(asset_id){a=this.docs.asset(asset_id);source={path:a.path,name:a.name,sha256:a.sha256,kind:a.kind,assetId:a.id};}
  else{a=this.extras.artifacts.get(artifact_id);if(!a)throw new ToolError('UNKNOWN_ARTIFACT','Import an authorized workspace artifact or use an existing artifactId');const checked=await this.extras.inspect({artifact_id},{signal});if(!checked.exportIntegrityPassed)throw new ToolError('ARTIFACT_READBACK_FAILED','Source artifact failed saved-file validation');source={path:a.path,name:path.basename(a.path),sha256:a.sha256,kind:classifyFile(a.path,fs.readFileSync(a.path)).kind,artifactId:artifact_id};}
  const original=fs.readFileSync(source.path);if(original.length>MAX)throw new ToolError('PDF_INPUT_TOO_LARGE','PDF conversion is limited to 50MB inputs');if(sha(original)!==source.sha256)throw new ToolError('PDF_SOURCE_CHANGED','Source changed before conversion');
  if(!['pdf','word','workbook','text','image'].includes(source.kind))throw new ToolError('PDF_FORMAT_UNSUPPORTED','Supported inputs: DOCX, XLSX, text/Markdown, images, or an existing PDF');
  const id=randomUUID(),folder=path.join(this.docs.directory,'outputs',id);fs.mkdirSync(folder,{recursive:true});
  const stem=String(title||source.name.replace(/\.[^.]+$/,'')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.pdf$/i,'').slice(0,100)||'转换文件',output=path.join(folder,stem+'.pdf');
  let preparation={},receipt;
  if(source.kind==='pdf'){fs.writeFileSync(output,original,{flag:'wx'});receipt={method:'verified_pdf_copy',completedAt:new Date().toISOString()};}
  else if(source.kind==='image'){preparation=await this.docs.worker({operation:'prepare_pdf_input',mode:'image',input:source.path,output},signal);receipt={method:'local_image_pages',completedAt:new Date().toISOString()};}
  else{
   let bytes=original,name='source.docx';
   if(source.kind==='text'){const text=decodeSource(original).text;if(text.length>500000)throw new ToolError('PDF_TEXT_TOO_LARGE','Text conversion is limited to 500000 characters');const utf8=path.join(folder,'source-text.utf8.txt');fs.writeFileSync(utf8,text,{flag:'wx'});const prepared=path.join(folder,'conversion-copy.docx');preparation=await this.docs.worker({operation:'prepare_pdf_input',mode:'text',input:utf8,output:prepared},signal);bytes=fs.readFileSync(prepared);}
   if(source.kind==='workbook'){const prepared=path.join(folder,'conversion-copy.xlsx');preparation=await this.docs.worker({operation:'prepare_pdf_input',mode:'workbook',input:source.path,output:prepared},signal);bytes=fs.readFileSync(prepared);name='source.xlsx';}
   const converted=await this.office(bytes,name,signal);receipt=converted.receipt;fs.writeFileSync(output,converted.bytes,{flag:'wx'});
  }
  if(sha(fs.readFileSync(source.path))!==source.sha256)throw new ToolError('PDF_SOURCE_CHANGED','Original changed during conversion; output not registered');
  if(asset_id)this.docs.asset(asset_id);
  const check=await this.docs.worker({operation:'verify_pdf',input:output,output:path.join(folder,'pdf-text.json')},signal);
  const previews=[];for(const page of [...new Set([1,check.pages])]){const preview=path.join(folder,`page-${page}.png`);await this.docs.worker({operation:'render',input:output,output:preview,page,dpi:96},signal);previews.push(preview);}
  const bytes=fs.readFileSync(output),assetId=randomUUID(),record={artifactId:id,path:output,title:stem,kind:'pdf',sha256:sha(bytes),bytes:bytes.length,pages:check.pages,source,preparation,conversionReceipt:receipt,previews,pdfTextPath:path.join(folder,'pdf-text.json'),contentVerified:false,saveReadbackPassed:true};
  // A derived PDF can be rendered/read with normal document tools; it is not a new original.
  this.docs.assets.set(assetId,{id:assetId,path:output,name:stem+'.pdf',kind:'pdf',format:'pdf',sourceId:asset_id?this.docs.asset(asset_id).sourceId:'artifact:'+artifact_id,...(asset_id?{parentId:asset_id}:{}),sha256:record.sha256,bytes:bytes.length,pages:check.pages,inspected:true,sourceArtifactId:artifact_id||null});record.pdfAssetId=assetId;
  this.extras.artifacts.set(id,record);this.extras.save();this.docs.save();
  return {artifactId:id,pdfAssetId:assetId,path:output,sha256:record.sha256,pages:check.pages,previews,sourceSha256:source.sha256,originalUnchanged:true,exportIntegrityPassed:true,contentVerified:false,preparation,note:'Actual PDF reopened and first/last pages rendered. Text/Markdown keeps literal source text; conversion does not translate, summarize, OCR, or certify that every source fact or layout detail was preserved. Inspect page previews for layout.'};
 }
 tools(){return[{name:'convert_to_pdf',description:'Convert one authorized original asset_id OR existing delivery artifact_id into a real PDF. Supports DOCX Word, XLSX Excel (all visible sheets, fit width), literal text/Markdown, images including multi-frame TIFF, and PDF copies. Preserves original bytes, checks PDF structure/page count and renders first/last previews; returns artifactId and pdfAssetId for normal PDF reading. Never accepts disk paths/URLs. Text conversion preserves Markdown syntax; image PDF is not OCR.',inputSchema:{type:'object',properties:{asset_id:{type:'string',minLength:1,maxLength:200},artifact_id:{type:'string',minLength:1,maxLength:200},title:{type:'string',minLength:1,maxLength:120}},required:[],additionalProperties:false},execute:(a,c)=>this.convert(a,c)}];}
}
