import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import ExcelJS from 'exceljs';
import {Store} from '../src/runtime/core.mjs';import {Harness} from '../src/runtime/runtime.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {ConversationActions} from '../src/conversations/conversation-actions.mjs';
import {prepareDelivery,renderWorkbook,validateDelivery,sourceJobContent} from '../src/documents/file-delivery.mjs';import {writeArtifact} from '../src/documents/artifacts.mjs';
const headers=n=>Array.from({length:n},(_,i)=>'字段'+(i+1));
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-100-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const store=new Store(dir);store.productExperience=true;store.presentationEnabled=true;Object.assign(store.state,{conversations:[{id:'A'}],jobs:[],runs:[],workspaceFiles:[]});
 let calls=0;const h=new Harness(store,{directory:{services:{chat:{ready:true}},connection:()=>({}),status:()=>({})},runAgent:async()=>{calls++;throw Error('Spreadsheet work must not call a model');}}),w=new Workspace(store,h);h.chatActions=new ConversationActions(store,w,h);
 const upload=async(name,sheets)=>{const book=new ExcelJS.Workbook();for(const s of sheets)book.addWorksheet(s.name).addRows([s.headers,...s.rows]);return w.upload({name,conversationId:'A',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});};
 const send=async(request,options={})=>{const r=h.start(request,{conversationId:'A',...options});for(let n=0;n<1000&&h.active.size;n++)await new Promise(r=>setTimeout(r,10));assert.equal(h.active.size,0);return r;};
 return {store,upload,send,calls:()=>calls,job:r=>store.state.jobs.find(j=>j.chatRunId===r.id)};
}
test('100-column XLSX preserves last-column types and values through readback',async()=>{
 const h=headers(100),rows=[h.map((_,i)=>i),h.map((_,i)=>i===99?false:null)];const spec=prepareDelivery({title:'宽表',sheets:[{name:'明细',headers:h,rows}]}),bytes=await renderWorkbook(spec);
 await validateDelivery('xlsx',bytes,spec);const b=new ExcelJS.Workbook();await b.xlsx.load(bytes);assert.equal(b.worksheets[0].columnCount,100);assert.equal(b.worksheets[0].getCell(2,100).value,99);assert.equal(b.worksheets[0].getCell(3,100).value,false);
});
test('101 columns fail explicitly and the existing total-cell budget still applies',()=>{
 assert.throws(()=>prepareDelivery({sheets:[{headers:headers(101),rows:[]}]}),/100列/);
 const h=headers(100);assert.doesNotThrow(()=>prepareDelivery({sheets:[{headers:h,rows:Array.from({length:299},()=>h.map(()=>null))}]}));
 assert.throws(()=>prepareDelivery({sheets:[{headers:h,rows:Array.from({length:300},()=>h.map(()=>null))}]}),/30000格/);
});
test('100-column input can be converted then edited without hitting an old 30-column gate',async t=>{
 const x=await setup(t),h=headers(100),f=await x.upload('宽表.xlsx',[{name:'明细',headers:h,rows:[h.map((_,i)=>i)]}]);
 const first=await x.send('转Excel',{fileIds:[f.id]});assert.equal(first.status,'done',first.error);
 const next=await x.send('第1行字段100改为999');assert.equal(next.status,'done',next.error);assert.equal(x.job(next).officeSnapshot.sheets[0].rows[0][99],999);assert.equal(x.calls(),0);
});
test('merged 97 business fields plus 3 provenance fields fit exactly 100 columns',async t=>{
 const x=await setup(t),h=headers(97),a=await x.upload('A.xlsx',[{name:'明细',headers:h.slice(0,60),rows:[h.slice(0,60).map((_,i)=>i)]}]),b=await x.upload('B.xlsx',[{name:'明细',headers:h.slice(60),rows:[h.slice(60).map((_,i)=>i+60)]}]);
 const run=await x.send('把这俩报表合并呢',{fileIds:[a.id,b.id]});assert.equal(run.status,'done',run.error);const s=x.job(run).officeSnapshot.sheets[0];assert.equal(s.headers.length,100);assert.equal(s.rows.length,2);assert.equal(s.rows[1][96],96);assert.equal(s.rows[1][97],'B.xlsx');assert.equal(x.calls(),0);
});
test('summary and generated report sheets are retained separately from business rows',async t=>{
 const x=await setup(t),a=await x.upload('A.xlsx',[{name:'报销明细',headers:['编号','金额USD','币种'],rows:[['a',30,'USD']]},{name:'汇总',headers:['项目','数值'],rows:[['合计',30]]},{name:'报告正文',headers:['内容'],rows:[['已有报告文字']]}]),b=await x.upload('B.xlsx',[{name:'发票汇总',headers:['编号','金额CNY','币种'],rows:[['b',50,'CNY']]}]);
 const run=await x.send('把这俩报表合并呢',{fileIds:[a.id,b.id]});assert.equal(run.status,'done',run.error);const sheets=x.job(run).officeSnapshot.sheets,main=sheets[0];assert.equal(main.rows.length,2);assert(!main.headers.includes('数值'));assert(!main.headers.includes('内容'));assert(sheets.some(s=>s.headers[0]==='项目'&&s.rows[0][1]===30));assert(sheets.some(s=>s.headers[0]==='内容'&&s.rows[0][0]==='已有报告文字'));assert.equal(x.calls(),0);
});
test('a standalone key/value source is not dropped merely because its name says summary',async t=>{
 const x=await setup(t),a=await x.upload('A.xlsx',[{name:'汇总',headers:['项目','数值'],rows:[['a',1]]}]),b=await x.upload('B.xlsx',[{name:'汇总',headers:['项目','数值'],rows:[['b',2]]}]);const r=await x.send('合并报表',{fileIds:[a.id,b.id]});assert.equal(r.status,'done',r.error);assert.equal(x.job(r).officeSnapshot.sheets[0].rows.length,2);
});
test('reading an existing 100-column artifact for later delivery uses the same limit',async t=>{
 const x=await setup(t),spec=prepareDelivery({title:'既有宽表',sheets:[{name:'明细',headers:headers(100),rows:[headers(100).map((_,i)=>i)]}]}),job={id:'existing-wide',status:'completed',title:'既有宽表',artifacts:[]};x.store.state.jobs.push(job);writeArtifact(x.store,job,'既有宽表.xlsx',await renderWorkbook(spec),'document');const value=await sourceJobContent(x.store,job);assert.equal(value.sheets[0].headers.length,100);assert.equal(value.sheets[0].rows[0][99],99);
});
