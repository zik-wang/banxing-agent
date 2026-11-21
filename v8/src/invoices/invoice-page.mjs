import {inspectInvoiceGeometry,renderInvoiceRoi} from './invoice-roi-render.mjs';
import {makeSource,extractLabeled,extractRelationCandidates,validateCandidate,resolveFields,numberField,requiredFields,prepareInvoiceSources} from './invoice-evidence.mjs';
import {monetaryConsistency} from './invoice-disposition.mjs';
export async function inspectInvoicePages(file,bytes,signal,policy){
 const geometry=await inspectInvoiceGeometry(bytes,file.extension,{signal,maxSearchPages:policy.maxPages});
 if(geometry.totalPages>policy.maxPages)throw Object.assign(Error('超过本轮逐份页数预算，原件保留'),{code:'page_limit'});
 return geometry.pages.map(p=>{
  const blocks=geometry.blocks.filter(b=>b.page===p.page).sort((a,b)=>Math.abs(a.bbox[1]-b.bbox[1])<0.006?a.bbox[0]-b.bbox[0]:a.bbox[1]-b.bbox[1]);
  const lines=[];for(const b of blocks){const last=lines.at(-1);if(last&&Math.abs(last.y-b.bbox[1])<0.006)last.parts.push(b.text);else lines.push({y:b.bbox[1],parts:[b.text]});}
  const text=lines.map(l=>l.parts.join(' ')).join('\n'),source=text.trim()?makeSource(file,'pdf_text',text,{page:p.page,model:'pdfjs-native',spatialRecords:blocks,readingScope:'native_pdf_page',verifiedAgainstImage:false}):null;
  const extracted=source?extractPageFields([source]):null,fields=extracted?.fields,quality=[];
  if(!text.trim()||text.replace(/\s/g,'').length<35)quality.push('text_too_sparse');if(/[\ufffd\u0000-\u0008]/.test(text))quality.push('invalid_text_characters');
  const hasImages=(p.sourceQuality?.embeddedImages||[]).length>0;
  if(hasImages&&(!fields||[numberField(fields),'date','total'].some(f=>fields[f].value===null)))quality.push('image_with_incomplete_native_fields');
  quality.push(...(p.sourceQuality?.textPaintRisks||[]));
  if((p.sourceQuality?.embeddedImages||[]).some(i=>i.width>=700&&i.height>=700))quality.push('large_raster_with_text_overlay');
  const competing=Object.entries(fields||{}).filter(([,f])=>f.status==='conflict').map(([field])=>field);
  const locations=new Map();for(const b of blocks.filter(b=>b.text.trim())){const key=b.bbox.map(v=>v.toFixed(3)).join('|'),old=locations.get(key);if(old&&old!==b.text)quality.push('overlapping_native_text');locations.set(key,b.text);}
  if(source){source.nativeRiskFlags=[...new Set(quality)];source.requiresVisualCrosscheck=quality.length>0;source.nativeConflictFields=competing;source.nativeRiskNotice='Heuristic evidence risk flags; does not prove text/image identity';}
  const needsOcr=file.extension!=='.pdf'||quality.length>0;
  return {pageNo:p.page,width:p.width,height:p.height,source,hasImages,quality,needsOcr,status:'pending',originalPage:p};
 });
}
export function extractPageFields(sources){
  sources=prepareInvoiceSources(sources);
 const raw=sources.flatMap(s=>[...extractRelationCandidates(s),...extractLabeled(s,{recovery:true}).map(c=>({field:c.field,value:c.value,sourceId:s.id,quote:c.evidence.quote,origin:'program_label_value_lookup'}))]);
 const candidates=raw.map((c,i)=>({id:'c'+(i+1),phase:'program',raw:c,result:validateCandidate(c,sources,{recovery:true})})),fields=resolveFields(candidates.map(c=>({...c.result,candidateId:c.id})));
 return {candidates,fields,sources};
}
export function inspectFieldProblems(record){
 const f=record.fields,problems=[];for(const field of requiredFields(f))if(f[field].value===null)problems.push({field,kind:f[field].status==='conflict'?'conflict':'missing'});
 const consistency=monetaryConsistency(f);if(consistency.status==='currency_conflict')problems.push({field:'currency',kind:'currency_conflict'});
 if(consistency.status==='inconsistent')problems.push({field:'total',kind:'arithmetic_conflict'});
 const no=f[numberField(f)].value;if(no&&!/^[A-Za-z0-9][A-Za-z0-9./-]{2,79}$/.test(String(no)))problems.push({field:numberField(f),kind:'number_format'});
 return problems;
}
export async function renderBatchPage(file,bytes,pageNo,signal,{dpi=180}={}){
 const r=await renderInvoiceRoi(bytes,file.extension,{id:'page-'+pageNo,page:pageNo,pageIndex:pageNo-1,bbox:[0,0,1,1],fields:[],preprocessing:{rotation:0}},{signal,dpi,maxPixels:16000000,imageScale:1,maxInputBytes:30*1024*1024});return r;
}
export function boundedAmbiguity(sources,problems){
 const patterns={buyer:/购买方|购方|Bill\s*To|Customer|Buyer/i,seller:/销售方|销方|Seller|Supplier|Vendor|Provider|Issued\s*By/i,date:/开票|出具|Issue|Invoice\s*Date/i,invoiceNumber:/发票号|Invoice\s*(?:No|Number|#)/i,billNumber:/账单号|Bill\s*(?:No|Number)/i,total:/价税合计|Amount\s*Due|Grand\s*Total|小写/i,currency:/币种|Currency|CNY|USD/i,documentType:/发票|Invoice|Bill|送货单/i},documents=[],fields=[...new Set(problems.map(p=>p.field))];let remaining=3000;
 for(const source of sources){if(remaining<=0)break;const spans=[];let offset=0;for(const line of source.text.split('\n')){const match=fields.map(f=>patterns[f]&&line.match(patterns[f])).find(Boolean);if(match){const center=match.index,start=offset+Math.max(0,center-80),length=Math.min(500,remaining,line.length-Math.max(0,center-80));if(length>0){spans.push({start,end:start+length});remaining-=length;}}offset+=line.length+1;if(spans.length>=4||remaining<=0)break;}if(spans.length)documents.push({id:source.id,name:source.reader+' page '+source.page,text:spans.map(s=>source.text.slice(s.start,s.end)).join('\n'),originalSha256:source.originalSha256,fileId:source.fileId,projection:{kind:'bounded_target_role_windows',spans}});
 }
 return {documents,fields};
}
