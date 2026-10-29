import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {ToolError} from './harness.mjs';
const str=(n=200)=>({type:'string',minLength:1,maxLength:n});
const arr=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const def=(name,description,inputSchema,execute)=>({name,description,inputSchema,execute});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const empty=x=>x===null||x===undefined||x==='';
const equal=(a,b)=>empty(a)&&empty(b)||JSON.stringify(a)===JSON.stringify(b);

export function combineDatasets(tables,{mode='append',key_columns=[]}={}) {
  if(!tables.length)throw new ToolError('NO_TABLES','Read worksheet tables first');
  const headers=[...new Set(tables.flatMap(t=>t.headers))];
  const keys=key_columns.length?key_columns:headers;
  if(mode==='deduplicate'&&keys.some(k=>!tables.every(t=>t.headers.includes(k))))throw new ToolError('INVALID_KEY','Key columns must be present in every source table');
  const rows=[],provenance=[],seen=new Map(),removed=[],conflicts=[],enrichedCells=[];
  for(const table of tables)for(let i=0;i<table.rows.length;i++) {
    const row=headers.map(h=>{const c=table.headers.indexOf(h);return c<0?null:table.rows[i][c]??null;});
    const refs=table.provenance?.[i]||[{assetId:table.sourceId,sheet:table.sheet,row:table.headerRow+i+1}];
    const key=JSON.stringify(keys.map(k=>row[headers.indexOf(k)]));
    const indices=mode==='deduplicate'?(seen.get(key)||[]):[];
    let match=-1;
    for(const index of indices) {
      const incompatible=headers.filter((h,c)=>!empty(rows[index][c])&&!empty(row[c])&&!equal(rows[index][c],row[c]));
      if(!incompatible.length){match=index;break;}
      conflicts.push({key,keyColumns:keys,columns:incompatible,keptRow:index+1,incoming:refs});
    }
    if(match>=0) {
      row.forEach((v,c)=>{if(empty(rows[match][c])&&!empty(v)){rows[match][c]=v;enrichedCells.push({outputDataRow:match+1,column:headers[c],value:v,from:refs});}});
      provenance[match].push(...refs);removed.push({key,keptRow:match+1,removedSource:refs});
    } else {
      rows.push(row);provenance.push([...refs]);seen.set(key,[...indices,rows.length-1]);
    }
  }
  return {headers,rows,provenance,sourceIds:[...new Set(tables.flatMap(t=>t.sourceIds||[t.sourceId]))],mode,keyColumns:mode==='deduplicate'?keys:[],inputRows:tables.reduce((n,t)=>n+t.rows.length,0),inputTableRows:tables.map(t=>t.rows.length),outputRows:rows.length,removed,conflicts,enrichedCells};
}

