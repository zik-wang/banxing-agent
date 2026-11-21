import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {Store} from '../core.mjs';
import {Harness} from '../runtime.mjs';
import {Workspace} from '../workspace.mjs';
import {ConversationActions} from '../conversation-actions.mjs';
import {resolveArtifact} from '../artifacts.mjs';
import {prepareDelivery,generateDeliverables,requestedFormats,validateDelivery} from '../file-delivery.mjs';
import {temporary,modelFixture,waitFor,call} from './dsh-fixture.mjs';
import {extractionReply} from './dsh-analysis-fixture.mjs';

function pdf(text){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const content='BT /F1 12 Tf 50 780 Td ('+text+') Tj ET';objects.push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');let file='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(file));file+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const start=Buffer.byteLength(file);file+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(file);
}
test('文件为真实OOXML，回读保留数值、编号、公式样文字和多工作表',async()=>{
 const spec=prepareDelivery({title:'验收记录',content:'## 本轮结论\n等待用户验收。',sheets:[{name:'金额/明细',headers:['编号','金额','备注'],rows:[['001',128.5,'=SUM(A1:A9)'],['002',71.25,'待核对']]},{name:'金额:明细',headers:['总计'],rows:[[199.75]]}]});
 const {results,failures}=await generateDeliverables({},spec,['docx','xlsx']);assert.deepEqual(failures,[]);assert.equal(results.length,2);
 const word=await JSZip.loadAsync(results[0].bytes),xml=await word.file('word/document.xml').async('string');assert.match(xml,/<w:tbl>/);assert.match(xml,/w:pStyle w:val="Title"/);assert.doesNotMatch(xml,/<w:hyperlink/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(results[1].bytes);assert.equal(book.worksheets[0].getCell('A2').value,'001');assert.equal(book.worksheets[0].getCell('B2').value,128.5);assert.equal(book.worksheets[0].getCell('C2').value,'=SUM(A1:A9)');assert.notEqual(book.worksheets[0].name,book.worksheets[1].name);assert.equal(book.worksheets[0].views[0].ySplit,1);assert(book.worksheets[0].autoFilter);
});
test('空文件、坏表格、公式对象、过长显示与伪PDF不能假装交付',async()=>{
 assert.throws(()=>prepareDelivery({title:'空'}),/需要实际正文/);
 assert.throws(()=>prepareDelivery({title:'坏',sheets:[{headers:['A','B'],rows:[[1]]}]}),/列数不一致/);
 assert.throws(()=>prepareDelivery({title:'坏',sheets:[{headers:['A'],rows:[[{formula:'1+1'}]]}]}),/不接受公式/);
 const huge=prepareDelivery({title:'很长',sheets:[{headers:['内容'],rows:[['长'.repeat(3000)]]}]});const bad=await generateDeliverables({},huge,['xlsx']);assert.equal(bad.results.length,0);assert.match(bad.failures[0].message,/行高/);
 await assert.rejects(validateDelivery('pdf',Buffer.from('PK fake zip'),{title:'Test',blocks:[]}),/真正的PDF/);
 await assert.rejects(validateDelivery('pdf',pdf('Test'),{title:'Test',blocks:[{text:'Missing content'}]}),/内容|文字缺失/);
 assert.deepEqual(requestedFormats('把刚才结果导出为Word、Excel和PDF'),['docx','xlsx','pdf']);assert.deepEqual(requestedFormats('读取附件Excel表格分析金额'),[]);
});
test('Markdown与结构化表格去重但不丢其他表，多行单元格预留完整行高',async()=>{
 const spec=prepareDelivery({title:'新标题',content:'# 旧标题\n\n## 分工\n|事项|负责人|\n|---|---|\n|联调|张三|\n\n## 费用\n|项目|金额|\n|---|---|\n|测试|128.50|',sheets:[{name:'费用',headers:['项目','金额'],rows:[['测试',128.5]]},{name:'多行',headers:['内容'],rows:[['第一行\n第二行\n第三行']]}]});
 assert.equal(spec.blocks.filter(b=>b.type==='table').length,3);assert(!spec.blocks.some(b=>b.text==='旧标题'));assert.equal(spec.sheets.length,3);
 const {results,failures}=await generateDeliverables({},spec,['docx','xlsx']);assert.deepEqual(failures,[]);const book=new ExcelJS.Workbook();await book.xlsx.load(results.find(r=>r.format==='xlsx').bytes);assert.equal(book.getWorksheet('分工').getCell('B2').value,'张三');assert(book.getWorksheet('多行').getRow(2).height>=56);
});
test('DSH聊天真实调用export_file，后续导出和跨对话隔离，PDF失败保留成功格式',async t=>{
 const x=await modelFixture(t,body=>body.messages.some(m=>m.role==='tool')?{text:'完成。'}:{calls:[call('export_file',{formats:['docx','xlsx','pdf'],title:'验收记录',content:'## 结论\n已完成格式校验。',sheets:[{name:'明细',headers:['项目','金额'],rows:[['甲',128.5],['乙',71.25]]}]})]});
 const store=new Store(temporary(t)),h=new Harness(store,{directory:x.directory}),w=new Workspace(store,h);h.chatActions=new ConversationActions(store,w,h);store.state.conversations=[{id:'c',title:'验收'}];
 const run=h.start('生成Word、Excel和PDF供我下载',{conversationId:'c'});await waitFor(()=>!h.active.has(run.id));assert.equal(run.status,'done',run.error);
 const job=store.state.jobs.find(j=>j.chatRunId===run.id);assert.equal(job.status,'partial');assert.deepEqual(job.artifacts.map(a=>a.name.split('.').at(-1)),['docx','xlsx']);assert.match(job.warnings.join(),/PDF未交付/);assert.match(run.answer,/部分格式已交付/);assert(job.artifacts.every(a=>resolveArtifact(store,job.id,a.id).bytes.length>0));
 const next={id:'next',conversationId:'c',request:'把已有结果导出Word',status:'running'};h.active.set(next.id,null);store.state.runs.push(next);
 const receipt=await h.chatActions.exportFile(next,{formats:['docx'],use_last_answer:true});assert.equal(store.state.jobs[0].sourceJobId,job.id);assert.equal(store.state.jobs[0].exportSource.content,job.exportSource.content);assert.equal(receipt.status,'completed');assert.equal(receipt.artifacts.length,1);
 await assert.rejects(h.chatActions.exportFile({id:'other',conversationId:'other',request:'导出Word',status:'running'},{formats:['docx'],source_job_id:job.id}),/已停止/);
 h.active.set('other',null);await assert.rejects(h.chatActions.exportFile({id:'other',conversationId:'other',request:'导出Word',status:'running'},{formats:['docx'],source_job_id:job.id}),/不能跨对话/);h.active.clear();
});
test('真实PDF回读；转换器返回HTML时不写伪PDF文件',async t=>{
 let invalid=false;const server=http.createServer(async(req,res)=>{for await(const _ of req){}res.end(invalid?'<html>Error</html>':pdf('Report Result'));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const harness={directory:{capabilities:[{kind:'convert',ready:true,baseUrl:'http://127.0.0.1:'+server.address().port}]}},spec=prepareDelivery({title:'Report',content:'Result'});
 const first=await generateDeliverables(harness,spec,['pdf']);assert.equal(first.results.length,1);assert.equal(first.results[0].check.pages,1);
 invalid=true;const second=await generateDeliverables(harness,spec,['docx','pdf']);assert.equal(second.results.length,1);assert.equal(second.results[0].format,'docx');assert.match(second.failures[0].message,/真正的PDF/);
});
test('业务工作流的显式格式约束补齐Word和Excel，不仅交付Markdown',async t=>{
 const x=await modelFixture(t,extractionReply),store=new Store(temporary(t)),h=new Harness(store,{directory:x.directory}),w=new Workspace(store,h);store.state.jobs=[];const f=await w.upload({name:'进展.txt',base64:Buffer.from('接口联调已完成。').toString('base64')});
 const job=w.start({scenarioId:'11',fileIds:[f.id],rules:'将这些进展整理为周报，导出Word和Excel供下载',options:{}});await waitFor(()=>!w.active.has(job.id));assert(['partial','completed'].includes(job.status),job.error);assert.deepEqual(job.options.outputFormats,['docx','xlsx']);assert(job.artifacts.some(a=>a.name.endsWith('.docx')));assert(job.artifacts.some(a=>a.name.endsWith('.xlsx')));
});
