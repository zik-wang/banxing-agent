import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{DOMParser}=require('@xmldom/xmldom');
const plain=node=>String(node.textContent||'').replace(/\s+/g,' ').trim();
const boxOK=b=>Array.isArray(b)&&b.length===4&&b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&b[0]<b[2]&&b[1]<b[3];
const openEnd=(text,start)=>{let quote=null;for(let i=start;i<text.length;i++){const c=text[i];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')return i+1;}return -1;};

// The DOM establishes parent/child and row/cell relationships. Source offsets
// always refer to the unchanged original UTF-16 string, never serialized HTML.
export function parseInvoiceTableNodes(text){
 if(typeof text!=='string'||text.length>120000)return [{start:0,end:text?.length||0,rows:[],error:'table_source_budget_exceeded'}];
 if(!/<table\b/i.test(text))return [];
 if(/<!DOCTYPE|<!ENTITY/i.test(text))return [{start:0,end:text.length,rows:[],error:'external_declarations_forbidden'}];
 const prefix='<invoice-root>',wrapped=prefix+text+'</invoice-root>',lines=[0],issues=[];
 for(let i=0;i<wrapped.length;i++)if(wrapped[i]==='\n')lines.push(i+1);
 const dom=new DOMParser({locator:{},errorHandler:{warning:m=>issues.push({severity:'warning',message:m}),error:m=>issues.push({severity:'error',message:m}),fatalError:m=>{throw Error(m);}}});
 let document;try{document=dom.parseFromString(wrapped,'text/html');}catch{return [{start:0,end:text.length,rows:[],error:'html_structure_parse_failed'}];}
 const offset=node=>(lines[(node.lineNumber||1)-1]||0)+(node.columnNumber||1)-1-prefix.length;
 const range=node=>{const start=offset(node),contentStart=openEnd(text,start);if(start<0||contentStart<0)return null;let floor=contentStart;
  for(let child=node.firstChild;child;child=child.nextSibling){if(child.nodeType===1){const r=range(child);if(r)floor=Math.max(floor,r.end);}else if(child.nodeType===3||child.nodeType===4||child.nodeType===8){const at=offset(child);if(at>=0)floor=Math.max(floor,at+String(child.data||'').length+(child.nodeType===8?7:0));}}
  const closing=new RegExp('</'+node.tagName+'\\s*>','ig');closing.lastIndex=floor;const end=closing.exec(text);return end?{start,contentStart,contentEnd:end.index,end:end.index+end[0].length}:null;
 };
 const pending=[{node:document,depth:0}];let visited=0;while(pending.length){const {node,depth}=pending.pop();if(++visited>16000||depth>64)return [{start:0,end:text.length,rows:[],error:'table_structure_budget_exceeded'}];for(let c=node.firstChild;c;c=c.nextSibling)pending.push({node:c,depth:depth+1});}
 const tables=[];let budget=0;const nodes=[...Array.from(document.getElementsByTagName('table'))];
 for(const node of nodes.slice(0,20)){const bounds=range(node);if(!bounds){tables.push({start:Math.max(0,offset(node)),end:text.length,rows:[],error:'unclosed_table'});continue;}
  const table={start:bounds.start,end:bounds.end,rows:[],error:null,parser:'xmldom-structural-dom',parserVersion:'0.8.15',logicalCellsOnly:true,preciseCellBbox:false};
  let nestedParent=false;for(let p=node.parentNode;p;p=p.parentNode)if(p.tagName==='table')nestedParent=true;
  if(node.getElementsByTagName('table').length||nestedParent){table.error='nested_table_not_supported';tables.push(table);continue;}
  const occupied=[];
  for(const rowNode of Array.from(node.getElementsByTagName('tr'))){let parent=rowNode.parentNode;while(parent&&parent!==node&&parent.tagName!=='table')parent=parent.parentNode;if(parent!==node)continue;
   const row=table.rows.length,cells=[];if(row>=300){table.error='row_budget_exceeded';break;}occupied[row]||=[];let col=0;
   for(const cellNode of Array.from(rowNode.childNodes).filter(n=>n.nodeType===1&&/^(td|th)$/i.test(n.tagName))){while(occupied[row][col])col++;const span=n=>{const value=cellNode.getAttribute(n);return value?(/^[1-9]\d{0,2}$/.test(value)?Number(value):NaN):1;},colspan=span('colspan'),rowspan=span('rowspan');
    if(++budget>5000||!Number.isInteger(colspan)||!Number.isInteger(rowspan)||col+colspan>64||rowspan>300){table.error='cell_geometry_budget_exceeded';break;}
    const r=range(cellNode);if(!r||r.contentEnd>bounds.end){table.error='cell_source_range_invalid';break;}
    const cell={row,col,colspan,rowspan,start:r.contentStart,end:r.contentEnd,raw:text.slice(r.contentStart,r.contentEnd),text:plain(cellNode),nodeName:cellNode.tagName.toLowerCase()};cells.push(cell);
    for(let y=row;y<row+rowspan;y++){occupied[y]||=[];for(let x=col;x<col+colspan;x++){if(occupied[y][x])table.error='overlapping_spans';occupied[y][x]=cell;}}col+=colspan;
   }table.rows.push(cells);if(table.error)break;
  }
  // DOM recovery is useful for ordinary HTML syntax, but a malformed closing
  // structure must never silently shift a monetary column.
  const ownIssues=issues.filter(i=>i.severity==='error'&&/unclosed|unexpected|mismatch|invalid/i.test(i.message));if(ownIssues.length)table.error||='malformed_html_structure';
  tables.push(table);if(budget>=5000)break;
 }
 return tables;
}

// Only exact text already read by both readers gets a PDF location. This does
// not normalize unknown MinerU coordinates or claim a whole-table bbox is a cell.
export function bindInvoiceSourceGeometry(sources){
 const natives=sources.filter(s=>s.reader==='pdf_text'&&!s.nativeRiskFlags?.some(r=>/invisible|zero_opacity|overlapping|off_page/.test(r)));
 return sources.map(source=>{if(source.reader!=='ocr'||source.roiId||source.readingScope?.includes('regional')||(source.spatialRecords||[]).some(r=>boxOK(r.bbox)&&!r.geometryOrigin))return source;
  const peers=natives.filter(p=>p.fileId===source.fileId&&p.originalSha256===source.originalSha256&&p.page===source.page);if(!peers.length)return source;
  const strings=new Set(source.text.split('\n').map(s=>s.replace(/^\s*#{1,6}\s*/,'').trim()).filter(s=>s.length>=2&&s.length<=180&&!/[<>]/.test(s)));
  for(const t of parseInvoiceTableNodes(source.text).filter(t=>!t.error))for(const c of t.rows.flat())if(c.text.length>=2&&c.text.length<=180)strings.add(c.text);
  const additions=[];
  for(const text of strings){if(source.text.indexOf(text)!==source.text.lastIndexOf(text))continue;const matches=peers.flatMap(p=>(p.spatialRecords||[]).filter(b=>b.text===text&&boxOK(b.bbox)).map(b=>({p,b})));if(matches.length!==1)continue;
   const {p,b}=matches[0],start=p.text.indexOf(text);if(start<0||p.text.indexOf(text,start+text.length)>=0)continue;
   additions.push({text,page:source.page,bbox:[...b.bbox],coordinateSystem:'normalized_0_1',geometryIndependent:false,geometryOrigin:{method:'exact_cross_reader_pdf_block',sourceId:p.id,originalSha256:p.originalSha256,start,end:start+text.length,quote:text,blockId:b.id||null}});
  }
  if(!additions.length)return source;const original=(source.spatialRecords||[]).filter(r=>!r.geometryOrigin);
  const logicalTables=parseInvoiceTableNodes(source.text).filter(t=>!t.error).map(t=>source.text.slice(t.start,t.end)).filter(text=>!original.some(r=>r.text===text)).map(text=>({text,page:source.page,bbox:null,coordinateSystem:'logical_source_table_only'}));
  return {...source,spatialRecords:[...original,...logicalTables,...additions],geometryBindings:additions.map(r=>({text:r.text,bbox:r.bbox,...r.geometryOrigin})),geometryBindingNotice:'Positions from exact PDF blocks; value remains OCR text; not a third independent reader'};
 });
}
