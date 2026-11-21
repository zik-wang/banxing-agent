import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
import {AllIntranetDirectory,validateAllIntranetConfig} from '../src/integrations/all-intranet-directory.mjs';
import {createServiceDirectory} from '../src/integrations/hybrid-deployment.mjs';
import {recognizeInvoiceInputs} from '../src/invoices/invoice-intranet-media.mjs';
import {createInvoiceRuntime,validateInvoiceRuntimeConfig} from '../src/invoices/invoice-runtime.mjs';
import {Store} from '../src/runtime/core.mjs';import {Workspace} from '../src/workspace/workspace.mjs';import {Harness} from '../src/runtime/runtime.mjs';
const require=createRequire(import.meta.url),{createCanvas}=require('@napi-rs/canvas');
const response=value=>new Response(JSON.stringify(value));
const media={ocr:{baseUrl:'http://10.0.0.32:8010',model:'MinerU-intranet'},vision:{baseUrl:'http://10.0.0.94:8080',model:'openbmb/MiniCPM-V-4.6-AWQ'}};
const config={version:'v7-intranet-all-1',chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'qwen3.8-27b-fp8',auth:{type:'none'},analysisMode:'structured-json'},services:{asr:{baseUrl:'http://10.0.0.32:6001'},ocr:media.ocr}};
function temp(t){const base=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'v7-all-intranet-'));t.after(()=>{assert.equal(path.dirname(dir),base);assert(path.basename(dir).startsWith('v7-all-intranet-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
const parsed=(text='合计：30.00')=>({status:'completed',task_id:'fixture-remote-id',results:{source:{md_content:text,content_list:JSON.stringify([{page_idx:0,text,bbox:[1,2,300,40]}])}}});
test('全内网配置无本地权重，拒绝本地媒体、云端与额外URL',()=>{
 assert.deepEqual(validateAllIntranetConfig(config),config);
 for(const patch of [{local:{}},{chat:{...config.chat,baseUrl:'https://api.siliconflow.cn/v1'}},{services:{...config.services,ocr:{baseUrl:'http://127.0.0.1:8010'}}}])assert.throws(()=>validateAllIntranetConfig({...config,...patch}));
});
test('全内网工厂与三项健康检查不创建LocalMediaRuntime，模型身份严格匹配',async t=>{
 const dir=temp(t),file=path.join(dir,'profile.json');fs.writeFileSync(file,JSON.stringify(config));const calls=[];
 const directory=createServiceDirectory({configFile:file,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');if(url.endsWith('/models'))return response({data:[{id:config.chat.model}]});if(url.endsWith('/health/ready'))return response({status:'ready',id:'Qwen/Qwen3-ASR-1.7B'});return response({status:'healthy',version:'fixture'});}});
 assert(directory instanceof AllIntranetDirectory);assert.equal(directory.localMedia,undefined);await directory.refresh();assert.equal(calls.length,3);assert(calls.every(x=>x.startsWith('http://10.0.0.32:')));assert.equal(directory.get('ocr').transport,'intranet-http');assert.equal(directory.status().localModelsEnabled,false);assert.equal(directory.status().publicCloudEnabled,false);assert.equal(directory.connection().baseUrl,config.chat.baseUrl);
});
test('内网OCR断线只报未就绪，不启动本地OCR，也不回云端',async()=>{
 const directory=new AllIntranetDirectory(config,{fetchImpl:async(url)=>{if(url.includes(':8010'))throw Error('synthetic offline');return response(url.includes(':6001')?{status:'ready',id:'Qwen/Qwen3-ASR-1.7B'}:{data:[{id:config.chat.model}]});}});await directory.refresh();assert.equal(directory.get('chat').ready,true);assert.equal(directory.localMedia,undefined);assert.throws(()=>directory.get('ocr'),/未就绪/);assert.equal(directory.status().publicCloudEnabled,false);
});
test('09内网OCR逐张映射原页，保留远端原始坐标及任务回执，不猜bbox单位',async t=>{
 const dir=temp(t),input=path.join(dir,'page.png');fs.writeFileSync(input,Buffer.from('synthetic-image'));let calls=0;
 const result=await recognizeInvoiceInputs([{path:input,page:4}],media,AbortSignal.timeout(5000),()=>{},{fetchImpl:async(url,o)=>{calls++;assert.equal(url,media.ocr.baseUrl+'/file_parse');assert.equal(o.body.get('backend'),'vlm-engine');assert.equal(o.body.get('end_page_id'),'0');assert.equal(await o.body.get('files').text(),'synthetic-image');assert.equal(o.redirect,'error');return response(parsed());}});
 assert.equal(calls,1);assert.equal(result.pages[0].page,4);assert.equal(result.pages[0].remoteTaskId,'fixture-remote-id');assert.equal(result.records[0].page,4);assert.equal(result.records[0].bbox,undefined);assert.deepEqual(result.records[0].rawBbox,[1,2,300,40]);assert.equal(result.localModelCalls,0);assert(fs.existsSync(path.join(dir,'intranet-response.json')));
});
test('09局部识别失败独立留档，不把错误页码作为成功，不回本地补跑',async t=>{
 const dir=temp(t),input=path.join(dir,'crop.png');fs.writeFileSync(input,'synthetic');const wrong=parsed();wrong.results.source.content_list='[{"page_idx":1,"text":"wrong page"}]';
 const r=await recognizeInvoiceInputs([{path:input,page:7,region:{id:'roi'},roiId:'roi'}],media,AbortSignal.timeout(5000),()=>{},{fetchImpl:async()=>response(wrong)});assert.equal(r.pages[0].status,'failed');assert.match(r.pages[0].error,/页码/);assert.equal(r.records.length,0);assert.equal(r.localModelCalls,0);
});
test('09真实适配器整页、视觉与ROI均走内网HTTP，没有Python或权重配置',async t=>{
 const root=temp(t),store=new Store(root),h=new Harness(store),w=new Workspace(store,h),canvas=createCanvas(200,120);canvas.getContext('2d').fillText('SYNTHETIC',10,40);const f=await w.upload({name:'synthetic.png',base64:canvas.toBuffer('image/png').toString('base64')});
 const c={...media,version:'v7-invoice-intranet-1',enabled:true,chat:{...config.chat,images:false},allowedOriginalSha256:[f.sha256]};assert.doesNotThrow(()=>validateInvoiceRuntimeConfig(c));const runtime=createInvoiceRuntime(store,h,c),originalFetch=globalThis.fetch,urls=[];
 globalThis.fetch=async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');if(url===media.vision.baseUrl+'/v1/chat/completions'){const b=JSON.parse(options.body);assert.equal(b.model,media.vision.model);return response({choices:[{message:{content:'发票号码：SYN-09'},finish_reason:'stop'}]});}assert.equal(url,media.ocr.baseUrl+'/file_parse');return response(parsed('发票号码：SYN-09'));};t.after(()=>{globalThis.fetch=originalFetch;});
 const ocr=await runtime.recognize(f,AbortSignal.timeout(20000));assert.equal(ocr.provider,'intranet');assert.equal(ocr.localModelCalls,0);assert(ocr.recognitionRunId);assert.equal(ocr.localRunId,undefined);const receipt=JSON.parse(fs.readFileSync(ocr.receipt,'utf8'));assert.equal(receipt.transport,'intranet-http');
 const vision=await runtime.look(f.id,'读取字段',AbortSignal.timeout(20000));assert.equal(vision.provider,'intranet');assert(vision.text.includes('SYN-09'));
 const roi=await runtime.recover(f,['invoiceNumber'],{totalPages:1},AbortSignal.timeout(20000));assert.equal(roi.provider,'intranet');assert.equal(roi.localModelCalls,0);assert(roi.regionalSources.length>0);assert(roi.regionalSources.every(s=>s.layoutRecords.every(r=>r.pageBbox===null)));assert(urls.length>=3);assert(urls.every(u=>u.startsWith('http://10.0.0.')));
 assert.equal(runtime.descriptor.localModelsEnabled,false);assert.equal(runtime.harness.invoiceVisionAvailable,true);
});

test('全内网部署只启用已验证的09远程适配器，拒绝错配或云端覆盖',async()=>{
 const {deploymentInvoiceOptions}=await import('../src/invoices/invoice-deployment.mjs');const status=()=>({configured:true,provider:'intranet',localModelsEnabled:false,ocrTransport:'intranet-http'}),safe={descriptor:{provider:'intranet',localModelsEnabled:false,ocrTransport:'intranet-http'}};
 const enabled=deploymentInvoiceOptions({intranetOnly:true},{factory:()=>safe,status});assert.equal(enabled.invoiceRuntimeFactory(),safe);
 const wrong=deploymentInvoiceOptions({intranetOnly:true},{factory:()=>({descriptor:{provider:'siliconflow'}}),status});assert.throws(()=>wrong.invoiceRuntimeFactory(),/不一致/);
 const blocked=deploymentInvoiceOptions({intranetOnly:true},{factory:()=>assert.fail('called cloud'),status:()=>({configured:true,provider:'siliconflow'})});assert.equal(blocked.invoiceRuntimeFactory(),null);
});
