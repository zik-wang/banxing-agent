import {LocalMediaRuntime} from '../media/local-media-runtime.mjs';
import {validateServiceUrl,readJson} from './intranet.mjs';
import {inferenceProfile} from './inference-config.mjs';
export class ConfiguredIntranetDirectory{
 #config;#apiKey;
 constructor(config,{fetchImpl=fetch,localMedia,readCredentials}={}){
  const c=structuredClone(config),url=new URL(c.chat?.baseUrl);
  if(c.version!=='v7-intranet-1'||c.chat.provider!=='intranet'||url.pathname.replace(/\/$/,'')!=='/v1'||url.username||url.password||url.search||url.hash)throw Error('内网推理配置无效');
  validateServiceUrl(url.origin);
  if(typeof c.chat.model!=='string'||!c.chat.model.trim()||!['native-tools','structured-json'].includes(c.chat.analysisMode))throw Error('需要真实内网模型ID和已选输出模式');
  if(!['none','env'].includes(c.chat.auth?.type))throw Error('内网认证方式无效');
  this.#apiKey=c.chat.auth.type==='env'?readCredentials?.(c.chat.auth.envFile)?.[c.chat.auth.keyVariable]:'local-keyless';
  if(!this.#apiKey||/\s/.test(this.#apiKey))throw Error('内网凭据引用无效');
  this.#config=c;inferenceProfile({provider:'qwen',modelName:c.chat.model,baseUrl:c.chat.baseUrl,analysisMode:c.chat.analysisMode,inference:c.chat.inference});
  this.fetch=fetchImpl;this.localMedia=localMedia||new LocalMediaRuntime({...c.local,dataDirectory:c.dataDirectory});this.services={};this.capabilities=[];this.mode='local-media-configured-intranet';this.error=null;this.lastCheckedAt=null;
 }
 async refresh(){const c=this.#config,local=this.localMedia.status();this.services={...local,chat:{model:c.chat.model,baseUrl:c.chat.baseUrl,analysisMode:c.chat.analysisMode,inference:c.chat.inference||{},label:'内网 Qwen 27B',ready:false}};try{const r=await readJson(await this.fetch(c.chat.baseUrl.replace(/\/$/,'')+'/models',{headers:{Authorization:'Bearer '+this.#apiKey},signal:AbortSignal.timeout(15000),redirect:'error'}));if(!r.data?.some(m=>m.id===c.chat.model))throw Error('未返回配置中的真实内网模型');this.services.chat.ready=true;this.error=null;}catch(error){this.error=String(error.message).split(this.#apiKey).join('[已隐藏密钥]');this.services.chat.error=this.error;}finally{this.lastCheckedAt=new Date().toISOString();}}
 get(kind){const s=this.services[kind];if(!s?.ready)throw Error('所选内网或本机服务未就绪');return s;}
 connection(){const s=this.get('chat');return {provider:'qwen',modelName:s.model,baseUrl:s.baseUrl,label:s.label,analysisMode:s.analysisMode,inference:s.inference,apiKey:this.#apiKey};}
 async discoverMore(){}
 status(){return {mode:this.mode,services:this.services,capabilities:[],catalogUrl:null,lastCheckedAt:this.lastCheckedAt,error:this.error,searchEnabled:false,publicCloudEnabled:false,privacy:'ASR/OCR在本机运行；文字仅发送到显式配置且处于原内网白名单的27B接口。部署格式需实测核验。'};}
}
