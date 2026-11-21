const expiry=/(?:信用卡(?:有效期|到期日)|(?:credit\s*card[^\n；;]{0,25})?(?:exp\.?\s*date|expiry\s*date|expiration\s*date))/i;
const dates=/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[/-]\d{2,4})\b/g;
export function guardExportFields(original,files){
 const input=structuredClone(original),issues=[];
 if(!files.length)return {input,issues};
 const supported=new Set();let hasLabel=false;
 for(const file of files){const trusted=[file.content,file.ocrSupplement?.originalSha256===file.sha256?file.ocrSupplement.text:null].filter(Boolean);for(const text of trusted)for(const line of text.replace(/<\/t[dr]>/gi,'\n').split(/\n/)){const m=expiry.exec(line);if(!m)continue;hasLabel=true;const bounded=line.slice(m.index+m[0].length).split(/Invoice|Start\s*Date|End\s*Date|Amount|Customer|签名/i)[0];for(const d of bounded.match(dates)||[])supported.add(d);}}
 for(const sheet of input.sheets||[])for(const [index,row]of sheet.rows.entries()){
  const label=String(row[0]??''),labelIsExpiry=expiry.test(label);
  for(let col=0;col<row.length;col++){if(typeof row[col]!=='string')continue;const value=row[col],match=expiry.exec(value);if(!(labelIsExpiry&&col===1)&&!match)continue;const found=(labelIsExpiry&&col===1?value:value.slice(match.index+match[0].length)).match(dates)||[];const bad=found.filter(d=>!supported.has(d));if(!bad.length)continue;
   row[col]=labelIsExpiry&&col===1?null:bad.reduce((v,d)=>v.replaceAll(d,'〔该字段无可靠依据，待核〕'),value);
   if(row.length>=3)row[2]='该有效期未在对应原文文字字段获得支持；不能借用服务日期，留空/待核。';
   issues.push({sheet:sheet.name,row:index+2,column:col+1,field:'card_expiry',rejected:bad,reason:'no_matching_source_field',status:'needs_confirmation'});
  }
 }
 if(hasLabel&&!supported.size)for(const sheet of input.sheets||[])if(/^(?:字段|field)$/i.test(sheet.headers?.[0]||'')&&!sheet.rows.some(r=>r.some(v=>expiry.test(String(v??''))))){const row=sheet.headers.map(()=>null);row[0]='信用卡有效期';if(row.length>=3)row[2]='原文该栏目未取得有效值，留空/待核；不借用服务日期。';sheet.rows.push(row);issues.push({sheet:sheet.name,row:sheet.rows.length+1,column:2,field:'card_expiry',reason:'source_field_without_value',status:'needs_confirmation'});}
 if(typeof input.content==='string')input.content=input.content.replace(/(?:Exp\.?\s*Date|信用卡有效期)[^\n|]{0,70}/gi,segment=>{const bad=(segment.match(dates)||[]).filter(d=>!supported.has(d));if(!bad.length)return segment;issues.push({field:'card_expiry',rejected:bad,status:'needs_confirmation',reason:'no_matching_source_field'});return bad.reduce((v,d)=>v.replaceAll(d,'〔留空/待核〕'),segment);});
 return {input,issues};
}

// Detect parallel lists, preserving the complete group rather than inventing edges.
export function parallelListWarnings(text=''){
 const blocks=String(text).split(/(?=^#{1,4}\s)/m),warnings=[];
 for(const block of blocks){const fields=block.split('\n').filter(l=>/^(?:Application\s+(?:type|supplier)|Contract\s+(?:expiry|end)[ -]?date)\s*:/i.test(l.trim()));if(fields.length>=2&&fields.filter(l=>/\s&\s/.test(l)).length>=2)warnings.push({heading:block.split('\n')[0],raw:fields.join('\n'),reason:'parallel_lists_do_not_prove_pairing'});}
 return warnings;
}
