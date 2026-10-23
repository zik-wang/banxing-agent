import {createInvoiceBatchPorts} from './invoice-batch-ports.mjs';
import {BATCH_VERSION} from './invoice-stages.mjs';
import {recognizeInvoiceInputs,lookInvoiceIntranet,validateInvoiceMediaConfig} from './invoice-intranet-media.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readOriginal} from './workspace-files.mjs';
import {analyzeTask} from './workflow-ai.mjs';
import {runDeepSeek} from './deepseek-runtime.mjs';
import {renderInvoicePages} from './invoice-local-render.mjs';
import {readInvoiceOcrCheckpoints} from './invoice-roi-checkpoints.mjs';
import {inspectInvoiceGeometry,renderInvoiceRoi} from './invoice-roi-render.mjs';
import {locateFieldRegions,roiConfig,roiCacheKey,cropBoxToPage,ROI_VERSION} from './invoice-roi.mjs';
import {RELATION_VERSION} from './invoice-relations.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const CONFIG=path.join(ROOT,'.local-runtime','invoice09-config.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
let gpuTail=Promise.resolve();
function terminateOwnedOcrWorker(child){
  if(child.exitCode!==null||!child.pid)return;
  if(process.platform!=='win32'){child.kill();return;}
  // The PID belongs to the process spawned just below. Venv launchers may
  // create a child Python; terminate this owned tree, never unrelated models.
  const killer=spawn(path.join(process.env.SystemRoot||'C:/Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  killer.on('error',()=>child.kill());
}
export function validateInvoiceRuntimeConfig(config){
  const remote=config.version==='v7-invoice-intranet-1',intranet=remote||config.version==='v7-invoice-intranet-local-1';
  if(!intranet&&config.version!=='v7-invoice-cloud-local-1'||config.enabled!==true)throw Error('09运行配置无效');
  if(config.chat?.analysisMode&&!['native-tools','structured-json'].includes(config.chat.analysisMode))throw Error('09模型输出模式无效');
  if(config.chat?.images!==false)throw Error('09仅允许文字接口');
  if(intranet){
    if(config.chat.provider!=='intranet'||config.chat.baseUrl!=='http://10.0.0.32:8861/v1'||config.chat.model!=='qwen3.8-27b-fp8'||config.chat.auth?.type!=='none')throw Error('09内网接口、型号或认证配置不符');
  }else if(config.chat.baseUrl!=='https://api.siliconflow.cn/v1'||config.chat.model!=='Qwen/Qwen3.8-27B')throw Error('09仅允许指定云端27B文字接口');
  if(remote)validateInvoiceMediaConfig(config);
  else if(config.ocr.model!=='OpenDataLab/MinerU2.5-Pro-2605-1.2B')throw Error('09本地OCR模型不符');
  for(const p of [...(intranet?[]:[config.chat.envFile]),...(remote?[]:[config.python,config.libraries,config.ocr.modelPath])])if(typeof p!=='string'||!path.isAbsolute(p))throw Error('09配置必须使用绝对路径');
  if(!Array.isArray(config.allowedOriginalSha256)||!config.allowedOriginalSha256.length||config.allowedOriginalSha256.some(h=>!/^\w{64}$/.test(h)))throw Error('09缺少明确授权的原件哈希范围');
  return structuredClone(config);
}
export function readInvoiceRuntimeConfig(file=CONFIG){
  if(!fs.existsSync(file))return null;
  const bytes=fs.readFileSync(file);if(bytes.length>65536)throw Error('09配置过大');
  return validateInvoiceRuntimeConfig(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
}
export function invoiceRuntimeStatus(){try{const c=readInvoiceRuntimeConfig();return c?{configured:true,batchVersion:c.version==='v7-invoice-intranet-1'?BATCH_VERSION:null,roiVersion:ROI_VERSION,relationVersion:RELATION_VERSION,ocr:c.ocr.model,chat:c.chat.model,provider:c.chat.provider==='intranet'?'intranet':'siliconflow',baseUrl:c.chat.baseUrl,localFilesPresent:c.version==='v7-invoice-intranet-1'?null:[c.python,c.libraries,c.ocr.modelPath].every(p=>fs.existsSync(p)),localModelsEnabled:c.version!=='v7-invoice-intranet-1',ocrTransport:c.version==='v7-invoice-intranet-1'?'intranet-http':'offline-local-worker',vision:c.vision?.model||'not_configured',imagesSentToCloud:false,authorizedOriginals:c.allowedOriginalSha256.length}:null;}catch{return {configured:false,error:'09专用运行配置不可用'};}}
function credential(config){
  const bytes=fs.readFileSync(config.chat.envFile);if(bytes.length>65536)throw Error('凭据配置过大');
  const line=bytes.toString('utf8').split(/\r?\n/).find(l=>/^\s*LLM_API_KEY\s*=/.test(l));
  const key=line?.replace(/^\s*LLM_API_KEY\s*=\s*/,'').trim().replace(/^(['"])(.*)\1$/,'$2');
  if(!key||/\s/.test(key))throw Error('09云端凭据缺失');return key;
}
export function invoiceModelConnection(config){
  config=validateInvoiceRuntimeConfig(config);
  if(['v7-invoice-intranet-local-1','v7-invoice-intranet-1'].includes(config.version))return {baseUrl:config.chat.baseUrl,modelName:config.chat.model,apiKey:'local-keyless',provider:'qwen',label:'内网 Qwen3.8-27B FP8 · 仅文字',...(config.chat.analysisMode?{analysisMode:config.chat.analysisMode,inference:config.chat.inference||{}}:{})};
  return {baseUrl:config.chat.baseUrl,modelName:config.chat.model,apiKey:credential(config),provider:'siliconflow',label:'云端 Qwen3.8-27B · 仅文字',invoiceTextOnly:true};
}
export function assertTextOnlyAnalysis(args){
  if(!['invoice-evidence','invoice-field-recovery'].includes(args.kind))throw Error('09运行器不能处理其他场景');
  for(const d of args.documents||[])if(typeof d.text!=='string'||Object.keys(d).some(k=>/base64|image|bytes|url/i.test(k)))throw Error('09文字提取只接受证据文字');
}
export function assertInvoiceScope(config,hashes){if(!hashes.length||hashes.some(h=>!config.allowedOriginalSha256.includes(h)))throw Error('本次授权仅覆盖两包指定票据；其他原件未获授权');}
export function planInvoiceRegions(fields,totalPages=1){
  if(totalPages!==1)return [];
  const top=fields.filter(f=>['invoiceNumber','billNumber','date','invoiceCode','machineNumber'].includes(f));
  const bottom=fields.filter(f=>['total','currency'].includes(f));
  return [...(top.length?[{id:'header',page:1,bbox:[0,0,1,0.42],fields:top,selection:'heuristic header; not a verified field location'}]:[]),...(bottom.length?[{id:'amount',page:1,bbox:[0,0.42,1,1],fields:bottom,selection:'heuristic lower region; not a verified field location'}]:[])];
}
export function createInvoiceRuntime(store,harness,config=readInvoiceRuntimeConfig()){
  if(!config)return null;config=validateInvoiceRuntimeConfig(config);
  const remote=config.version==='v7-invoice-intranet-1',facade=Object.create(harness),connection=invoiceModelConnection(config),apiKey=connection.apiKey;
  facade.invoiceNetworkPolicy=()=>{validateInvoiceRuntimeConfig(config);for(const p of remote?[]:[config.python,config.libraries,config.ocr.modelPath])if(!fs.existsSync(p))throw Error('09本地OCR环境缺失');};
  facade.invoiceVisionAvailable=remote;facade.invoiceStructuredSubmission=true;
  facade.modelConnection=()=>({...connection});
  facade.runAgent=runDeepSeek;
  const descriptor={version:config.version,provider:config.chat.provider==='intranet'?'intranet':'siliconflow',relationVersion:RELATION_VERSION,model:config.chat.model,baseUrl:config.chat.baseUrl,ocr:config.ocr.model,imagesSentToCloud:false,vision:remote?config.vision.model:'not_configured',ocrTransport:remote?'intranet-http':'offline-local-worker',localModelsEnabled:!remote,regionalRecovery:ROI_VERSION,replay:false};
  const runtime={harness:facade,descriptor,async analyze(args){
    assertTextOnlyAnalysis(args);assertInvoiceScope(config,(args.documents||[]).map(d=>d.originalSha256));facade.invoiceNetworkPolicy();
    const id=randomUUID(),root=path.join(store.directory,'invoice-runtime');fs.mkdirSync(root,{recursive:true});
    const record={id,kind:args.kind,...descriptor,startedAt:new Date().toISOString(),documents:(args.documents||[]).map(d=>({id:d.id,characters:d.text.length,textSha256:sha(d.text)})),requests:0,status:'running',usage:'see harness session; not independently totaled'};
    const save=()=>fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify(record,null,2));save();
    const audit={beforeRequest(){if(++record.requests>5)throw Error('09单轮请求预算耗尽');save();args.onInvoiceRequest?.({startedAt:new Date().toISOString(),requestId:id+'/'+record.requests});args.audit?.beforeRequest();},submitted:r=>args.audit?.submitted(r),session:r=>{record.session=r;save();args.audit?.session(r);}};
    try{const selected=args.invoiceAmbiguity?Object.assign(Object.create(facade),{modelConnection:()=>({...connection,invoiceBatch:true,analysisMode:'structured-json',inference:{...connection.inference,max_output_tokens:1400,context_budget_tokens:12000,timeout_ms:45000}})}):facade;const output=await analyzeTask(selected,{...args,audit});record.status=output.transportWarnings?.length?'submitted_ack_failed':'succeeded';return output;}catch(e){record.status='failed';record.error=String(e.message).split(apiKey).join('[已隐藏密钥]');throw Object.assign(Error(record.error),{code:args.invoiceAmbiguity&&/模型处理超时，请缩小问题/.test(record.error)?'harness_timeout':e.code});}finally{record.finishedAt=new Date().toISOString();save();}
  },async recognize(file,signal,log=()=>{}){
    assertInvoiceScope(config,[file.sha256]);const previous=gpuTail;let release;gpuTail=new Promise(r=>release=r);
    try{await previous;signal.throwIfAborted();return await recognizeLocal(store,file,config,signal,log);}finally{release();}
  },async recover(file,fields,coverage,signal,log=()=>{},context={}){
    assertInvoiceScope(config,[file.sha256]);const started=performance.now(),settings=roiConfig({...config.roi,...(context.batchMode?{maxRegions:1,maxRegionsPerField:1,maxMilliseconds:120000}:{})}),bytes=readOriginal(store,file);
    const geometry=await inspectInvoiceGeometry(bytes,file.extension,{signal,...settings});
    const sources=context.sources||[],blocks=geometry.blocks.map(b=>{const s=sources.find(s=>s.reader==='pdf_text'&&s.page===b.page),start=s?.text.indexOf(b.text)??-1;return {...b,sourceId:s?.id,span:start>=0?{start,end:start+b.text.length}:null};});
    for(const raw of context.rawOutputs||[])if(raw.reader==='ocr'&&raw.phase!=='regional_recovery')for(const [index,b]of (raw.output?.records||[]).entries()){
      if(b.region||!b.bbox)continue;const source=sources.find(s=>s.reader==='ocr'&&s.page===(b.page||1)),text=b.text??b.content??'',start=source?.text.indexOf(text)??-1;
      blocks.push({...b,id:'ocr-'+index,page:b.page||1,text,sourceId:source?.id,span:start>=0&&text?{start,end:start+text.length}:null});
    }
    const plan=locateFieldRegions({file,fields,pages:geometry.pages,blocks,candidates:context.candidates||[],sources,documentType:context.documentType||'unknown',config:settings});
    plan.totalPages=geometry.totalPages;plan.unindexedPages=geometry.unindexedPages;plan.locatorMilliseconds=performance.now()-started;
    for(const r of plan.regions)r.sourceQuality=geometry.pages.find(p=>p.page===r.page)?.sourceQuality;
    const planRoot=path.join(store.directory,'invoice-roi-plans');fs.mkdirSync(planRoot,{recursive:true});fs.writeFileSync(path.join(planRoot,randomUUID()+'.json'),JSON.stringify({...plan,fileId:file.id,originalSha256:file.sha256},null,2));
    if(!plan.regions.length)return {sources:[],regionalSources:[],regions:[],attempted:false,reason:'No bounded field ROI available',plan};
    const previous=gpuTail;let release;gpuTail=new Promise(r=>release=r);
    try{await previous;signal.throwIfAborted();const result=await recognizeLocal(store,file,config,signal,log,plan.regions);return {...result,plan};}finally{release();}
  },async look(id,question,signal){if(!remote)throw Error('09尚未配置独立视觉；原图不发送云端');const file=store.state.workspaceFiles.find(f=>f.id===id);if(!file)throw Error('09视觉原件不存在');assertInvoiceScope(config,[file.sha256]);return lookInvoiceIntranet(store,file,config,question,signal);}};
  if(remote){runtime.batch=createInvoiceBatchPorts(store,config,args=>runtime.analyze(args));runtime.batch.recover=(file,fields,coverage,s,l,c)=>runtime.recover(file,fields,coverage,s,l,{...c,batchMode:true});descriptor.batchVersion=BATCH_VERSION;}
  return runtime;
}
async function recognizeLocal(store,file,config,signal,log,regions=[]){
  const remote=config.version==='v7-invoice-intranet-1',original=readOriginal(store,file),id=randomUUID(),root=path.join(store.directory,remote?'invoice-intranet-ocr':'invoice-local-ocr',id);fs.mkdirSync(root,{recursive:true});
  const receipt={id,provider:remote?'intranet':'local',transport:remote?'intranet-http':'local-worker',localModelCalls:remote?0:1,fileId:file.id,originalSha256:file.sha256,model:config.ocr.model,status:'rendering',startedAt:new Date().toISOString(),cached:false,imagesSentToCloud:false,kind:regions.length?'regional_recovery':'full_page_ocr',regions,pages:[]};
  const save=()=>fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));save();
  try{
    const settings=roiConfig(config.roi||{});receipt.roiVersion=ROI_VERSION;receipt.renderErrors=[];
    let inputs=[];const renderStarted=performance.now();
    if(!regions.length)inputs=(await renderInvoicePages(original,file.extension,{signal,maxPages:10,maxPixels:settings.maxPixels})).pages;
    else for(const r of regions){
      signal.throwIfAborted();const evidence=path.join(root,r.id);fs.mkdirSync(evidence,{recursive:true});
      try{const p=await renderInvoiceRoi(original,file.extension,r,{signal,...settings});
        fs.writeFileSync(path.join(evidence,'page-preview.png'),p.preview);fs.writeFileSync(path.join(evidence,'roi-overlay.png'),p.overlay);fs.writeFileSync(path.join(evidence,'roi-crop.png'),p.png);
        const metadata={...p.metadata,ocrCallId:id,cropSha256:sha(p.png),inputFile:path.join(evidence,'roi-crop.png'),model:config.ocr.model,cacheKey:roiCacheKey({sha256:file.sha256,pageIndex:r.pageIndex,bbox:p.metadata.actualBbox,dpi:p.metadata.renderDpi,preprocessing:p.metadata.preprocessing,model:config.ocr.model}),status:'rendered'};
        fs.writeFileSync(path.join(evidence,'roi-metadata.json'),JSON.stringify(metadata,null,2));fs.writeFileSync(path.join(evidence,'ocr-before.json'),JSON.stringify(r.anchorBlocks,null,2));
        inputs.push({page:r.page,png:p.png,width:p.width,height:p.height,region:metadata,evidence});
      }catch(e){if(signal.aborted)throw e;receipt.renderErrors.push({roiId:r.id,fields:r.fields,page:r.page,error:String(e.message).slice(0,300),status:'recovery_failed'});fs.writeFileSync(path.join(evidence,'render-failure.json'),JSON.stringify(receipt.renderErrors.at(-1),null,2));}
    }
    receipt.renderMilliseconds=performance.now()-renderStarted;if(regions.length)inputs.sort((a,b)=>a.width*a.height-b.width*b.height);if(!inputs.length)throw Error('All ROI renders failed; see receipt renderErrors');
    const pages=inputs.map((p,index)=>{const inputName=regions.length?p.region.id+'/roi-crop.png':'page-'+(index+1)+'.png',dest=path.join(root,inputName);if(!regions.length)fs.writeFileSync(dest,p.png,{flag:'wx'});receipt.pages.push({page:p.page,inputName,width:p.width,height:p.height,rotation:p.rotation,pdfPageRotation:p.pdfPageRotation,region:p.region||null,sha256:sha(p.png)});return {page:p.page,path:dest,region:p.region||null,roiId:p.region?.id||null};});
    const allPages=pages,cacheRoot=path.join(store.directory,'invoice-roi-cache'),cachedInputs=new Map();
    if(regions.length){fs.mkdirSync(cacheRoot,{recursive:true});for(const [index,p]of allPages.entries()){
      const key=p.region.cacheKey,cacheFile=path.join(cacheRoot,key+'.json');if(!fs.existsSync(cacheFile))continue;
      try{const b=fs.readFileSync(cacheFile);if(b.length>8*1024*1024)throw Error('cache too large');const v=JSON.parse(b);if(v.version!==ROI_VERSION||v.cropSha256!==receipt.pages[index].sha256||v.model!==config.ocr.model||v.originalSha256!==file.sha256||v.key!==key||v.status!=='returned')throw Error('cache mismatch');cachedInputs.set(index,v);receipt.pages[index].cached=true;receipt.pages[index].reusedOcrCallId=v.ocrCallId;}catch{receipt.pages[index].cacheRejected=true;}
    }}
    const fresh=allPages.filter((_,i)=>!cachedInputs.has(i));receipt.cacheHits=cachedInputs.size;receipt.newOcrInputs=fresh.length;
    receipt.status='recognizing';receipt.ocrStartedAt=new Date().toISOString();save();log(fresh.length?'ocr':'ocr-cache',fresh.length?(remote?'公司内网 MinerU 正在逐页识别':'本地 MinerU 正在逐页识别'):'复用本轮ROI识别结果（无新增OCR推理）',file.name);
    const environment=remote?null:{SystemRoot:process.env.SystemRoot||'C:/Windows',WINDIR:process.env.WINDIR||'C:/Windows',PATH:path.dirname(config.python)+path.delimiter+'C:/Windows/System32',TEMP:root,TMP:root,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:config.libraries,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',HF_HOME:path.join(root,'hf-cache'),TORCH_HOME:path.join(root,'torch-cache'),OMP_NUM_THREADS:'4'};
    let payload;try{payload=remote?await recognizeInvoiceInputs(fresh,config,signal,log,{timeoutMs:Math.min(120000,settings.maxMilliseconds)}):fresh.length?await new Promise((resolve,reject)=>{
      let stdout='',done=false,timer;const child=spawn(config.python,['-u',path.join(ROOT,'invoice-local-worker.py')],{cwd:root,windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error)terminateOwnedOcrWorker(child);error?reject(error):resolve(value);};
      const abort=()=>finish(Error('09本地OCR已取消'));
      timer=setTimeout(()=>finish(Error('09本地OCR超过配置恢复时限，保留失败与原件')),settings.maxMilliseconds);
      child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{stdout+=s;if(Buffer.byteLength(stdout)>8*1024*1024)finish(Error('09本地OCR输出超过预算'));});
      // Third-party library stderr can contain model text. Retain only typed progress.
      child.stderr.setEncoding('utf8');let pending='';child.stderr.on('data',s=>{pending+=s;const lines=pending.split('\n');pending=lines.pop().slice(-2000);for(const line of lines)if(line.startsWith('INVOICE_PROGRESS '))try{const p=JSON.parse(line.slice(17));log('ocr','本地 MinerU 第'+p.page+'页',file.name);}catch{}});
      child.on('error',e=>finish(e));child.stdin.on('error',()=>{});
      child.on('close',code=>{if(done)return;try{const p=JSON.parse(stdout.trim().split('\n').at(-1));if(code!==0||!p.ok)throw Error(p.error||'09本地OCR进程失败');if(!p.content||p.pages.length!==fresh.length)throw Error('09本地OCR页覆盖不完整');finish(null,p);}catch(e){finish(e);}});
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}child.stdin.end(JSON.stringify({modelPath:config.ocr.modelPath,pages:fresh}));
    }):{model:config.ocr.model,pages:[],records:[],content:'',allInputsReused:true};}catch(error){if(signal.aborted||!regions.length||remote)throw error;payload=readInvoiceOcrCheckpoints(fresh,config.ocr.model);receipt.workerInterrupted=String(error.message).slice(0,300);}
    if(regions.length){const mergedPages=[],mergedRecords=[];
      for(const [index,p]of allPages.entries()){
        const cached=cachedInputs.get(index),freshIndex=fresh.indexOf(p),page=cached?cached.page:payload.pages[freshIndex],records=cached?cached.records:payload.records.filter(b=>b.inputIndex===freshIndex);
        const pageRecord={...page,inputIndex:index,page:p.page,roiId:p.region.id,cached:!!cached};mergedPages.push(pageRecord);
        const adapted=records.map(b=>({...b,page:p.page,inputIndex:index,roiId:p.region.id,region:p.region}));mergedRecords.push(...adapted);
        if(!cached&&page?.status==='returned'){const record={version:ROI_VERSION,key:p.region.cacheKey,model:config.ocr.model,originalSha256:file.sha256,cropSha256:receipt.pages[index].sha256,ocrCallId:id,status:'returned',page:pageRecord,records:adapted};fs.writeFileSync(path.join(cacheRoot,p.region.cacheKey+'.json'),JSON.stringify(record));}
      }
      payload={...payload,pages:mergedPages,records:mergedRecords,content:mergedPages.map(p=>p.text).join('\n\n'),cacheHits:cachedInputs.size,newOcrInputs:fresh.length};
    }
    readOriginal(store,file);for(const p of receipt.pages)if(sha(fs.readFileSync(path.join(root,p.inputName)))!==p.sha256)throw Error('渲染页副本被改动');
    receipt.ocrMilliseconds=Date.now()-Date.parse(receipt.ocrStartedAt);
    for(const [index,p]of payload.pages.entries())if(regions.length){const meta=receipt.pages[index].region,evidence=path.join(root,meta.id);fs.writeFileSync(path.join(evidence,'ocr-after.json'),JSON.stringify({ocrCallId:id,roiId:meta.id,status:p.status||'returned',text:p.text,records:payload.records.filter(b=>b.inputIndex===index),error:p.error||null,model:payload.model},null,2));}
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(payload,null,2),{flag:'wx'});receipt.status=payload.pages.some(p=>p.status==='failed')?'partial':'succeeded';return {...payload,provider:remote?'intranet':'local',...(remote?{recognitionRunId:id,localModelCalls:0}:{localRunId:id}),receipt:path.join(root,'receipt.json'),renderedPages:receipt.pages,attempted:regions.length>0,regions,regionalSources:regions.length?payload.pages.map((p,index)=>({text:p.text,page:p.page,model:payload.model,recognitionRunId:id,roiId:receipt.pages[index].region.id,ocrCallId:id,cached:p.cached===true,reusedOcrCallId:receipt.pages[index].reusedOcrCallId||null,targetFields:receipt.pages[index].region.fields,imageRegion:receipt.pages[index].region,layoutRecords:payload.records.filter(b=>b.inputIndex===index).map(b=>({...b,pageBbox:b.bbox?cropBoxToPage(b.bbox,receipt.pages[index].region):null})),rawOutputRef:{container:path.join(root,'result.json'),pageIndex:index}})):[]};
  }catch(e){receipt.status='failed';receipt.error=String(e.message).slice(0,800);throw e;}finally{receipt.finishedAt=new Date().toISOString();save();}
}
