import {createHash} from 'node:crypto';
const readers=new Set(['discover_tools','read_text_range','read_word_document','read_json_range','search_document','extract_pdf_text','vision_extract','read_workbook','read_artifact','read_result','read_tool_receipt','processing_status','inspect_material','list_materials']);
const volatile=new Set(['callId','resultId','operationId','recoveredReceipt','elapsedMs','createdAt','checkedAt','finishedAt','startedAt','remainingCalls','path','query','note','warning']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!volatile.has(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
export class EvidenceProgress{
 constructor(){this.seen=new Set();this.streak=0;this.last=null;}
 observe(tool,args,result){
  if(result.data?.metaOnly)return null;
  if(!readers.has(tool)){if(result.status==='ok'&&tool!=='discover_tools')this.streak=0;return null;}
  if(result.status==='error')return null;
  // Source identity, actual returned ranges/cells/regions and cursor remain in the
  // signature. New call/result IDs and alternate query wording are not new evidence.
  const scope=Object.fromEntries(Object.entries(args||{}).filter(([k])=>/asset|artifact|resource|revision|offset|cursor|pointer|page|box|region|start|end/.test(k)));
  const hash=createHash('sha256').update(JSON.stringify(canonical({scope,data:result.data}))).digest('hex'),seen=this.seen.has(hash);this.seen.add(hash);this.streak=seen?this.streak+1:0;this.last={tool,evidenceHash:hash,unchanged:seen,consecutiveUnchanged:this.streak};return this.last;
 }
 get blocked(){return this.streak>=3;}
}
