import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {Store} from '../core.mjs';
import {Harness} from '../runtime.mjs';
import {Workspace} from '../workspace.mjs';
import {sampleFiles} from '../samples.mjs';
import {readOriginal} from '../workspace-files.mjs';
import {resolveArtifact} from '../artifacts.mjs';
import {fileURLToPath} from 'node:url';
import {moneyCents,paragraphChanges,verifiedInvoiceAmount,chineseMoneyCents} from '../workflow-processors.mjs';
import {splitWav} from '../wav.mjs';
import {withCoverageFixture} from './source-coverage-fixture.mjs';
function temporary(t){const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,'agent-v2-workflow-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),root);assert(path.basename(dir).startsWith('agent-v2-workflow-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
export async function fixtureAnalyze(args){
  const {kind,documents}=args;
  if(args.coverage)return withCoverageFixture(args);
  if(kind==='organize')return {files:documents.map(d=>({sourceId:d.id,project:d.text.includes('星河项目')?'星河项目':'',month:d.text.match(/2026-\d{2}/)?.[0]||'',quote:d.text.split('\n').slice(0,2).join('\n')}))};
  if(kind==='compare')return {summary:'金额、日期和责任存在变化，具体以完整差异表为准。'};
  if(kind==='meeting'){const d=documents[0];return {title:'演示准备会',decisions:[{text:'先完成本地版本',sourceId:d.id,quote:'确认先完成本地版本，云端以后再讨论。'}],actions:[{title:'提交演示稿',owner:'陈晨',dueText:'2026年10月20日18:00',sourceId:d.id,quote:'陈晨：我负责在2026年10月20日18:00前提交演示稿。'}],unresolved:['下一次评审时间待确认']};}
  if(['invoice-evidence','invoice-field-recovery'].includes(kind))return {candidates:[]};
  if(kind==='invoice')return {invoices:documents.map(d=>{const lines=d.text.split('\n');return {sourceId:d.id,invoiceNumber:lines.find(l=>l.startsWith('发票号码：'))?.split('：')[1]||'',numberQuote:lines.find(l=>l.startsWith('发票号码：'))||'',dateText:lines.find(l=>l.startsWith('开票日期：'))?.split('：')[1]||'',dateQuote:lines.find(l=>l.startsWith('开票日期：'))||'',vendor:lines.find(l=>l.startsWith('销售方：'))?.split('：')[1]||'',vendorQuote:lines.find(l=>l.startsWith('销售方：'))||'',amountText:lines.find(l=>l.includes('价税合计'))?.split('￥')[1]||'',amountQuote:lines.find(l=>l.includes('价税合计'))||''};})};
  if(kind==='ledger')return {records:documents.map(d=>({sourceId:d.id,values:{'项目名称':'星河项目','审查阶段':'终审','审查意见':'资料齐全，同意按既定程序推进。','审查日期':'2026年10月15日'},citations:{'项目名称':'项目名称：星河项目','审查阶段':'审查阶段：终审','审查意见':'审查意见：资料齐全，同意按既定程序推进。','审查日期':'审查日期：2026年10月15日'}}))};
  throw new Error('未知测试分析类型');
}
async function prepare(t,scenarioId,analyze=fixtureAnalyze){const store=new Store(temporary(t)),h=new Harness(store,{deepseekKey:'fixture-deepseek-memory-only'}),workspace=new Workspace(store,h,{analyze});const files=[];for(const input of await sampleFiles(scenarioId)){const supplied=scenarioId==='09'?{...input,base64:Buffer.from(Buffer.from(input.base64,'base64').toString('utf8')+'\n购买方：虚构测试公司').toString('base64')}:input;files.push(await workspace.upload(supplied));}return {store,workspace,files};}
async function execute(workspace,input){const job=workspace.start(input);const until=Date.now()+10000;while(workspace.active.has(job.id)){if(Date.now()>until)throw new Error('执行测试超时');await new Promise(r=>setTimeout(r,10));}return job;}
test('逐段差异包含增删改，金额按分精确计算，拒绝猜测数值',()=>{
  assert.equal(moneyCents('￥1,234.50元'),123450);assert.equal(moneyCents('0.10')+moneyCents('0.20'),30);assert.throws(()=>moneyCents('约100元'));assert.throws(()=>moneyCents('1.001'));
  assert.equal(verifiedInvoiceAmount({amountText:'128.50',amountQuote:'价税合计（小写）：￥128.50'}),12850);assert.throws(()=>verifiedInvoiceAmount({amountText:'128',amountQuote:'价税合计（小写）：￥128.50'}));assert.throws(()=>verifiedInvoiceAmount({amountText:'1.00',amountQuote:'税额：1.00；价税合计：9.00'}));
  const changes=paragraphChanges('甲\n旧金额100\n删掉','甲\n新金额200\n新增');assert.equal(changes.length,2);assert.equal(changes[0].oldLine,2);assert.equal(changes[0].newLine,2);
  const insert=paragraphChanges('甲','甲\n新增');assert.equal(insert[0].type,'新增');assert.equal(paragraphChanges('甲\n删除','甲')[0].type,'删除');
});
test('文件整理生成真实ZIP，全量文件哈希对应，完全重复单独保存',async t=>{
  const {store,workspace,files}=await prepare(t,'07');const job=await execute(workspace,{scenarioId:'07',fileIds:files.map(f=>f.id)});assert.equal(job.status,'partial',job.error);assert.equal(job.mapping.length,4);assert.equal(job.mapping.filter(m=>m.duplicateOf).length,1);
  const zip=await JSZip.loadAsync(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name.endsWith('.zip')).id).bytes);for(const m of job.mapping)assert(zip.file(m.target));for(const file of files)assert(readOriginal(store,file));
  assert(job.checks.every(c=>c.passed));const restarted=new Workspace(new Store(store.directory),new Harness(store),{analyze:fixtureAnalyze});assert.equal(restarted.state().jobs[0].id,job.id);
});
test('版本比较回读Excel保留全部差异与两个原件',async t=>{
  const {store,workspace,files}=await prepare(t,'08');const job=await execute(workspace,{scenarioId:'08',fileIds:files.map(f=>f.id)});assert.equal(job.status,'partial',job.error);assert(job.warnings.some(w=>w.includes('未形成')));assert.equal(job.diffCount,4);const book=new ExcelJS.Workbook();await book.xlsx.load(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name.endsWith('.xlsx')).id).bytes);assert.equal(book.getWorksheet('完整差异').rowCount,5);for(const file of files)assert(readOriginal(store,file));
});
test('09严格核对保留小错误票据全部字段，算术/日期问题待核且不混入合计',async t=>{
  assert.equal(chineseMoneyCents('壹佰贰拾捌元伍角整'),12850);assert.equal(chineseMoneyCents('贰佰壹拾元整'),21000);assert.equal(chineseMoneyCents('肆拾捌元柒角陆分'),4876);assert.equal(chineseMoneyCents('玖拾叁元贰角捌分'),9328);assert.equal(chineseMoneyCents('壹佰零陆元整'),10600);
  const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'../samples/invoices-small-errors');
  const names=fs.readdirSync(dir).filter(name=>name.startsWith('发票')&&name.endsWith('.txt')).sort();
  const store=new Store(temporary(t)),workspace=new Workspace(store,new Harness(store),{analyze:fixtureAnalyze}),files=[];
  for(const name of names)files.push(await workspace.upload({name,base64:fs.readFileSync(path.join(dir,name)).toString('base64')}));
  const job=await execute(workspace,{scenarioId:'09',fileIds:files.map(f=>f.id)});assert.equal(job.error,null);assert.equal(job.status,'partial');assert.equal(job.totals.valid,1);assert.equal(job.totals.exceptions,4);assert.equal(job.totals.totalCents,9328);
  const ledger=JSON.parse(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='票据证据与字段账本.json').id).bytes);assert.equal(ledger.documents.length,5);
  assert.match(ledger.documents.find(d=>d.fileName.includes('税额')).arithmeticIssues.join(''),/相差 ¥0\.01/);assert.match(ledger.documents.find(d=>d.fileName.includes('大写')).arithmeticIssues.join(''),/¥210\.00/);assert.match(ledger.documents.find(d=>d.fileName.includes('数量')).arithmeticIssues.join(''),/¥45\.00/);
  assert.equal(ledger.documents.find(d=>d.fileName.includes('日期')).fields.date.status,'missing');assert(ledger.documents.find(d=>d.fileName.includes('日期')).candidates.some(c=>c.raw.field==='date'&&c.result.reason==='invalid_value'));
  const book=new ExcelJS.Workbook();await book.xlsx.load(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='报销明细.xlsx').id).bytes);assert.equal(book.getWorksheet('报销明细').rowCount,2);assert.equal(book.getWorksheet('待复核材料').rowCount,5);assert.equal(book.getWorksheet('材料总览').rowCount,6);
  assert(book.getWorksheet('字段与证据').getRow(2).getCell(3).fill.fgColor.argb==='FFFDE68A');assert(book.getWorksheet('证据索引').rowCount>5);
});
test('报销重复与缺失不计入合计，附件顺序能回读核对',async t=>{
  const {store,workspace,files}=await prepare(t,'09');const job=await execute(workspace,{scenarioId:'09',fileIds:files.map(f=>f.id)});assert.equal(job.status,'partial',job.error);assert.equal(job.totals.valid,2);assert.equal(job.totals.exceptions,2);assert.equal(job.totals.totalCents,19975);const zip=await JSZip.loadAsync(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name.endsWith('.zip')).id).bytes);const ledger=JSON.parse(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='票据证据与字段账本.json').id).bytes);assert.equal(ledger.documents.length,4);for(const d of ledger.documents)assert(zip.file(d.attachment));assert.equal(Object.keys(zip.files).filter(n=>n.startsWith('原始材料/')&&!zip.files[n].dir).length,4);
});
test('按用户XLSX模板表头追加报销明细，模板历史与附件映射保持一致',async t=>{
  const {store,workspace,files}=await prepare(t,'09'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('我的模板');sheet.addRow(['日期','发票号码','金额（元）','对应附件','来源文件']);sheet.addRow(['2026年9月1日','HISTORY',9,'历史附件.pdf','历史来源']);sheet.getCell('C2').numFmt='0.00';
  const template=await workspace.upload({name:'我的报销模板.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});const job=await execute(workspace,{scenarioId:'09',fileIds:[...files.map(f=>f.id),template.id],options:{templateId:template.id}});assert.equal(job.status,'partial',job.error);assert.equal(job.totals.totalCents,19975);
  const output=new ExcelJS.Workbook();await output.xlsx.load(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='填写后的报销模板.xlsx').id).bytes);assert.equal(output.getWorksheet('我的模板').getCell('B2').value,'HISTORY');assert.equal(output.getWorksheet('我的模板').getCell('C3').value,128.5);assert.match(output.getWorksheet('我的模板').getCell('D3').value,/^原始材料\/001_.*票据A\.txt$/);assert(job.checks.some(c=>c.label.includes('模板')));
});
test('台账只追加终审，新行蓝色，历史公式样式不变且重试去重',async t=>{
  const {store,workspace,files}=await prepare(t,'10');const job=await execute(workspace,{scenarioId:'10',fileIds:files.map(f=>f.id),options:{templateId:files[0].id,dedupeColumns:'项目名称'}});assert.equal(job.status,'completed',job.error);assert.equal(job.appended,1);const book=new ExcelJS.Workbook();await book.xlsx.load(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='台账_追加后.xlsx').id).bytes);const sheet=book.getWorksheet('审查台账');assert.equal(sheet.getCell('A2').value,'历史项目');assert.equal(sheet.getCell('A3').value,'星河项目');assert.equal(sheet.getCell('A3').font.color.argb,'FF2563EB');assert(!JSON.stringify(sheet.getRow(3).values).includes('初审'));
  const next=await workspace.upload({name:'上次追加结果.xlsx',base64:resolveArtifact(store,job.id,job.artifacts.find(a=>a.name==='台账_追加后.xlsx').id).bytes.toString('base64')});const retried=await execute(workspace,{scenarioId:'10',fileIds:[next.id,files[1].id],options:{templateId:next.id,dedupeColumns:'项目名称'}});assert.equal(retried.appended,0);assert.equal(retried.status,'partial');
});
test('会议纪要与待办分开，确认前不创建，确认幂等且不编造提醒',async t=>{
  const {store,workspace,files}=await prepare(t,'04');const job=await execute(workspace,{scenarioId:'04',fileIds:files.map(f=>f.id),options:{selfName:'陈晨'}});assert.equal(job.status,'awaiting_approval',job.error);assert.equal(store.state.tasks.length,0);const docx=await JSZip.loadAsync(resolveArtifact(store,job.id,job.artifacts.find(a=>a.name.endsWith('.docx')).id).bytes);assert.match(await docx.file('word/document.xml').async('string'),/先完成本地版本/);
  workspace.approveActions({jobId:job.id,actions:[{id:job.actions[0].id}]});assert.equal(store.state.tasks.length,1);assert.equal(store.state.tasks[0].dueAt,null);workspace.approveActions({jobId:job.id,actions:[{id:job.actions[0].id}]});assert.equal(store.state.tasks.length,1);assert.equal(job.status,'completed');
});
test('模型捏造字段不进入台账或票据合计，未知场景拒绝执行',async t=>{
  const {workspace,files}=await prepare(t,'09',async()=>({candidates:[{sourceId:'not-authorized',field:'total',value:'999999'}]}));const job=await execute(workspace,{scenarioId:'09',fileIds:files.map(f=>f.id)});assert.equal(job.status,'partial');assert.equal(job.totals.totalCents,19975);assert.equal(job.totals.valid,2);assert.throws(()=>workspace.start({scenarioId:'99',fileIds:[files[0].id]}));
});
test('取消与重启不伪造完成；输出下载不能越界',async t=>{
  const {store,workspace,files}=await prepare(t,'07',async()=>{await new Promise(r=>setTimeout(r,80));return {files:[]};});const job=workspace.start({scenarioId:'07',fileIds:files.map(f=>f.id)});workspace.cancel(job.id);while(workspace.active.has(job.id))await new Promise(r=>setTimeout(r,10));assert.equal(job.status,'cancelled');assert.throws(()=>resolveArtifact(store,job.id,'../../state.json'));store.state.jobs[0].status='running';store.save();new Workspace(new Store(store.directory),new Harness(store));assert.equal(new Store(store.directory).state.jobs[0].status,'interrupted');
});
function wav(seconds){const n=16000*seconds*2,bytes=Buffer.alloc(44+n);bytes.write('RIFF',0);bytes.writeUInt32LE(36+n,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(n,40);return bytes;}
test('WAV按25秒分段并保留全局时间范围',async t=>{
  const chunks=splitWav(wav(60));assert.equal(chunks.length,3);assert.deepEqual(chunks.map(c=>[c.start,c.end]),[[0,25],[25,50],[50,60]]);
});
