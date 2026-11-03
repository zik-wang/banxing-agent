import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ReplyPresentations,validStatistics,formatExactDecimal,statisticsPresentation} from '../v8-web/reply-presentation.mjs';
import {tableStatistics} from '../v8-tools/table-statistics.mjs';
const root=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'reply-present-'));t.after(()=>{assert(p.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(p,{recursive:true,force:true,maxRetries:5,retryDelay:20});});return p;};
function setup(t,{inline=false}={}){
 const base=root(t),dir=path.join(base,'runs','turn');fs.mkdirSync(path.join(dir,'statistics'),{recursive:true});
 const receipt=tableStatistics({id:'synthetic',headers:['序号','金额_元','说明'],rows:[[1,.1,'a'],[2,.2,null],[3,3,null]],removed:[{}],conflicts:[]},{artifactId:'output',artifactSha256:'b'.repeat(64)});
 const settlement={answerOrigin:'statistics_receipt',statisticsReceiptIds:[receipt.receiptId],originalModelAnswer:'模型原答错误示例：金额999元',...(inline?{statisticsReceipts:[receipt]}:{})};
 const statFile=path.join(dir,'statistics',receipt.receiptId+'.json');if(!inline)fs.writeFileSync(statFile,JSON.stringify(receipt));fs.writeFileSync(path.join(dir,'delivery-settlement.json'),JSON.stringify(settlement));
 const turn={id:'turn',directory:dir,status:'completed',answerOrigin:'statistics_receipt',answer:'统计回执 '+receipt.receiptId+'\nSHA256: '+receipt.source.artifactSha256,artifacts:[{artifactId:'output',sha256:'b'.repeat(64),deliveryFacts:{inputTableRows:[2,2],dataRows:3,removedRows:1}}]};
 return {base,dir,receipt,settlement,statFile,turn,conversation:{turns:[turn]},present:new ReplyPresentations(base)};
}
test('existing persisted statistics become readable without rewriting the answer or artifact',t=>{
 const x=setup(t),before=JSON.stringify(x.turn),p=x.present.view(x.conversation,x.turn);
 assert.equal(p.kind,'statistics');assert(p.text.includes('3.3 元'));assert(p.text.includes('2 + 2 = 4 条'));assert(p.text.includes('另2条为空'));assert(!p.text.includes('序号合计'));assert(!p.text.includes('STAT-'));assert(!p.text.includes('999'));assert(p.technical.originalReceipt.includes(x.receipt.receiptId));assert(p.technical.originalModelAnswerUnverified.includes('999'));assert.equal(JSON.stringify(x.turn),before);
});
test('new self-contained receipts survive missing historical statistics folder',t=>{
 const x=setup(t,{inline:true});assert.equal(x.present.view(x.conversation,x.turn).kind,'statistics');
});
test('altered or mismatched receipts never become authoritative human numbers',async t=>{
 const x=setup(t);assert(x.present.view(x.conversation,x.turn).text.includes('3.3'));await new Promise(r=>setTimeout(r,5));const changed={...x.receipt,dataRows:99};fs.writeFileSync(x.statFile,JSON.stringify(changed));let p=x.present.view(x.conversation,x.turn);assert.equal(p.kind,'plain');assert(!p.text.includes('99'));assert(p.technical.originalReceipt.includes(x.receipt.receiptId));
 fs.writeFileSync(x.statFile,JSON.stringify(x.receipt));x.turn.artifacts[0].sha256='c'.repeat(64);p=x.present.view(x.conversation,x.turn);assert.equal(p.kind,'plain');assert(!p.text.includes('3.3'));
});
test('incomplete tasks keep failure and unmet work visible rather than imply success',t=>{
 const x=setup(t);x.turn.status='partial';x.turn.termination={reason:'model_error'};x.turn.unmetRequirements=['缺少要求的 DOCX 文件'];const p=x.present.view(x.conversation,x.turn);assert(p.lead.includes('未完成'));assert(p.text.includes('缺少要求的 DOCX'));assert(!p.lead.includes('已生成'));assert(p.caveat.includes('不代表'));
});
test('plain chat, technical answers requested by user, and live tasks retain their contents',t=>{
 const x=setup(t),normal={id:'chat',status:'answered',answer:'你要的 SHA256 是 abc；原文 and 与 & 均保留。',artifacts:[]};assert.equal(x.present.view({turns:[normal]},normal),null);x.turn.status='running';assert.equal(x.present.view(x.conversation,x.turn),null);
});
test('exact decimals are formatted without floating point rounding or invented currency',()=>{
 assert.equal(formatExactDecimal('12345678901234567890.0000001'),'12,345,678,901,234,567,890.0000001');assert.equal(formatExactDecimal('-0.2000001'),'-0.2000001');assert.equal(formatExactDecimal('not a sum'),null);
 const r=tableStatistics({id:'v',headers:['编号','单价','数量','税额'],rows:[[1,5,2,-.1],[2,9,3,.3],['3','10','7','99']]});assert(validStatistics(r));const p=statisticsPresentation(r,{status:'answered',artifacts:[]});assert(!p.text.includes('编号合计'));assert(!p.text.includes('单价合计'));assert(p.text.includes('数量合计：5'));assert(p.text.includes('税额合计：0.2'));assert(!p.text.includes('元'));assert(p.notes.some(n=>n.includes('未纳入')));
});
test('receipt IDs cannot traverse outside the run and missing receipts produce a readable explanation',t=>{
 const x=setup(t);fs.writeFileSync(path.join(x.dir,'delivery-settlement.json'),JSON.stringify({...x.settlement,statisticsReceiptIds:['../../secret']}));const p=x.present.view(x.conversation,x.turn);assert.equal(p.kind,'plain');assert(p.text.includes('暂不展示'));const outside={...x.turn,directory:path.dirname(x.base)};assert.equal(x.present.view(x.conversation,outside).kind,'plain');
});
