// RFC4180-style parsing for export validation; preserves strings and original bytes.
export function parseCsv(text){
 if(typeof text!=='string'||!text.length||text.length>240000)throw Error('CSV_CONTENT_REQUIRED');
 if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const field=()=>{row.push(cell);cell='';closed=false;};
 const line=()=>{field();rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw Error('CSV_INVALID_QUOTE');quoted=true;}
  else if(c===',')field();
  else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;line();}
  else {if(closed)throw Error('CSV_CHAR_AFTER_QUOTE');cell+=c;}
 }
 if(quoted)throw Error('CSV_UNCLOSED_QUOTE');
 if(cell||closed||row.length)line();
 if(!rows.length||rows[0].some(c=>!c.trim())||new Set(rows[0]).size!==rows[0].length)throw Error('CSV_INVALID_HEADER');
 if(rows.some(r=>r.length!==rows[0].length))throw Error('CSV_ROW_WIDTH_MISMATCH');
 return rows;
}
export async function exportCsv(delivery,{title,text,source_ids=[],result_ids=[]}){
 const rows=parseCsv(text),name=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100).replace(/\.csv$/i,'')||'交付';
 const artifact=delivery.register({title,filename:name+'.csv',bytes:Buffer.from(text,'utf8'),sourceIds:source_ids,resultIds:result_ids,sourceContentVerified:false,csv:{headers:rows[0],dataRows:rows.length-1,columns:rows[0].length,scope:'CSV structure/save integrity only; merge, arithmetic and source correctness require separate checks'}});
 const fs=await import('node:fs');if(JSON.stringify(parseCsv(fs.readFileSync(artifact.path,'utf8')))!==JSON.stringify(rows))throw Error('CSV_READBACK_MISMATCH');
 return {...artifact,csvReadbackPassed:true};
}
