import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateInvoiceRuntimeConfig,assertTextOnlyAnalysis,assertInvoiceScope,planInvoiceRegions} from '../src/invoices/invoice-runtime.mjs';
import {Store} from '../src/runtime/core.mjs';
import {Workspace} from '../src/workspace/workspace.mjs';
import {Harness} from '../src/runtime/runtime.mjs';
import {resolveArtifact} from '../src/documents/artifacts.mjs';
import {createRequire} from 'node:module';
import {runDeepSeek} from '../src/integrations/deepseek-runtime.mjs';
import {modelFixture,call} from './dsh-fixture.mjs';
import {analyzeTask} from '../src/workspace/workflow-ai.mjs';
import {validateCandidate} from '../src/invoices/invoice-evidence.mjs';
const require=createRequire(import.meta.url),{createCanvas}=require('@napi-rs/canvas');
const cfg={version:'v7-invoice-cloud-local-1',enabled:true,allowedOriginalSha256:['a'.repeat(64)],chat:{baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3.8-27B',images:false,envFile:path.resolve('private.env')},ocr:{model:'OpenDataLab/MinerU2.5-Pro-2605-1.2B',modelPath:path.resolve('weights')},python:path.resolve('python.exe'),libraries:path.resolve('libs')};
test('09配置严格限定平台、模型及文字通道，不能切到其他地址或传图',()=>{
 assert.deepEqual(validateInvoiceRuntimeConfig(cfg),cfg);
 for(const patch of [{chat:{...cfg.chat,baseUrl:'https://example.com'}},{chat:{...cfg.chat,images:true}},{chat:{...cfg.chat,model:'different'}},{ocr:{...cfg.ocr,model:'different'}}])assert.throws(()=>validateInvoiceRuntimeConfig({...cfg,...patch}));
 assert.doesNotThrow(()=>assertTextOnlyAnalysis({kind:'invoice-evidence',documents:[{id:'s',text:'资料'}]}));
 for(const d of [{text:'x',base64:'eA=='},{text:'x',image_url:'file.png'},{text:Buffer.from('x')}])assert.throws(()=>assertTextOnlyAnalysis({kind:'invoice-evidence',documents:[d]}));
 assert.throws(()=>assertTextOnlyAnalysis({kind:'meeting',documents:[]}));
 assert.doesNotThrow(()=>assertInvoiceScope(cfg,['a'.repeat(64)]));assert.throws(()=>assertInvoiceScope(cfg,['b'.repeat(64)]));assert.throws(()=>assertInvoiceScope(cfg,[]));
});
test('09云端适配真实DSH请求发送顶层enable_thinking=false，默认内网协议保持独立',async t=>{
 const x=await modelFixture(t,body=>{assert.equal(body.enable_thinking,false);assert.equal(body.chat_template_kwargs,undefined);return {text:'SYNTHETIC_OK'};});
 const chat=x.directory.get('chat');const r=await runDeepSeek({connection:{baseUrl:chat.baseUrl+'/v1',modelName:chat.model,apiKey:'local-keyless',invoiceTextOnly:true,label:'synthetic'},systemPrompt:'Return SYNTHETIC_OK',request:'synthetic',maxTokens:80});assert.equal(r.answer,'SYNTHETIC_OK');
});
test('09兼容对象提交与字符串提交；来源伪造仍由业务校验拒绝',async t=>{
 for(const encoded of [false,true]){
 const result={candidates:[{field:'total',value:'30.00',sourceId:'forged',quote:'invented'}],unresolved:[]};
 const x=await modelFixture(t,body=>!body.messages.some(m=>m.role==='tool')?{calls:[call('read_task_inputs',{})]}:!body.messages.some(m=>m.role==='assistant'&&m.tool_calls?.some(c=>c.function.name==='submit_result'))?{calls:[call('submit_result',{json:encoded?JSON.stringify(result):result})]}:{text:'done'});
 const chat=x.directory.get('chat'),r=await analyzeTask({invoiceStructuredSubmission:true,modelConnection:()=>({baseUrl:chat.baseUrl+'/v1',modelName:chat.model,invoiceTextOnly:true})},{kind:'invoice-evidence',instruction:'synthetic',documents:[{id:'s',text:'synthetic'}],shape:'{}',signal:AbortSignal.timeout(5000)});
 assert.deepEqual(r,result);assert.equal(validateCandidate(r.candidates[0],[]).accepted,false);
 }
});
test('通用任务继续拒绝把对象当JSON字符串提交，09适配不会扩散到其他场景',async t=>{
 const x=await modelFixture(t,body=>!body.messages.some(m=>m.role==='tool')?{calls:[call('read_task_inputs',{})]}:{calls:[call('submit_result',{json:{candidates:[]}})]});
 const chat=x.directory.get('chat');await assert.rejects(()=>analyzeTask({invoiceStructuredSubmission:true,modelConnection:()=>({baseUrl:chat.baseUrl+'/v1',modelName:chat.model})},{kind:'meeting',instruction:'synthetic',documents:[],shape:'{}',signal:AbortSignal.timeout(5000)}));
});
test('已提交候选在收尾HTTP失败后保留，真实取消仍不返回候选',async t=>{
 for(const cancelled of [false,true]){
 const controller=new AbortController(),result={candidates:[{field:'total',value:'30.00',sourceId:'s',quote:'synthetic'}]};
 const x=await modelFixture(t,(body,n)=>{if(n===1)return {calls:[call('read_task_inputs',{})]};if(n===2)return {calls:[call('submit_result',{json:result})]};if(cancelled)controller.abort();return {status:503};});
 const chat=x.directory.get('chat'),run=()=>analyzeTask({invoiceStructuredSubmission:true,modelConnection:()=>({baseUrl:chat.baseUrl+'/v1',modelName:chat.model})},{kind:'invoice-evidence',instruction:'synthetic',documents:[{id:'s',text:'synthetic'}],shape:'{}',signal:controller.signal});
 if(cancelled)await assert.rejects(run);else{const r=await run();assert.deepEqual(r.candidates,result.candidates);assert.equal(r.transportWarnings[0].code,'FINAL_ACK_FAILED');}
 }
});
test('局部取证仅按失败字段定位启发区域，最多两次，不猜多页位置',()=>{
 assert.equal(planInvoiceRegions(['seller'],1).length,0);assert.equal(planInvoiceRegions(['total'],2).length,0);
 const plan=planInvoiceRegions(['invoiceNumber','date','total','currency'],1);assert.equal(plan.length,2);assert.deepEqual(plan.flatMap(r=>r.fields).sort(),['currency','date','invoiceNumber','total']);for(const r of plan){assert(r.bbox.every(n=>n>=0&&n<=1));assert(r.selection.includes('not a verified field location'));}
});
test('真实09入口使用局部新证据恢复字段，保留旧来源，同OCR不伪造交叉核对',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v7-09-region-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),h=new Harness(store),facade=Object.create(h);facade.invoiceNetworkPolicy=()=>{};facade.invoiceVisionAvailable=false;let calls=0;
 const w=new Workspace(store,h,{invoiceRuntimeFactory:()=>({harness:facade,descriptor:{},analyze:async()=>({candidates:[]}),recognize:async()=>({content:'税务发票\n购买方：甲公司\n销售方：乙公司\n币种：CNY',model:'fixture-local'}),recover:async(file,fields,coverage)=>{calls++;const regions=planInvoiceRegions(fields,coverage.totalPages);return {attempted:true,regions,regionalSources:[{text:'发票号码：REGION-09\n开票日期：2026-01-05',page:1,model:'fixture-local',recognitionRunId:'crop-run'},{text:'价税合计：30.00元',page:1,model:'fixture-local',recognitionRunId:'crop-run'}]};}})});
 const f=await w.upload({name:'synthetic.png',base64:createCanvas(40,40).toBuffer('image/png').toString('base64')}),job=w.start({scenarioId:'09',fileIds:[f.id]});while(w.active.has(job.id))await new Promise(r=>setTimeout(r,10));assert.equal(job.error,null);assert.equal(calls,1);
 const a=job.artifacts.find(a=>a.name==='票据证据与字段账本.json'),d=JSON.parse(resolveArtifact(store,job.id,a.id).bytes).documents[0];assert.equal(d.recovery.localRerecognitionAttempts,2);assert.equal(d.recovery.budget.localRerecognition,6);assert.equal(d.recovery.before.invoiceNumber,'missing');assert.equal(d.fields.invoiceNumber.value,'REGION-09');assert.equal(d.fields.total.value,3000);assert.equal(d.fields.date.value,'2026-01-05');assert.equal(d.fields.invoiceNumber.status,'supported');assert(d.sources.length>=3);assert(d.sources.every(s=>s.reader==='ocr'));assert.equal(job.totals.valid,0);assert(d.issues.some(i=>i.code==='SINGLE_READER'));
});
test('09专用运行器只对09启用，独立视觉缺失诚实记账并阻止假完成',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v7-09-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),harness=new Harness(store),seen=[];
 const workerHarness=Object.create(harness);workerHarness.invoiceNetworkPolicy=()=>{};workerHarness.invoiceVisionAvailable=false;
 const workspace=new Workspace(store,harness,{invoiceRuntimeFactory:()=>{seen.push('factory');return {harness:workerHarness,descriptor:{model:'fixture-text',imagesSentToCloud:false,vision:'not_configured'},analyze:async()=>({candidates:[],unresolved:[]}),recognize:async()=>({content:'税务发票\n发票号码：TEST-09\n开票日期：2026-01-05\n购买方：甲公司\n销售方：乙公司\n价税合计：30.00元\n币种：CNY',model:'fixture-local'}),look:()=>{throw Error('must not invoke unavailable vision');}};}});
 const canvas=createCanvas(30,30),f=await workspace.upload({name:'synthetic.png',base64:canvas.toBuffer('image/png').toString('base64')});
 const job=workspace.start({scenarioId:'09',fileIds:[f.id]});while(workspace.active.has(job.id))await new Promise(r=>setTimeout(r,10));
 assert.equal(job.error,null);assert.equal(seen.length,1);assert.equal(job.invoiceRuntime.imagesSentToCloud,false);assert.equal(job.totals.valid,0);assert.equal(job.totals.exceptions,1);
 const a=job.artifacts.find(a=>a.name==='票据证据与字段账本.json'),ledger=JSON.parse(resolveArtifact(store,job.id,a.id).bytes),d=ledger.documents[0];
 assert.equal(d.rawOutputs.find(r=>r.reader==='vision').status,'unavailable');assert(d.failures.some(f=>f.code==='VISION_NOT_CONFIGURED'));assert(d.issues.some(i=>i.code==='SINGLE_READER'));assert.equal(d.rawOutputs.find(r=>r.reader==='ocr').cached,false);
 // Non-09 execute exits before calling the factory even when its processor fails.
 const before=seen.length;const other={id:'non09',scenarioId:'07',status:'queued',trace:[],options:{},warnings:[],checks:[],artifacts:[],rules:'',dataScope:[]};store.state.jobs.push(other);const c=new AbortController();workspace.active.set(other.id,c);await workspace.execute(other,[],c);assert.equal(seen.length,before);
});
