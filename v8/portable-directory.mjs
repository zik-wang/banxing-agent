import {ServiceDirectory,readJson} from './intranet.mjs';

export class UnconfiguredDirectory extends ServiceDirectory{
 async refresh(){this.services={};this.capabilities=[];this.error='尚未配置模型服务。已有文件转换、历史成果和本机记录仍可使用。';this.lastCheckedAt=new Date().toISOString();}
 async discoverMore(){}
 status(){return {mode:'unconfigured',services:this.services,capabilities:[],catalogUrl:null,error:this.error||'请配置自己的模型服务',lastCheckedAt:this.lastCheckedAt,publicCloudEnabled:false,localModelsEnabled:false,searchEnabled:false,privacy:'尚未连接模型；不会使用内置公司地址或自动启用公网服务。'};}
}
export class PortableDirectory extends ServiceDirectory{
 constructor(config,{fetchImpl=fetch}={}){
  super(fetchImpl);this.config=structuredClone(config);const c=this.config;
  if(c.version!=='v7-configured-services-1'||c.chat?.provider!=='intranet'||c.local)throw Error('配置需显式选择内网服务，不启用本地模型或云端回退');
  if(!Array.isArray(c.allowedOrigins)||!c.allowedOrigins.length)throw Error('需要显式配置允许访问的服务来源');
  const permitted=new Set(c.allowedOrigins.map(v=>{const u=new URL(v);if(u.origin!==v||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('服务来源必须是不含凭据的HTTP(S) origin');return u.origin;}));
  for(const s of [c.chat,...Object.values(c.services||{}),...(c.capabilities||[])]){const u=new URL(s.baseUrl);if(!permitted.has(u.origin)||u.username||u.password||u.search||u.hash)throw Error('服务地址不在明确授权配置内');if(s.auth?.type&&!['none','env'].includes(s.auth.type))throw Error('未知认证方式');}
  if(!c.chat.model||!/\/v1\/?$/.test(c.chat.baseUrl))throw Error('需要真实模型ID及/v1地址');this.mode='configured-intranet';this.intranetOnly=true;
 }
 key(s){if(s.auth?.type!=='env')return 'local-keyless';const value=process.env[s.auth.keyVariable];if(!value||/\s/.test(value))throw Error('服务密钥环境变量未配置');return value;}
 async refresh(){if(this.inflight)return this.inflight;this.inflight=(async()=>{const next={chat:{...this.config.chat,label:'已配置 Qwen',ready:false,transport:'intranet-http'},...Object.fromEntries(Object.entries(this.config.services||{}).map(([k,v])=>[k,{...v,ready:false,transport:'intranet-http'}]))};
  await Promise.all(Object.entries(next).map(async([kind,s])=>{try{const route=kind==='chat'?'/models':s.healthPath||(kind==='asr'?'/health/ready':'/health'),r=await readJson(await this.fetch(s.baseUrl.replace(/\/$/,'')+route,{headers:s.auth?.type==='env'?{Authorization:'Bearer '+this.key(s)}:{},signal:AbortSignal.timeout(15000),redirect:'error'}));if(kind==='chat'&&!r.data?.some(x=>x.id===s.model))throw Error('模型列表未包含所配置ID');if(kind==='ocr'&&!['healthy','ready','ok'].includes(r.status))throw Error('OCR未就绪');if(kind==='asr'&&r.status!=='ready')throw Error('ASR未就绪');s.ready=true;}catch(e){const key=s.auth?.type==='env'?process.env[s.auth.keyVariable]:null;s.error=key?String(e.message).split(key).join('[redacted]'):e.message;}}));this.services=next;this.error=next.chat.ready?null:next.chat.error;this.lastCheckedAt=new Date().toISOString();})().finally(()=>this.inflight=null);return this.inflight;
 }
 async discoverMore(){this.capabilities=await Promise.all((this.config.capabilities||[]).map(async s=>{const c={...s,wired:true,ready:false};try{await readJson(await this.fetch(c.baseUrl+(c.healthPath||'/health'),{signal:AbortSignal.timeout(10000),redirect:'error'}));c.ready=true;}catch(e){c.error=e.message;}return c;}));}
 connection(){const s=this.get('chat');return {provider:'qwen',baseUrl:s.baseUrl,modelName:s.model,label:s.label,apiKey:this.key(s),analysisMode:s.analysisMode||'structured-json',inference:s.inference||{}};}
 status(){return {mode:this.mode,catalogUrl:null,services:this.services,capabilities:this.capabilities,error:this.error,lastCheckedAt:this.lastCheckedAt,publicCloudEnabled:false,localModelsEnabled:false,searchEnabled:false,privacy:'只访问部署配置明确列出的服务；不自动调用公司默认地址或回退到其他模型。'};}
}
