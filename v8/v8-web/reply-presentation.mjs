import fs from 'node:fs';
import path from 'node:path';
import {digest} from '../v8-tools/resource-space.mjs';

const integer = x => Number.isSafeInteger(x) && x >= 0;
const decimal = /^-?\d+(?:\.\d+)?$/;
export function formatExactDecimal(value) {
 if (!decimal.test(String(value))) return null;
 const [whole, fraction] = String(value).split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
export function validStatistics(receipt) {
 if (!receipt || receipt.algorithm !== 'typed-full-table-decimal-v1') return false;
 const {receiptId,...body} = receipt;
 if (receiptId !== 'STAT-'+digest(body) || !/^[a-f0-9]{64}$/.test(receipt.tableVersionSha256 || '')) return false;
 if (![receipt.dataRows,receipt.columnCount,receipt.removedRows,receipt.conflicts].every(integer) || !Array.isArray(receipt.columns) || receipt.columns.length !== receipt.columnCount) return false;
 return receipt.columns.every(c => typeof c.name==='string' && integer(c.nonEmpty) && integer(c.numericCount) && c.numericCount<=c.nonEmpty && c.nonEmpty<=receipt.dataRows && (c.sumExact===null || decimal.test(c.sumExact)));
}
// These are display semantics, never business routing or arithmetic. Unclear
// numeric columns stay in the complete receipt; identifiers are never summed in prose.
const identifier = /序号|编号|编码|标识|邮编|电话|(^|[\s_-])(?:id|index|code|serial|phone|zip)(?:$|[\s_-])/i;
const nonAdditive = /单价|均价|平均|比例|百分|利率|税率|折扣|unit.?price|average|percent|rate/i;
const additive = /金额|总价|费用|成本|收入|支出|余额|预算|工资|税额|价款|数量|件数|人数|次数|工时|amount|cost|revenue|balance|salary|quantity|count/i;
const cleanLabel = name => name.replace(/[_（(]元[）)]?$/,'');

export function statisticsPresentation(receipt, turn, artifact) {
 const incomplete = !!turn.termination || ['failed','partial','cancelled','interrupted','blocked','needs_input'].includes(turn.status);
 const notes = [], facts = [];
 const f=artifact?.deliveryFacts;
 if (f && f.dataRows===receipt.dataRows && f.removedRows===receipt.removedRows && Array.isArray(f.inputTableRows) && f.inputTableRows.length && f.inputTableRows.every(integer) && f.inputTableRows.reduce((a,b)=>a+b,0)===receipt.dataRows+receipt.removedRows) facts.push({label:'输入记录',value:f.inputTableRows.join(' + ')+' = '+f.inputTableRows.reduce((a,b)=>a+b,0)+' 条'});
 facts.push({label:'数据记录',value:receipt.dataRows+' 条'}, {label:'表格字段',value:receipt.columnCount+' 列'});
 if(receipt.removedRows) facts.push({label:'去重删除',value:receipt.removedRows+' 条'});
 for(const c of receipt.columns) {
  if(!identifier.test(c.name) && !nonAdditive.test(c.name) && additive.test(c.name) && c.sumExact!==null && c.numericCount>0) {
   const isYuan=/[_（(]元[）)]?$/.test(c.name);
   facts.push({label:cleanLabel(c.name)+'合计',value:formatExactDecimal(c.sumExact)+(isYuan?' 元':''),emphasis:true});
   if(c.numericCount<c.nonEmpty) notes.push('“'+c.name+'”仅合计了'+c.numericCount+'项数值；另有'+(c.nonEmpty-c.numericCount)+'项非空内容未纳入数值合计。');
  }
 }
 const missing=receipt.columns.filter(c=>c.nonEmpty<receipt.dataRows);
 for(const c of missing.slice(0,4)) notes.push('“'+c.name+'”有'+c.nonEmpty+'条记录有值，另'+(receipt.dataRows-c.nonEmpty)+'条为空。');
 if(missing.length>4) notes.push('另有'+(missing.length-4)+'个字段存在空值，完整明细见技术回执。');
 if(receipt.conflicts) notes.unshift('发现'+receipt.conflicts+'处冲突，需进一步核对，不能据此认定全部内容一致。');
 notes.push(...(turn.unmetRequirements||[]));
 const lead=incomplete?'本轮仍有未完成项，以下为已取得的表格统计。':turn.assistantRoute?.phase==='verify'?'已整理本轮核对结果，以下为实际表格统计。':turn.artifacts?.length?'已生成'+turn.artifacts.length+'份文件，关键结果如下。':'本轮表格统计如下。';
 const caveat='统计对应本次读取的表格版本；文件回读一致不代表原始业务事实已经审定。';
 return {version:1,kind:'statistics',lead,facts,notes,caveat,text:[lead,...facts.map(f=>f.label+'：'+f.value),...(notes.length?['待核事项：',...notes.map(n=>'• '+n)]:[]),caveat].join('\n')};
}

// Terminal receipts are read once per actual file revision, not once per poll.
// A historical conversation gets the same presentation without rewriting its evidence.
export class ReplyPresentations {
 constructor(root) {this.root=path.resolve(root);this.cache=new Map();}
 read(directory,name) {
  if(!directory || !path.resolve(directory).startsWith(this.root+path.sep)) return null;
  const file=path.join(directory,name);
  try {
   const s=fs.statSync(file);if(!s.isFile() || s.size>2*1024*1024)return null;
   const stamp=s.size+':'+s.mtimeMs+':'+s.ctimeMs,hit=this.cache.get(file);
   if(hit?.stamp===stamp)return hit.value;
   const value=JSON.parse(fs.readFileSync(file,'utf8'));
   if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value);
   this.cache.set(file,{stamp,value});return value;
  }catch{return null;}
 }
 view(conversation,turn) {
  if(['running','queued'].includes(turn.status))return null;
  const settlement=this.read(turn.directory,'delivery-settlement.json');
  const statisticsOrigin=(turn.answerOrigin||settlement?.answerOrigin)==='statistics_receipt';
  if(!statisticsOrigin && !turn.artifacts?.length && !settlement?.handoffReviewReceipt)return null;
  const technical={answerOrigin:turn.answerOrigin||settlement?.answerOrigin||'model',...(turn.artifacts?.length?{files:turn.artifacts.map(a=>({id:a.artifactId,sha256:a.sha256,readbackPassed:a.readbackPassed}))}:{}),...(turn.metrics?{calls:turn.metrics}:{}),...(settlement?.handoffReviewReceipt?{review:settlement.handoffReviewReceipt}:{})};
  if(!statisticsOrigin)return {version:1,kind:'plain',text:turn.answer||'',technical};
  technical.originalReceipt=turn.answer||settlement?.answer||'';
  if(settlement?.originalModelAnswer)technical.originalModelAnswerUnverified=settlement.originalModelAnswer;
  const ids=settlement?.statisticsReceiptIds||[];
  let receipt=Array.isArray(settlement?.statisticsReceipts)?settlement.statisticsReceipts.find(r=>ids.includes(r.receiptId)&&validStatistics(r)):null;
  if(!receipt)for(const id of ids){if(!/^STAT-[a-f0-9]{64}$/.test(id))continue;const candidate=this.read(turn.directory,path.join('statistics',id+'.json'));if(validStatistics(candidate)&&candidate.receiptId===id){receipt=candidate;break;}}
  const records=[...(conversation.turns||[]).flatMap(t=>t.artifacts||[]),...(settlement?.verifiedArtifacts||[]),...(settlement?.otherVerifiedArtifacts||[])];
  const artifact=receipt?.source?.artifactId&&records.find(a=>a.artifactId===receipt.source.artifactId&&a.sha256);
  if(artifact && artifact.sha256!==receipt.source.artifactSha256)receipt=null;
  if(!receipt)return {version:1,kind:'plain',text:'本轮保留了统计记录，但目前无法取得与原版本一致的结构化回执，暂不展示未经核对的数字。请展开技术回执查看；已有文件仍可从下方取回。',technical};
  technical.statistics=receipt;
  return {...statisticsPresentation(receipt,turn,artifact),technical};
 }
}
