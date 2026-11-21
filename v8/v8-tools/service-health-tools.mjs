import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CATALOG_URL,SERVICE_IDS,validateServiceUrl,readJson} from '../intranet.mjs';
export class ServiceHealthTools {
 constructor(docs,{chat,vision,asr={},fetchImpl=fetch}={}){this.docs=docs;this.chat=chat;this.vision=vision;this.asr=asr;this.fetch=fetchImpl;}
 modelRoute(config){const u=new URL(config.baseUrl);validateServiceUrl(u.origin);if(u.username||u.password||u.search||u.hash||!['/','/v1','/v1/'].includes(u.pathname))throw Error('只允许主机配置的固定内网模型接口');return config.baseUrl.replace(/\/$/,'')+'/models';}
 async inspect(signal){
  const checks=[],requestId=randomUUID(),checkedAt=new Date().toISOString();
  const clean=value=>{let raw=JSON.stringify(value);for(const key of [this.chat?.apiKey,this.vision?.apiKey,this.asr.apiKey].filter(Boolean))raw=raw.split(key).join('[REDACTED]');return JSON.parse(raw.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]'),(key,value)=>/^(api[_-]?key|authorization|access[_-]?token|password|secret)$/i.test(key)?'[REDACTED]':value);};
  const probe=async(service,url,expectedModel,apiKey)=>{
   const started=Date.now(),record={service,url,method:'GET',checkedAt:new Date().toISOString(),ready:false};
   try{const r=await this.fetch(url,{method:'GET',redirect:'error',headers:apiKey?{Authorization:'Bearer '+apiKey}:{},signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(8000)])});record.httpStatus=r.status;const payload=clean(await readJson(r,512*1024));record.payload=payload;record.observedModels=(payload.data||[]).map(m=>m.id).filter(Boolean);record.ready=service==='asr'?payload.status==='ready'&&!!payload.id:service==='catalog'?Array.isArray(payload.items):record.observedModels.includes(expectedModel);if(!record.ready)record.error='接口已返回，但未确认配置的服务/模型就绪';}catch(e){record.error=e.message;}record.elapsedMs=Date.now()-started;checks.push(record);return record;
  };
  for(const [name,config] of [['chat',this.chat],['vision',this.vision]]){if(!config?.baseUrl){checks.push({service:name,ready:false,error:'主机未配置该服务'});continue;}try{await probe(name,this.modelRoute(config),config.model,config.apiKey);}catch(e){checks.push({service:name,ready:false,error:e.message});}}
  if(this.asr.baseUrl){try{await probe('asr',validateServiceUrl(this.asr.baseUrl)+'/health/ready');}catch(e){checks.push({service:'asr',ready:false,error:e.message});}}
  else{const catalog=await probe('catalog',CATALOG_URL+'/services');if(catalog.ready){const item=catalog.payload.items.find(i=>i.id===SERVICE_IDS.asr);try{if(!item?.selected_base_url||item.auth&&item.auth!=='none')throw Error('目录未提供授权ASR接口');await probe('asr',validateServiceUrl(item.selected_base_url)+'/health/ready');}catch(e){checks.push({service:'asr',ready:false,error:e.message});}}}
  const safeChecks=clean(checks),folder=path.join(this.docs.directory,'service-health');fs.mkdirSync(folder,{recursive:true});const receipt=path.join(folder,requestId+'.json');fs.writeFileSync(receipt,JSON.stringify({requestId,checkedAt,checks:safeChecks},null,2));
  return {requestId,checkedAt,checks:safeChecks.map(({payload,...c})=>({...c,...(payload?.id?{activeModel:payload.id}:{}),...(payload?.status?{healthStatus:payload.status}:{}),...(Array.isArray(payload?.items)?{catalogServiceCount:payload.items.length}:{})})),receipt,readOnly:true,modelsReady:['chat','vision','asr'].every(name=>safeChecks.some(c=>c.service===name&&c.ready)),gpuMetrics:null,diskMetrics:null,note:'仅对主机配置/固定目录服务进行GET探测；未重启服务，未读取GPU或磁盘利用率。HTTP可达和ready不证明模型输出质量。'};
 }
 tools(){return [{name:'inspect_intranet_services',description:'Read-only live checks of the host-configured intranet chat/vision models and registered ASR readiness. Uses fixed approved endpoints, saves actual timestamp/HTTP/latency receipts; no arbitrary URL, restart, shell, GPU or disk metrics.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},execute:(a,c)=>this.inspect(c.signal)}];}
}
