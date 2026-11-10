import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ToolError} from './harness.mjs';
import {renderWorkbookPreview} from './workbook-preview.mjs';

const str=(maxLength=200,minLength=1)=>({type:'string',minLength,maxLength});
const int=(minimum,maximum)=>({type:'integer',minimum,maximum});
const arr=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const definition=(name,description,inputSchema,execute)=>({name,description,inputSchema,execute});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function checkSpreadsheetSourceMode(docs,sourceRefs,mode='verbatim') {
  const kinds=sourceRefs.map(r=>docs.asset(r.asset_id).kind);
  if(kinds.includes('workbook'))throw new ToolError('TYPED_TABLE_REQUIRED','Read/merge registered workbook table IDs and use export_table; do not retype numeric cells through text-only Excel.');
  if(!kinds.includes('pdf'))return;
  if(mode!=='interpreted'||docs.factProfile==='expiry')throw new ToolError('SOURCE_RECORDS_REQUIRED','For printed key/value lists use read_source_records/export_source_records. For mixed-layout documents that do not fit those records, read the source pages and use export_xlsx with source_mode="interpreted"; retain unresolved fields and source_refs. Interpreted values are not source-verified. Expiry facts must use the registered fact ledger.');
  for(const ref of sourceRefs){
    if(docs.asset(ref.asset_id).kind!=='pdf')continue;
    const read=[...docs.results.values()].some(r=>r.sourceId===ref.asset_id&&r.page===ref.page&&['pdf_text','vision','vision_extract','ocr'].includes(r.method)&&typeof r.answer==='string'&&r.answer.trim());
    if(!read)throw new ToolError('SOURCE_PAGE_NOT_READ','Read every cited PDF page before exporting interpreted values; reading is not semantic verification.');
  }
}

