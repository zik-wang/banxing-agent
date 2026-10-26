import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readOriginal} from './workspace-files.mjs';
import {isAudioExtension} from './audio-formats.mjs';
import {pcmWavFromAudio} from './audio-decode.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
export class LocalMediaRuntime{
 constructor(config,{spawnImpl=spawn}={}){this.config=config;this.spawn=spawnImpl;this.tail=Promise.resolve();}
 status(){return Object.fromEntries(['asr','ocr'].map(kind=>{const s=this.config[kind],files=kind==='asr'?['config.json','model.safetensors.index.json']:['config.json','model.safetensors'];const ready=fs.existsSync(this.config.python)&&(kind==='asr'||fs.existsSync(this.config.libraries))&&files.every(f=>fs.existsSync(path.join(s.modelPath,f)));return [kind,{ready,model:s.model,device:s.device||'cuda:0',transport:'local-worker',error:ready?null:'本地Python、模型或识别依赖不完整'}];}));}
 async queued(signal,execute){const previous=this.tail;let release,abort;const turn=new Promise(resolve=>release=resolve);this.tail=previous.then(()=>turn);try{const cancelled=new Promise((_resolve,reject)=>{abort=()=>reject(signal.reason||Error('本地识别排队已取消'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});await Promise.race([previous,cancelled]);signal?.throwIfAborted();return await execute();}finally{signal?.removeEventListener('abort',abort);release();}}
 async run(kind,store,file,signal,log=()=>{},pages){
  if(!this.status()[kind].ready)throw Error('本地'+kind.toUpperCase()+'环境未就绪');
  return this.queued(signal,async()=>{
   signal?.throwIfAborted();let bytes=readOriginal(store,file),extension=file.extension;
   if(kind==='asr'&&extension!=='.wav'){if(!isAudioExtension(extension))throw Error('这不是可识别的录音');bytes=await pcmWavFromAudio(bytes,extension);if(!bytes)throw Error('本地ASR需要可解码的PCM WAV录音');extension='.wav';}
   const id=randomUUID(),directory=path.join(this.config.dataDirectory,'local-media',id);fs.mkdirSync(directory,{recursive:true});
   const inputFile=path.join(directory,'input'+extension);fs.writeFileSync(inputFile,bytes);
   const request={kind,filePath:inputFile,modelPath:this.config[kind].modelPath,device:this.config[kind].device||'cuda:0',pages},receipt={id,kind,fileId:file.id,inputSha256:file.sha256,workerInputSha256:sha(bytes),model:this.config[kind].model,modelPath:this.config[kind].modelPath,pages:pages||null,status:'running',startedAt:new Date().toISOString(),device:this.config[kind].device||'cuda:0',transport:'local-worker'};
   write(path.join(directory,'receipt.json'),receipt);log('progress','本地 '+receipt.model+' 正在识别',file.name);
   const environment={SystemRoot:process.env.SystemRoot||'',WINDIR:process.env.WINDIR||'',PATH:path.dirname(this.config.python)+path.delimiter+(process.env.SystemRoot||'C:/Windows')+'/System32',TEMP:process.env.TEMP||'',TMP:process.env.TMP||'',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:kind==='ocr'?this.config.libraries:'',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',HF_HOME:path.join(this.config.dataDirectory,'local-media-cache','huggingface'),TORCH_HOME:path.join(this.config.dataDirectory,'local-media-cache','torch'),OMP_NUM_THREADS:'4'};
   try{return await new Promise((resolve,reject)=>{
    let stdout='',stderr='',finished=false,timer,child;
    const finish=(error,payload)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)child?.kill();Object.assign(receipt,{status:error?'failed':'succeeded',finishedAt:new Date().toISOString(),error:error?.message||null});write(path.join(directory,'receipt.json'),receipt);fs.writeFileSync(path.join(directory,'stdout.json'),stdout);fs.writeFileSync(path.join(directory,'stderr.log'),stderr);error?reject(error):resolve({...payload,provider:'local',localCallId:id,receipt:path.join(directory,'receipt.json')});};
    const abort=()=>finish(Error('本地识别已取消，工作进程已停止'));
    try{child=this.spawn(this.config.python,['-u',path.join(ROOT,'scripts/local-media-worker.py')],{cwd:directory,windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});}catch(error){finish(error);return;}
    timer=setTimeout(()=>finish(Error('本地识别超时，保留原件和失败记录')),PROCESSING_LIMITS.modelTimeoutMs);signal?.addEventListener('abort',abort,{once:true});
    child.stdin.on('error',()=>{});child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(Buffer.byteLength(stdout)>4*1024*1024)finish(Error('本地识别结果超过预算，请拆分材料'));});child.stderr.on('data',chunk=>{const text=chunk.toString('utf8');stderr=(stderr+text).slice(-128000);for(const line of text.split('\n'))if(line.startsWith('MEDIA_EVENT '))try{const e=JSON.parse(line.slice(12));log('progress',String(e.label).slice(0,200),'本机模型执行');}catch{}});
    child.on('error',error=>finish(error));child.on('close',(code,exitSignal)=>{if(finished)return;receipt.exitCode=code;receipt.exitSignal=exitSignal;if(!stdout.trim()){finish(Error('本地识别进程退出且未返回JSON（退出码 '+code+'）；失败记录 '+id));return;}try{const payload=JSON.parse(stdout.trim().split('\n').at(-1));if(code!==0||!payload.ok)throw Error(payload.error||'本地识别进程异常');if(typeof payload.content!=='string'||!payload.content.trim())throw Error('本地识别没有返回有效文字');readOriginal(store,file);if(sha(fs.readFileSync(inputFile))!==receipt.workerInputSha256)throw Error('识别输入副本发生变化');finish(null,payload);}catch(error){finish(error);}});
    if(signal?.aborted){abort();return;}child.stdin.end(JSON.stringify(request));
   });}finally{if(fs.existsSync(inputFile))fs.unlinkSync(inputFile);}
  });
 }
 async transcribe(store,file,signal,log){return this.run('asr',store,file,signal,log);}
 async recognize(store,file,signal,log){const result=await this.run('ocr',store,file,signal,log);if(result.failedPages?.length)throw Error('部分OCR页识别失败：'+result.failedPages.join('、')+'；本地调用 '+result.localCallId);return result;}
 async recognizePages(store,file,pages,signal,log){if(!pages.length||pages.length>10||pages.some(p=>!Number.isInteger(p)||p<1)||Math.max(...pages)-Math.min(...pages)>=10)throw Error('本地分页OCR需要1至10个明确连续页段');const result=await this.run('ocr',store,file,signal,log,pages);return {pages:result.pages,executed:true,model:result.model,device:result.device,localCallId:result.localCallId,requestedPages:pages,failedPages:result.failedPages||[],error:result.failedPages?.length?'部分请求页失败，成功页独立保留':null};}
}
