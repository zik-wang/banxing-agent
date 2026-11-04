import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executionIntent,externalActionRequested} from '../v8-tools/execution-intent.mjs';
import {reportPreflight} from '../v8-tools/report-preflight.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';
import {ToolHarness} from '../v8-tools/harness.mjs';

const request='根据这份真实公开项目发布记录，生成该项目的阶段工作简报。\n只报告文档中已发布的成果，不冒称是用户个人完成；未给出的本周个人进展留空。\n不要建立每周自动委托。\n请实际读取本次提供的全部材料，并生成可下载的成果文件；不得联网检索、创建PR、付款或建立自动委托；不得执行上传源码。';

test('release evidence and prohibited actions do not request external publication',()=>{
 assert.equal(executionIntent(request).requiresExternalAction,false);
 for(const text of ['不要发邮件，不付款','根据发布快照生成简报','只总结已经发布的成果'])assert.equal(externalActionRequested(text),false,text);
 for(const text of ['把简报发布到网站','生成报告并发送给客户','不要只生成文件，还要发布报告','不要发送，但请发布报告'])assert.equal(externalActionRequested(text),true,text);
});

function setup(t,task=request){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brief-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'release.json');fs.writeFileSync(input,JSON.stringify([{tag_name:'v1.2',published_at:'2026-10-01',body:'修复连接失败。未进行性能验证。'}]));
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[input],python:process.env.V8_PYTHON||'python'});
 docs.executionRepair=true;docs.turnIntent=executionIntent(task);docs.requestedFormats=docs.turnIntent.formats;
 const extras=new DocumentExtras(docs,{}),texts=new TextTools(docs),delivery=new DeliveryTools(docs,extras,texts);
 const harness=new ToolHarness({directory:docs.directory,tools:[...texts.tools(),...delivery.tools()]});
 return{docs,extras,harness,config:{},request:task,next:async(_messages,tools)=>{assert.deepEqual(tools,[]);return{role:'assistant',content:'# 项目阶段简报\n\n发布版本 v1.2：修复连接失败。性能未验证；个人进展未提供。'};}};
}

test('original no-format brief request produces actual saved prose without export planning',async t=>{
 const x=setup(t);const result=await reportPreflight(x);
 assert.equal(result.completed,true);assert.match(result.message,/Markdown已/);assert.ok(result.draftRef);
 assert.deepEqual(x.harness.history.map(h=>h.tool),['read_text_range','save_draft']);
 const artifact=[...x.extras.artifacts.values()][0];assert.ok(artifact);assert.match(fs.readFileSync(artifact.path,'utf8'),/修复连接失败/);
 const receipt=JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json')));assert.equal(receipt.modelCalls,1);
});

test('explicit TXT report renders the requested format, retaining the same body',async t=>{
 const x=setup(t,'根据这份材料生成TXT报告。');const result=await reportPreflight(x);
 assert.equal(result.completed,true);assert.match(result.message,/TXT已/);assert.ok([...x.extras.artifacts.values()][0].path.endsWith('.txt'));
});

test('the historical source-only export fails clearly and recovery writes prose instead of source metadata',async t=>{
 const x=setup(t),source=[...x.docs.assets.values()].find(a=>a.id===a.sourceId);
 const bad=await x.harness.execute('export_document',{title:'项目阶段简报',format:'docx',source_ids:[source.id]});
 assert.equal(bad.error.code,'DOCUMENT_CONTENT_REQUIRED');assert.equal(x.extras.artifacts.size,0);
 const result=await reportPreflight(x);assert.equal(result.completed,true);
 const text=fs.readFileSync([...x.extras.artifacts.values()][0].path,'utf8');
 assert.match(text,/修复连接失败/);assert.doesNotMatch(text,/source_ids|tag_name/);
});

test('explicit Word report writes actual DOCX and passes document readback',{skip:!process.env.V8_PYTHON||!process.env.V8_DOCX_MODULE},async t=>{
 const x=setup(t,'根据这份材料生成Word报告。');x.extras.docxModule=process.env.V8_DOCX_MODULE;
 const result=await reportPreflight(x);assert.equal(result.completed,true);assert.match(result.message,/Word已/);
 const artifact=[...x.extras.artifacts.values()][0];assert.equal(artifact.kind,'docx');assert.ok(artifact.path.endsWith('.docx'));
 const check=await x.extras.inspect({artifact_id:artifact.artifactId},{signal:AbortSignal.timeout(30000)});assert.equal(check.exportIntegrityPassed,true);
});

test('do not re-analyze converts the authorized saved brief without a model request or source reread',{skip:!process.env.V8_PYTHON||!process.env.V8_DOCX_MODULE},async t=>{
 const x=setup(t,'把刚才的简报转成Word，不重新分析。');x.extras.docxModule=process.env.V8_DOCX_MODULE;
 x.config.previousWorkProduct={previousStatus:'completed',previousAnswer:'# 已存简报\n\n原有完整正文，验证范围保留。'};
 x.next=()=>{throw Error('Conversion must not request new prose');};
 const result=await reportPreflight(x);assert.equal(result.completed,true);assert.deepEqual(x.harness.history.map(h=>h.tool),['save_draft']);
 const receipt=JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json')));assert.equal(receipt.modelCalls,0);
 assert.equal([...x.docs.results.values()].find(r=>r.method==='submitted_draft').answer,'原有完整正文，验证范围保留。');
});

test('failed rendering retains the draft but cannot become a completed report',async t=>{
 const x=setup(t,'根据这份材料生成Word报告。');const result=await reportPreflight(x);
 assert.equal(result.failed,true);assert.equal(result.completed,undefined);assert.equal(result.reason,'report_export_failed');
 assert.ok(result.draftRef);assert.equal(x.extras.artifacts.size,0);assert.equal([...x.docs.results.values()].filter(r=>r.method==='submitted_draft').length,1);
});

test('answer-only, meetings, explicit disable and unsupported formats keep their own routes',async t=>{
 for(const change of [x=>{x.docs.turnIntent.noNewFiles=true;},x=>{x.config.meetingPolicy={};},x=>{x.config.documentComposition=false;},x=>{x.docs.turnIntent.formats=['xlsx'];}]){
  const x=setup(t);change(x);assert.equal(await reportPreflight(x),null);assert.equal(x.harness.calls,0);
 }
});
