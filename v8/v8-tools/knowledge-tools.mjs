import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {ToolError} from './harness.mjs';import {lineIndex} from './text-tools.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),str=n=>({type:'string',minLength:1,maxLength:n}),obj=(p,r=Object.keys(p))=>({type:'object',properties:p,required:r,additionalProperties:false});
// Keep ordinary source lines intact. Very long lines remain explicitly partial;
// matching twice in one line must not create two differently clipped "sentences".
export function knowledgeQuote(text,starts,line,matchStart,matchLength){
 const lineStart=starts[line],lineEnd=starts[line+1]??text.length,maxChars=2000;
 const partial=lineEnd-lineStart>maxChars;
 const start=partial?Math.max(lineStart,Math.min(matchStart-200,lineEnd-maxChars)):lineStart;
 const end=partial?Math.min(lineEnd,Math.max(start+maxChars,matchStart+matchLength)):lineEnd;
 return{start,end,quote:text.slice(start,end),quoteTruncated:start!==lineStart||end!==lineEnd,lineStart,lineEnd};
}
// Save the actual retrieved page before the model's context can be compacted.
// A saved result is exportable evidence, not a model-written summary or proof of recall.
export function knowledgeSearchReport(receipt){
 const spans=new Map();
 for(const hit of receipt.matches){
  const key=JSON.stringify([hit.documentId,hit.sourceSha256,hit.start,hit.end]);
  if(!spans.has(key))spans.set(key,{...hit,occurrences:[]});
  spans.get(key).occurrences.push(`${hit.matchStart}..${hit.matchEnd}`);
 }
 const lines=['# 知识条目原句检索',`查询词：${receipt.query}`,`字面命中总数：${receipt.totalMatches}；本页命中数：${receipt.matches.length}；原文片段数：${spans.size}`,`本页起始偏移：${receipt.offset}；下一页偏移：${receipt.nextOffset??'无'}`,
  `未包含的命中：前部 ${Math.min(receipt.offset,receipt.totalMatches)} 处；尾部 ${Math.max(0,receipt.totalMatches-receipt.offset-receipt.matches.length)} 处。`,
  '仅记录已授权知识条目的字面检索；不证明语义召回率，不证明个人事项办结。字符范围从0计数、末端不含。'];
 for(const hit of spans.values())lines.push('',`文件：${hit.sourceName}`,`文档ID：${hit.documentId}`,`来源SHA256：${hit.sourceSha256}`,`原文位置：第${hit.line}行；字符 ${hit.start}..${hit.end}；命中位置 ${hit.occurrences.join(', ')}`,hit.quoteTruncated?'范围限制：本行仅返回局部，尚未取得整行。':'范围：原始整行。','原句：',hit.quote);
 return lines.join('\n');
}
export class KnowledgeTools{
 constructor(documents,texts,{knowledgeDirectory}={}){this.docs=documents;this.texts=texts;this.directory=path.resolve(knowledgeDirectory||path.join(path.dirname(documents.directory),'knowledge'));fs.mkdirSync(this.directory,{recursive:true});}
 store({asset_id,title}){const s=this.texts.source(asset_id),id=sha('knowledge-v1:'+s.asset.sha256+(this.docs.continuity?JSON.stringify(s.asset.resourceRef):'')),file=path.join(this.directory,id+'.json');const record={resourceRef:s.asset.resourceRef,projectId:this.docs.continuity?.projectId,id,title,sourceName:s.asset.name,sourceSha256:s.asset.sha256,textSha256:sha(s.text),encoding:s.encoding,text:s.text,createdAt:new Date().toISOString(),scope:'host-configured knowledge directory',instructionsExecutable:false};if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.textSha256!==record.textSha256||sha(old.text)!==record.textSha256)throw new ToolError('KNOWLEDGE_CHANGED','Stored source content failed its hash check');return{documentId:id,title:old.title,sourceSha256:old.sourceSha256,totalChars:old.text.length,persisted:true,alreadyStored:true};}const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record,null,2),{flag:'wx'});fs.renameSync(temporary,file);const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(sha(saved.text)!==record.textSha256)throw new ToolError('KNOWLEDGE_SAVE_FAILED','Knowledge readback did not match');return{documentId:id,title,sourceSha256:s.asset.sha256,totalChars:s.text.length,persisted:true,alreadyStored:false,note:'This is an indexed full-text entry, not attachment registration or semantic verification.'};}
 search({query,offset=0,limit=20}){const regexSource=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),hits=[];let scanned=0;for(const name of fs.readdirSync(this.directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort()){if(++scanned>10000)throw new ToolError('KNOWLEDGE_SCAN_LIMIT','Use a smaller host namespace');const entry=JSON.parse(fs.readFileSync(path.join(this.directory,name),'utf8'));if(this.docs.continuity){const c=this.docs.continuity;if(entry.projectId!==c.projectId||!entry.resourceRef||![...this.docs.assets.values()].some(a=>a.resourceRef?.resourceId===entry.resourceRef.resourceId))continue;try{c.allowed(entry.resourceRef);}catch{continue;}}if(sha(entry.text)!==entry.textSha256)throw new ToolError('KNOWLEDGE_CHANGED','Knowledge entry hash mismatch',{documentId:entry.id});const regex=new RegExp(regexSource,'giu'),starts=lineIndex(entry.text);let m;while((m=regex.exec(entry.text))){const line=starts.findIndex((start,i)=>start<=m.index&&(starts[i+1]??Infinity)>m.index),span=knowledgeQuote(entry.text,starts,line,m.index,m[0].length);hits.push({documentId:entry.id,title:entry.title,sourceName:entry.sourceName,sourceSha256:entry.sourceSha256,line:line+1,...span,matchStart:m.index,matchEnd:m.index+m[0].length});if(hits.length>100000)throw new ToolError('KNOWLEDGE_HIT_LIMIT','Narrow the literal query');}}
  const nextOffset=offset+limit<hits.length?offset+limit:null;
  const receipt={query,documentsScanned:scanned,totalMatches:hits.length,offset,limit,matches:hits.slice(offset,offset+limit),nextOffset,persistedKnowledge:true,contentVerified:false};
  const resultId='knowledge-search:'+sha(JSON.stringify(receipt)),answer=knowledgeSearchReport(receipt);
  const sourceIds=[...this.docs.assets.values()].filter(a=>receipt.matches.some(h=>h.sourceSha256===a.sha256)).map(a=>a.id);
  this.docs.results.set(resultId,{resultId,method:'knowledge_literal_search',answer,sourceIds,receipt,contentVerified:false});this.docs.save();
  return{...receipt,resultId,note:'Exact retrieved quotes are saved under resultId. Export with export_document result_ids; do not retype them through save_draft. Combine page result IDs after following nextOffset. A compacted receipt is not missing source data. Literal search only, not semantic recall.'};}
 tools(){return[{name:'store_knowledge',description:'Persist an authorized text original as a hash-checked knowledge document. Reads and stores its full text, unlike attachment registration. Host-configured namespace survives restarts and new authorized sessions.',inputSchema:obj({asset_id:str(200),title:str(200)}),execute:a=>this.store(a)},{name:'search_knowledge',description:'Search host-authorized persisted knowledge for one literal query. Returns exact original quotes, source SHA and locations, plus a saved resultId directly usable by export_document result_ids without retyping. Follow nextOffset for remaining hits. Current resource permissions still apply; no semantic recall claim.',inputSchema:obj({query:str(300),offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:100}},['query']),execute:a=>this.search(a)}];}
}
