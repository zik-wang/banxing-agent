import {UnconfiguredDirectory,PortableDirectory} from './portable-directory.mjs';
import {AllIntranetDirectory} from './all-intranet-directory.mjs';
import {IntranetOnlyDirectory} from './intranet-only.mjs';
import {ConfiguredIntranetDirectory} from './configured-intranet.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {ServiceDirectory,readJson} from './intranet.mjs';
import {LocalMediaRuntime} from './local-media-runtime.mjs';

export function readEnvFile(file){
 const bytes=fs.readFileSync(file);if(bytes.length>65536)throw Error('模型凭据配置文件过大');
 const result={};for(const line of bytes.toString('utf8').split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);if(m)result[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}return result;
}
export function validateHybridConfig(input){
 if(input?.version!=='v7-hybrid-1'||input.chat?.provider!=='siliconflow')throw Error('混合部署配置版本或平台无效');
 const url=new URL(input.chat.baseUrl);if(url.href.replace(/\/$/,'')!=='https://api.siliconflow.cn/v1')throw Error('本配置只允许明确指定的硅基流动接口');
 if(input.chat.model!=='Qwen/Qwen3.8-27B')throw Error('本配置模型名称与指定27B不一致');
 for(const name of ['envFile','keyVariable'])if(typeof input.chat[name]!=='string'||!input.chat[name])throw Error('缺少云端模型凭据引用');
 if(input.local?.asr?.model!=='Qwen/Qwen3-ASR-1.7B'||input.local?.ocr?.model!=='OpenDataLab/MinerU2.5-Pro-2605-1.2B')throw Error('本地模型名称与指定配置不一致');
 for(const value of [input.chat.envFile,input.local.python,input.local.libraries,input.local.asr.modelPath,input.local.ocr.modelPath,input.dataDirectory])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('部署文件和模型必须使用明确的绝对路径');
 if(input.chat.analysisMode&&!['native-tools','structured-json'].includes(input.chat.analysisMode))throw Error('未知的文档调用模式');
 return structuredClone(input);
}
export class HybridDirectory{
 #config;#apiKey;
 constructor(config,{fetchImpl=fetch,localMedia}={}){
  this.#config=validateHybridConfig(config);this.fetch=fetchImpl;
  const env=readEnvFile(this.#config.chat.envFile);this.#apiKey=env[this.#config.chat.keyVariable]||'';
  if(!this.#apiKey||/\s/.test(this.#apiKey))throw Error('硅基流动密钥未配置或格式无效');
  this.localMedia=localMedia||new LocalMediaRuntime({...this.#config.local,dataDirectory:this.#config.dataDirectory});
  this.services={};this.capabilities=[];this.inflight=null;this.error=null;this.lastCheckedAt=null;this.mode='local-media-cloud-27b';
 }
 async refresh(){if(this.inflight)return this.inflight;this.inflight=(async()=>{
  const local=this.localMedia.status();this.services={...Object.fromEntries(Object.entries(local).map(([kind,s])=>[kind,{...s,name:kind==='asr'?'本地语音识别':'本地文档识别',transport:'local-worker',baseUrl:null}])),chat:{name:'硅基流动27B',model:this.#config.chat.model,baseUrl:this.#config.chat.baseUrl,ready:false,transport:'https',analysisMode:this.#config.chat.analysisMode||'native-tools',label:'云端 Qwen 27B',inference:this.#config.chat.inference||{}}};
  try{const result=await readJson(await this.fetch(this.#config.chat.baseUrl+'/models',{headers:{Authorization:'Bearer '+this.#apiKey},signal:AbortSignal.timeout(15000),redirect:'error'}));if(!result.data?.some(m=>m.id===this.#config.chat.model))throw Error('云端未列出指定27B模型');this.services.chat.ready=true;this.error=null;}catch(error){const message=String(error.message).split(this.#apiKey).join('[已隐藏密钥]');this.services.chat.error=message;this.error=message;}finally{this.lastCheckedAt=new Date().toISOString();}
 })().finally(()=>this.inflight=null);return this.inflight;}
 get(kind){const service=this.services[kind];if(!service?.ready)throw Error((kind==='chat'?'云端27B':'本地'+kind.toUpperCase())+'未就绪：'+(service?.error||'请在设置中检查连接'));return service;}
 connection(){const s=this.get('chat');return {provider:'siliconflow',baseUrl:s.baseUrl,modelName:s.model,label:s.label,analysisMode:s.analysisMode,inference:s.inference,apiKey:this.#apiKey};}
 async discoverMore(){this.capabilities=[];}
 status(){return {mode:this.mode,catalogUrl:null,lastCheckedAt:this.lastCheckedAt,error:this.error,services:this.services,capabilities:this.capabilities,searchEnabled:false,publicCloudEnabled:true,privacy:'ASR/OCR在本机执行；所选业务材料的文字由硅基流动27B处理。识别原件不自动发送云端。'};}
}
export function deploymentConfigPath({configFile=process.env.V7_DEPLOYMENT_CONFIG,defaultFile=path.join(import.meta.dirname,'.local-runtime','active-profile.json')}={}){
 return configFile||(fs.existsSync(defaultFile)?defaultFile:undefined);
}
export function createServiceDirectory({configFile,fetchImpl=fetch}={}){
 configFile=deploymentConfigPath({configFile});
 if(!configFile)return new UnconfiguredDirectory(fetchImpl);
 const bytes=fs.readFileSync(configFile);if(bytes.length>65536)throw Error('部署配置过大');
 const input=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(input.version==='v7-configured-services-1')return new PortableDirectory(input,{fetchImpl});
 if(input.version==='v7-intranet-all-1'&&input.services)return new AllIntranetDirectory(input,{fetchImpl});
 if(input.version==='v7-intranet-all-1')return new IntranetOnlyDirectory(input,{fetchImpl});
 if(input.chat?.provider==='intranet')return new ConfiguredIntranetDirectory(input,{fetchImpl,readCredentials:readEnvFile});
 return new HybridDirectory(input,{fetchImpl});
}