// No scenario names, expected answers or fixed processing pipelines belong here.
export class DocumentExtras {
  constructor(documents,{artifactModule,docxModule,sourceConstraints=false}={}) {
    this.docs=documents; this.artifactModule=artifactModule; this.docxModule=docxModule||(artifactModule?path.resolve(path.dirname(artifactModule),'../../../docx/dist/index.mjs'):undefined); this.artifacts=new Map();this.sourceConstraints=sourceConstraints;
  }
  save() {fs.writeFileSync(path.join(this.docs.directory,'artifacts.json'),JSON.stringify([...this.artifacts.values()],null,2));}
  async text({asset_id,page}, {signal}) {
    const d=this.docs,a=d.asset(asset_id);
    if(a.kind!=='pdf') throw new ToolError('INPUT_TYPE_UNSUPPORTED','Requires a PDF');
    await d.inspect(a.id,signal);
    if(page>a.pages) throw new ToolError('PAGE_OUT_OF_RANGE',`PDF has ${a.pages} pages`);
    const result=await d.worker({operation:'pdf_text',input:a.path,page},signal);
    const resultId=randomUUID(),record={resultId,assetId:a.id,sourceId:a.sourceId,page,rootBox:null,method:'pdf_text',status:result.text.trim()?'returned_unverified':'partial',answer:result.text,quality:{contentVerified:false,completeness:'unverified'}};
    d.results.set(resultId,record);d.save();
    return {resultId,sourceId:a.sourceId,page,totalPages:a.pages,method:'pdf_text',partial:!result.text.trim(),text:result.text.slice(0,5000),totalChars:result.text.length,nextOffset:result.text.length>5000?5000:null,contentVerified:false,note:'Text layer can have incorrect order, invisible text or missing scanned content. Compare visible layout for ambiguous fields. Read adjacent pages for continued entries.'};
  }
  async export({title,sheets,source_refs,source_mode='verbatim'},{signal,sourceProjectionAuthorized=false}) {
    if(this.docs.privateAudioMetadataOnly)throw new ToolError('SAVED_TRANSCRIPT_REQUIRED','Private audio can only be exported from its actual saved result_ids using export_document; do not fabricate a text-only spreadsheet.');
    if(this.sourceConstraints&&!sourceProjectionAuthorized)checkSpreadsheetSourceMode(this.docs,source_refs,source_mode);
    if(!this.artifactModule) throw new ToolError('EXPORT_NOT_CONFIGURED','Host must configure the artifact-tool module');
    const d=this.docs;
    for(const ref of source_refs) {
      const a=d.asset(ref.asset_id);await d.inspect(a.id,signal);
      if(a.sourceId!==a.id || ref.page>(a.pages||1)) throw new ToolError('INVALID_SOURCE_REF','Use original source IDs and existing physical page numbers');
    }
    const names=new Set();
    for(const s of sheets) {
      if(/[\\/?*\[\]:]/.test(s.name)||names.has(s.name.toLowerCase())) throw new ToolError('INVALID_SHEET_NAME','Sheet names must be unique and valid');
      names.add(s.name.toLowerCase());
      if(s.rows.some(r=>r.length!==s.headers.length)) throw new ToolError('RAGGED_TABLE','Every data row must have exactly the header width');
    }
    const {Workbook,SpreadsheetFile}=await import(pathToFileURL(this.artifactModule).href);
    const book=Workbook.create(),id=randomUUID(),folder=path.join(d.directory,'outputs',id);
    fs.mkdirSync(folder,{recursive:true});
    const sources=source_refs.map(r=>`${d.asset(r.asset_id).name} 第${r.page}页`).join('；');
    const expected=[],serializationTransformations=[];
    for(const spec of sheets) {
      const sheet=book.worksheets.add(spec.name),columns=spec.headers.length;
      const originalRaw=[[title,...Array(columns-1).fill('')],['来源：'+sources,...Array(columns-1).fill('')],spec.headers,...spec.rows];
      const raw=originalRaw.map((row,r)=>row.map((value,c)=>{const displayed=value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,ch=>'⟦U+'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'⟧');if(displayed!==value)serializationTransformations.push({sheet:spec.name,row:r+1,column:c+1,original:value,displayed,reason:'Original contains characters forbidden by XML/XLSX; exact original retained in this JSON and source evidence'});return displayed;}));
      // Values only: source text must never become an executable spreadsheet formula.
      const values=raw.map(row=>row.map(v=>v.startsWith('=')?"'"+v:v));
      sheet.getRangeByIndexes(0,0,values.length,columns).values=values;
      const used=sheet.getRangeByIndexes(0,0,values.length,columns);
      used.setNumberFormat('@');used.format.wrapText=true;used.format.columnWidth=30;used.format.rowHeight=48;
      used.format.verticalAlignment='top';
      const lines=s=>s.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((w,ch)=>w+(ch.charCodeAt(0)>255?2:1),0)/26)),0);
      raw.slice(2).forEach((row,index)=>{sheet.getRangeByIndexes(index+2,0,1,columns).format.rowHeightPx=Math.max(42,Math.max(...row.map(lines))*20+16);});
      sheet.getRangeByIndexes(0,0,1,columns).merge();sheet.getRangeByIndexes(1,0,1,columns).merge();
      sheet.getRangeByIndexes(0,0,1,columns).format.rowHeightPx=48;
      sheet.getRangeByIndexes(1,0,1,columns).format.rowHeightPx=Math.max(42,Math.ceil([...raw[1][0]].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/(26*columns))*20+16);
      sheet.getRangeByIndexes(0,0,1,columns).format.font={bold:true,size:15};
      const header=sheet.getRangeByIndexes(2,0,1,columns);header.format.fill='#E6EEF5';header.format.font={bold:true};
      sheet.freezePanes.freezeRows(3);
      expected.push({name:spec.name,raw});
    }
    book.recalculate();
    const checks=await book.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?',options:{useRegex:true,maxResults:30},maxChars:2000});
    fs.writeFileSync(path.join(folder,'authoring-check.json'),JSON.stringify(checks,null,2));
    const output=path.join(folder,'清单.xlsx');await (await SpreadsheetFile.exportXlsx(book)).save(output);
    const previews=[],previewErrors=[];
    if(serializationTransformations.length)fs.writeFileSync(path.join(folder,'source-character-transformations.json'),JSON.stringify(serializationTransformations,null,2));
    const record={artifactId:id,path:output,title,sha256:digest(fs.readFileSync(output)),source_refs,sourceMode:sourceProjectionAuthorized?'registered_source_projection':source_mode,expected,previews,previewErrors,serializationTransformations,contentVerified:false,...(this.docs.executionRepair?{operationKey:this.docs.activeOperationKey||null}:{}),...(this.docs.activeFactProjection?{factProjection:this.docs.activeFactProjection}:{})};
    this.artifacts.set(id,record);this.save();
    if(this.docs.executionRepair)this.docs.onArtifactWritten?.(record);
    for(let i=0;i<sheets.length;i++) {
      const result=await renderWorkbookPreview({artifactModule:this.artifactModule,input:output,output:path.join(folder,`preview-${i+1}.png`),sheetName:sheets[i].name,range:`A1:${columnLabel(sheets[i].headers.length)}${Math.min(sheets[i].rows.length+3,13)}`},{signal});
      if(result.ok)previews.push(result.path);else previewErrors.push({sheet:sheets[i].name,...result.error});
      if(signal?.aborted)break;
    }
    this.save();
    return {artifactId:id,path:output,sha256:record.sha256,sheets:sheets.map(s=>({name:s.name,dataRows:s.rows.length,columns:s.headers.length})),previews,previewErrors,contentVerified:false,note:'Export preserves model-supplied values; it does not certify them against the sources. Use validate_artifact for saved-file readback.'};
  }
  async inspect({artifact_id},{signal}) {
    const a=this.artifacts.get(artifact_id);
    if(!a) throw new ToolError('UNKNOWN_ARTIFACT','Use an artifact ID returned by export_xlsx');
    if(digest(fs.readFileSync(a.path))!==a.sha256) throw new ToolError('ARTIFACT_CHANGED','Exported artifact changed');
    if(a.kind==='pdf'){
      const textPath=path.join(path.dirname(a.path),'pdf-text.json');
      const document=await this.docs.worker({operation:'verify_pdf',input:a.path,output:textPath},signal);
      a.pdfTextPath=textPath;a.saveReadbackPassed=true;this.save();
      return {artifactId:a.artifactId,path:a.path,sha256:a.sha256,exportIntegrityPassed:true,document,contentVerified:false,note:'PDF structure and saved bytes checked; source completeness and layout require separate review.'};
    }
    if(a.kind==='docx'){
      const document=await this.docs.worker({operation:'inspect_docx',input:a.path},signal),exportIntegrityPassed=document.packageValid&&JSON.stringify(document.paragraphs)===JSON.stringify(a.expectedWord.paragraphs)&&JSON.stringify(document.tables)===JSON.stringify(a.expectedWord.tables)&&(!a.expectedWord.blocks||JSON.stringify(document.blocks)===JSON.stringify(a.expectedWord.blocks));
      const result={artifactId:a.artifactId,path:a.path,sha256:a.sha256,exportIntegrityPassed,document,contentVerified:false};a.saveReadbackPassed=exportIntegrityPassed;this.save();fs.writeFileSync(path.join(path.dirname(a.path),'readback.json'),JSON.stringify(result,null,2));return result;
    }
    if(a.kind==='text'||a.kind==='audio'){
      const bytes=fs.readFileSync(a.path),exportIntegrityPassed=digest(bytes)===a.expectedBytesSha256;
      const result={artifactId:a.artifactId,path:a.path,sha256:a.sha256,exportIntegrityPassed,bytes:bytes.length,contentVerified:false,note:'Actual text/patch bytes reopened; save integrity does not prove factual or code correctness.'};
      a.saveReadbackPassed=exportIntegrityPassed;this.save();fs.writeFileSync(path.join(path.dirname(a.path),'readback.json'),JSON.stringify(result,null,2));return result;
    }
    const readback=await this.docs.worker({operation:'inspect_xlsx',input:a.path},signal);
    const discrepancies=[];
    for(let i=0;i<a.expected.length;i++) {
      const expected=a.expected[i],actual=readback.sheets[i];
      if(!actual||actual.name!==expected.name||actual.rows.length!==expected.raw.length) discrepancies.push({sheet:expected.name,issue:'shape mismatch'});
      if(actual?.formulas.length) discrepancies.push({sheet:expected.name,issue:'unexpected formulas',cells:actual.formulas});
      expected.raw.forEach((row,r)=>row.forEach((value,c)=>{if(!isDeepStrictEqual(actual?.rows[r]?.[c]??'',value??'')) discrepancies.push({sheet:expected.name,row:r+1,column:c+1,expected:value,actual:actual?.rows[r]?.[c]??null});}));
    }
    const resultId=randomUUID(),answer=JSON.stringify({sheets:readback.sheets},null,2);
    this.docs.results.set(resultId,{resultId,answer,method:'artifact_readback',status:'returned_unverified',artifactId:a.artifactId});this.docs.save();
    const result={artifactId:a.artifactId,path:a.path,exportIntegrityPassed:discrepancies.length===0,discrepancies,resultId,text:answer.slice(0,5000),totalChars:answer.length,nextOffset:answer.length>5000?5000:null,contentVerified:false,note:'Checks saved cells against export arguments only. This is not independent source verification.'};
    a.saveReadbackPassed=result.exportIntegrityPassed;this.save();fs.writeFileSync(path.join(path.dirname(a.path),'readback.json'),JSON.stringify({...result,sheets:readback.sheets},null,2));return result;
  }
  async validateDelivery({artifact_id},context) {
    const result=await this.inspect({artifact_id},context);
    const artifact=this.artifacts.get(artifact_id);
    const table=this.docs.workbookTools?.tables.get(artifact?.tableId);
    if(table?.mode!=='append_new'||!result.exportIntegrityPassed)return result;
    return {
      artifactId:artifact_id,sha256:artifact.sha256,exportIntegrityPassed:true,contentVerified:false,
      checkedSheets:artifact.expected.map(({name,raw})=>({name,dataRows:raw.length-1,columns:raw[0].length})),
      deliveryFacts:artifact.deliveryFacts,
      note:'The saved workbook was reopened and all cells in both the main and any review worksheets were checked. Use this receipt to report the delivery. Full readback is retained by the host; pagination is unnecessary for this validation.',
    };
  }
  tools() {
    return [
      definition('extract_pdf_text','Extract one physical PDF page text layer without a model. Useful for exact original spelling. Does not prove visual layout or row pairing. For empty scans use render_pdf_page and vision_extract. Drain nextOffset with read_result.',obj({asset_id:str(),page:int(1,10000)}),(a,c)=>this.text(a,c)),
      definition('export_xlsx','Export supplied tables to a real downloadable Excel workbook. All cells are literal strings, no formulas or automatic date conversion. For mixed-layout PDF extraction, first read cited pages, then explicitly set source_mode=interpreted; values remain semantically unverified. Preserve original values and ambiguous fields as unresolved. Printed key/value or expiry lists should use export_source_records. Workbook inputs require export_table. source_refs belongs at the top level, not inside sheets.',obj({title:str(100),sheets:arr(obj({name:str(31),headers:arr(str(120),1,30),rows:arr(arr(str(2048,0),1,30),1,500)}),1,8),source_refs:arr(obj({asset_id:str(),page:int(1,10000)}),1,100),source_mode:{type:'string',enum:['verbatim','interpreted']}},['title','sheets','source_refs']),(a,c)=>this.export(a,c)),
      definition('validate_artifact','Reopen an exported XLSX or DOCX and compare every saved cell/paragraph to export arguments. Append-new ledgers return a complete integrity receipt with both sheet counts; do not repaginate to verify the save. Export integrity is NOT factual correctness or full source coverage.',obj({artifact_id:str()}),(a,c)=>this.validateDelivery(a,c))
    ];
  }
}
function columnLabel(n) {let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
