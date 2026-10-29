import {randomUUID} from 'node:crypto';
import {ToolError} from './harness.mjs';
function canonical(text){
 let value='',starts=[],ends=[];
 for(let i=0;i<text.length;i++){
  if(/\s/u.test(text[i])){let end=i+1;while(end<text.length&&/\s/u.test(text[end]))end++;if(value&&!value.endsWith(' ')){value+=' ';starts.push(i);ends.push(end);}i=end-1;}
  else{value+=text[i];starts.push(i);ends.push(i+1);}
 }
 if(value.endsWith(' ')){value=value.slice(0,-1);starts.pop();ends.pop();}
 return {value,starts,ends};
}
function uniqueSpan(haystack,needle){
 const h=canonical(haystack),n=canonical(needle).value;if(!n)throw new ToolError('EMPTY_SOURCE_QUOTE','Source quote/value must not be empty');
 const at=h.value.indexOf(n);
 if(at<0)throw new ToolError('SOURCE_QUOTE_NOT_FOUND','Quote, label or value was not found verbatim (whitespace only is normalized); do not abbreviate, translate or change and/&');
 if(h.value.indexOf(n,at+1)>=0)throw new ToolError('SOURCE_QUOTE_AMBIGUOUS','The quote or value occurs multiple times; include enough original context to identify it uniquely');
 return {start:h.starts[at],end:h.ends[at+n.length-1]};
}
export async function bindSourceFields(records,{asset_id,fields},ctx){
 const a=records.docs.asset(asset_id);await records.read({asset_id,limit:1},ctx);const source=records.sources.get(a.id),pending=[];
 for(const field of fields){
  if(!source.pages.includes(field.page))throw new ToolError('PAGE_OUT_OF_RANGE','Choose a physical source page actually read');
  let text;if(a.kind==='text')text=records.texts.source(a.id).text;else{let saved=[...records.docs.results.values()].find(r=>r.sourceId===a.id&&r.page===field.page&&r.method==='pdf_text');if(!saved){const r=await records.extras.text({asset_id:a.id,page:field.page},ctx);saved=records.docs.results.get(r.resultId);}text=saved.answer;}
  const span=uniqueSpan(text,field.quote),quote=text.slice(span.start,span.end),label=uniqueSpan(quote,field.label),value=uniqueSpan(quote,field.value);
  const evidence=range=>({sourceId:a.id,sourceSha256:a.sha256,page:field.page,start:span.start+range.start,end:span.start+range.end,quote:quote.slice(range.start,range.end)});
  pending.push({id:randomUUID(),sourceId:a.id,heading:null,fields:[{key:quote.slice(label.start,label.end),value:quote.slice(value.start,value.end),evidence:evidence(value),labelEvidence:evidence(label),contextEvidence:{...evidence({start:0,end:quote.length})},displayLabel:field.display_label||null}],scope:'Verbatim spans located in the supplied quote; label/value semantic relationship has NOT been independently verified',origin:'quote_bound',semanticRelationsVerified:false});
 }
 // Atomic at the batch level: an invalid final field must not partly register earlier fields.
 for(const r of pending){records.records.set(r.id,r);source.records.push(r.id);}records.save();
 return {sourceId:a.id,recordIds:pending.map(r=>r.id),records:pending,contentVerified:false,note:'Located original quote/label/value spans, allowing whitespace differences only. Original strings are exported from the source, never model replacements. This does not validate label/value relationships, payment status, supplier roles or inferred deadlines. Use export_source_records layout=field_rows.'};
}
