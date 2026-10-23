import {ServiceDirectory,validateServiceUrl,readJson} from './intranet.mjs';
import {inferenceProfile} from './inference-config.mjs';
export function validateAllIntranetConfig(value){
 const c=structuredClone(value);
 if(c.version!=='v7-intranet-all-1'||c.chat?.provider!=='intranet'||c.chat.baseUrl!=='http://10.0.0.32:8861/v1'||c.chat.model!=='qwen3.8-27b-fp8'||c.chat.auth?.type!=='none'||!['native-tools','structured-json'].includes(c.chat.analysisMode)||c.local)throw Error('全内网部署配置不符，禁止本地模型或云端回退');
 if(c.services?.ocr?.baseUrl!=='http://10.0.0.32:8010'||c.services?.asr?.baseUrl!=='http://10.0.0.32:6001')throw Error('内网媒体接口不符');
 for(const s of Object.values(c.services))validateServiceUrl(s.baseUrl);
 inferenceProfile({provider:'qwen',baseUrl:c.chat.baseUrl,modelName:c.chat.model,analysisMode:c.chat.analysisMode,inference:c.chat.inference});return c;
}
export class AllIntranetDirectory extends ServiceDirectory{
 constructor(config,{fetchImpl=fetch}={}){super(fetchImpl);this.config=validateAllIntranetConfig(config);this.mode='all-company-intranet';this.intranetOnly=true;}
 async refresh(){if(this.inflight)return this.inflight;this.inflight=(async()=>{
  const c=this.config,next={chat:{...c.chat,label:'内网 Qwen 27B',ready:false,transport:'intranet-http'},asr:{...c.services.asr,ready:false,transport:'intranet-http'},ocr:{...c.services.ocr,ready:false,transport:'intranet-http'}};
  await Promise.all(Object.entries(next).map(async([kind,s])=>{try{const result=await readJson(await this.fetch(s.baseUrl+(kind==='chat'?'/models':kind==='asr'?'/health/ready':'/health'),{signal:AbortSignal.timeout(15000),redirect:'error'}));if(kind==='chat'){if(!result.data?.some(m=>m.id===c.chat.model))throw Error('未返回指定内网27B');}else if(kind==='asr'){if(result.status!=='ready'||result.id!=='Qwen/Qwen3-ASR-1.7B')throw Error('内网ASR未就绪');s.model=result.id;}else{if(result.status!=='healthy')throw Error('内网OCR未就绪');s.model='MinerU-intranet';s.serviceVersion=result.version;s.weightsIdentity='not_exposed_by_health_endpoint';}s.ready=true;}catch(error){s.error=String(error.message);}}));
  this.services=next;this.error=Object.values(next).some(s=>!s.ready)?'部分公司内网能力不可用；不回退本地或云端':null;this.lastCheckedAt=new Date().toISOString();
 })().finally(()=>this.inflight=null);return this.inflight;}
 connection(){const s=this.get('chat');return {provider:'qwen',baseUrl:s.baseUrl,modelName:s.model,label:s.label,apiKey:'local-keyless',analysisMode:s.analysisMode,inference:s.inference};}
 status(){return {...super.status(),mode:this.mode,publicCloudEnabled:false,localModelsEnabled:false,privacy:'27B、OCR、ASR及视觉均仅调用公司内网服务；本机不加载推理模型，无云端或本地模型回退。'};}
}