export class WorkbookTools {
  constructor(documents,extras,{artifactModule}={}) {this.docs=documents;this.extras=extras;this.artifactModule=artifactModule;this.tables=new Map();documents.workbookTools=this;}
  save(){fs.writeFileSync(path.join(this.docs.directory,'tables.json'),JSON.stringify([...this.tables.values()],null,2));}
  summary(table) {
    const resultId=randomUUID(),answer=JSON.stringify({headers:table.headers,rows:table.rows},null,2);
    this.docs.results.set(resultId,{resultId,answer,method:'table_data',status:'returned_unverified',tableId:table.id});this.docs.save();
    return {tableId:table.id,headers:table.headers,rowCount:table.rows.length,resultId,text:answer.slice(0,5000),nextOffset:answer.length>5000?5000:null,totalChars:answer.length};
  }
  async read({asset_id,sheet,header_row=1},{signal}) {
    const a=this.docs.asset(asset_id);await this.docs.inspect(a.id,signal);
    if(a.kind!=='workbook')throw new ToolError('INPUT_TYPE_UNSUPPORTED','Requires XLSX');
    const data=await this.docs.worker({operation:'read_workbook',input:a.path},signal);
    const selected=data.sheets.find(s=>s.name===sheet);
    if(!selected)throw new ToolError('UNKNOWN_SHEET','Use a sheet name from inspect_material');
    if(selected.formulas.length)throw new ToolError('FORMULAS_UNSUPPORTED','Formula reference rewriting is not supported in this table merger; source is preserved');
    const headers=selected.rows[header_row-1]?.map(v=>String(v??''));
    if(!headers?.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new ToolError('INVALID_HEADERS','Headers must be nonempty and unique');
    const rows=selected.rows.slice(header_row).filter(row=>row.some(v=>!empty(v))).map(row=>headers.map((_,i)=>row[i]??null));
    const table={id:randomUUID(),sourceId:a.id,sourceIds:[a.id],sheet,headerRow:header_row,headers,rows,provenance:selected.rows.slice(header_row).map((row,i)=>({row,index:i})).filter(x=>x.row.some(v=>!empty(v))).map(x=>[{assetId:a.id,sheet,row:header_row+x.index+1}])};
    this.tables.set(table.id,table);this.save();return this.summary(table);
  }
  merge({table_ids,mode='append',key_columns=[]}) {
    const selected=table_ids.map(id=>{const t=this.tables.get(id);if(!t)throw new ToolError('UNKNOWN_TABLE','Read a worksheet table first');return t;});
    const table={id:randomUUID(),...combineDatasets(selected,{mode,key_columns})};this.tables.set(table.id,table);this.save();
    return {...this.summary(table),mode:table.mode,inputRows:table.inputRows,outputRows:table.outputRows,keyColumns:table.keyColumns,removedRows:table.removed.length,conflictingKeys:table.conflicts.length,note:'Headers are aligned by exact column names. Append preserves every row. Deduplication only runs when explicitly selected. Conflicting nonempty values are kept as separate records.'};
  }
  async export({table_id,title},{signal}) {
    const table=this.tables.get(table_id);if(!table)throw new ToolError('UNKNOWN_TABLE','Select an existing table ID');
    if(!this.artifactModule)throw new ToolError('EXPORT_NOT_CONFIGURED','Host must configure artifact-tool');
    const {Workbook,SpreadsheetFile}=await import(pathToFileURL(this.artifactModule).href);
    const book=Workbook.create(),sheet=book.worksheets.add('合并报表'),id=randomUUID(),folder=path.join(this.docs.directory,'outputs',id);
    fs.mkdirSync(folder,{recursive:true});
    const raw=[table.headers,...table.rows];
    const values=raw.map(r=>r.map(v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v));
    const used=sheet.getRangeByIndexes(0,0,raw.length,table.headers.length);used.values=values;used.format.wrapText=true;used.format.verticalAlignment='top';used.format.columnWidth=24;used.format.rowHeight=48;
    table.headers.forEach((h,c)=>{const column=sheet.getRangeByIndexes(0,c,raw.length,1);column.format.columnWidth=h.includes('名称')||h==='来源说明'?44:24;if(table.rows.every(r=>empty(r[c])||typeof r[c]==='number'))sheet.getRangeByIndexes(1,c,table.rows.length,1).setNumberFormat(h.includes('金额')?'#,##0.00':'0');});
    table.rows.forEach((row,r)=>{const lines=Math.max(...row.map((v,c)=>Math.ceil([...String(v??'')].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/(table.headers[c].includes('名称')||table.headers[c]==='来源说明'?40:20))));sheet.getRangeByIndexes(r+1,0,1,table.headers.length).format.rowHeightPx=Math.max(44,lines*20+12);});
    const header=sheet.getRangeByIndexes(0,0,1,table.headers.length);header.format.fill='#E6EEF5';header.format.font={bold:true};sheet.freezePanes.freezeRows(1);
    book.recalculate();
    const output=path.join(folder,'合并报表.xlsx');
    this.docs.onArtifactIntent?.({artifactId:id,path:output,title,expected:[{name:'合并报表',raw}],tableId:table.id});
    await(await SpreadsheetFile.exportXlsx(book)).save(output);
    this.docs.onArtifactWritten?.({artifactId:id,path:output,title,sha256:sha(fs.readFileSync(output)),expected:[{name:'合并报表',raw}],tableId:table.id,previews:[],previewErrors:[],contentVerified:false});
    const preview=path.join(folder,'preview.png');let previewErrors=[];
    try {const blob=await book.render({sheetName:'合并报表',range:`A1:${columnLabel(table.headers.length)}${Math.min(12,raw.length)}`,scale:1,format:'png'});fs.writeFileSync(preview,new Uint8Array(await blob.arrayBuffer()));}catch(e){previewErrors=[{error:e.message}];}
    const enrichedColumns=[...new Set((table.enrichedCells||[]).map(c=>c.column))].map(column=>({column,rows:table.enrichedCells.filter(c=>c.column===column).map(c=>c.outputDataRow)}));
    const deliveryFacts={dataRows:table.rows.length,columns:table.headers.length,inputTableRows:table.inputTableRows||[table.rows.length],removedRows:table.removed?.length||0,conflictingKeys:table.conflicts?.length||0,enrichedColumns,numericColumns:table.headers.map((name,c)=>({name,numericCells:table.rows.filter(r=>typeof r[c]==='number').length})).filter(c=>c.numericCells)};
    const record={artifactId:id,path:output,title,sha256:sha(fs.readFileSync(output)),expected:[{name:'合并报表',raw}],previews:previewErrors.length?[]:[preview],previewErrors,tableId:table.id,deliveryFacts,contentVerified:false};
    this.extras.artifacts.set(id,record);this.extras.save();
    return {artifactId:id,path:output,sha256:record.sha256,dataRows:table.rows.length,columns:table.headers.length,tableId:table.id,previewErrors,note:'The saved workbook preserves table values and numeric types. Use validate_artifact to read back all saved cells.'};
  }
  tools(){return [
    def('read_workbook','Read one XLSX worksheet table, retaining values, headers, numeric types and source row references. Does not change rows. Sheet names come from inspect_material. Large result is paginated through read_result.',obj({asset_id:str(),sheet:str(),header_row:{type:'integer',minimum:1,maximum:50}},['asset_id','sheet']),(a,c)=>this.read(a,c)),
    def('merge_tables','Combine previously read tables by exact column names, aligning different column orders and retaining all columns. Default mode append keeps every row. Optional deduplicate uses key_columns (default all columns), enriches empty values, and retains conflicts as separate rows.',obj({table_ids:arr(str(),2,10),mode:{...str(),enum:['append','deduplicate']},key_columns:arr(str(),0,40)},['table_ids']),async a=>this.merge(a)),
    def('export_table','Save a registered table as an actual XLSX without manually retyping rows. Preserves numeric types and original column names. All source rows stay in tool records; this tool does not change or select rows.',obj({table_id:str(),title:str(100)}),(a,c)=>this.export(a,c))
  ];}
}
function columnLabel(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
