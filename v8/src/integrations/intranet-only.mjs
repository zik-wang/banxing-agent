import {ServiceDirectory, validateServiceUrl, readJson} from './intranet.mjs';
import {inferenceProfile} from './inference-config.mjs';

// No LocalMediaRuntime is constructed. An unavailable service fails closed.
export class IntranetOnlyDirectory extends ServiceDirectory {
 constructor(config,{fetchImpl=fetch}={}) {
  super(fetchImpl);
  const c=structuredClone(config),url=new URL(c.chat?.baseUrl);
  if(c.version!=='v7-intranet-all-1'||c.chat.provider!=='intranet'||c.chat.auth?.type!=='none'||c.local||url.pathname.replace(/\/$/,'')!=='/v1'||url.username||url.password||url.search||url.hash)throw Error('全内网部署配置无效');
  validateServiceUrl(url.origin);
  if(typeof c.chat.model!=='string'||!c.chat.model.trim()||!['native-tools','structured-json'].includes(c.chat.analysisMode))throw Error('需要明确内网模型与调用模式');
  inferenceProfile({provider:'qwen',modelName:c.chat.model,baseUrl:c.chat.baseUrl,analysisMode:c.chat.analysisMode,inference:c.chat.inference});
  this.config=c;this.intranetOnly=true;this.mode='intranet-only';
 }
 async refresh(){
  await super.refresh();
  const c=this.config.chat,chat={name:'公司内网27B',label:'内网 Qwen 27B',baseUrl:c.baseUrl.replace(/\/v1\/?$/,''),model:c.model,analysisMode:c.analysisMode,inference:c.inference||{},transport:'intranet-api',ready:false};
  this.services.chat=chat;
  try{const r=await readJson(await this.fetch(c.baseUrl.replace(/\/$/,'')+'/models',{signal:AbortSignal.timeout(15000),redirect:'error'}));if(!r.data?.some(m=>m.id===c.model))throw Error('内网未返回配置的真实模型');chat.ready=true;}catch(error){chat.error=String(error.message);}
 }
 connection(){const s=this.get('chat');return {provider:'qwen',baseUrl:s.baseUrl+'/v1',modelName:s.model,label:s.label,analysisMode:s.analysisMode,inference:s.inference,apiKey:'local-keyless'};}
 status(){return {...super.status(),mode:this.mode,intranetOnly:true,localInferenceEnabled:false,publicCloudEnabled:false,privacy:'文字模型、ASR、OCR及已接入视觉能力仅调用公司内网；不启动本机模型，不回退公网。'};}
}

// Keep the independently maintained 09 implementation intact, while preventing
// its dedicated local/cloud override from bypassing the selected deployment.
export function deploymentInvoiceOptions(directory,{factory,status}){
 return directory.intranetOnly?{invoiceRuntimeFactory:()=>null,invoiceRuntimeStatus:()=>({configured:false,disabledForDeployment:true,reason:'全内网模式使用共享内网链路；09专用本地/公网运行覆盖未启用。'})}:{invoiceRuntimeFactory:factory,invoiceRuntimeStatus:status};
}
