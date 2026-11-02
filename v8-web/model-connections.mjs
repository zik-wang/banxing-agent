import fs from 'node:fs';
import path from 'node:path';
import {atomic} from '../v8-tools/resource-space.mjs';
import {apiKeyFor} from '../v8-tools/provider-config.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clone=x=>structuredClone(x);
export function validateIntranet(chat,{allowMissingModel=false}={}){
 const u=new URL(chat.baseUrl);const octets=u.hostname.split('.').map(Number);
 if(!['http:','https:'].includes(u.protocol)||octets.length!==4||octets[0]!==10||octets.some(n=>!Number.isInteger(n)||n<0||n>255)||u.username||u.password||u.search||u.hash||!/^\/v1\/?$/.test(u.pathname))fail('公司接口须为10网段的HTTP(S)地址，以/v1结尾');
 if((typeof chat.model!=='string'||!chat.model.trim()||chat.model.length>160)&&!(allowMissingModel&&(chat.model===undefined||chat.model==='')))fail('请填写实际模型标识');
 if(u.port&&Number(u.port)<1)fail('端口须为1至65535');
 return {...chat,provider:'intranet',baseUrl:u.href.replace(/\/$/,''),model:chat.model?.trim()||''};
}
export class ModelConnections{
 constructor(config,workspace){
  this.config=config;this.w=workspace;this.file=path.join(workspace.root,'settings','model-connections.private.json');fs.mkdirSync(path.dirname(this.file),{recursive:true});
  if(fs.existsSync(this.file))this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));
  else {const pick=c=>Object.fromEntries(['chat','asr','vision','ocr'].filter(k=>c[k]!==undefined).map(k=>[k,clone(c[k])]));
   this.state={schemaVersion:1,revision:1,active:config.initialModelMode||(config.chat.provider==='intranet'?'intranet':'cloud'),profiles:{intranet:{...pick(config.connectionProfiles?.intranet||{}),chat:validateIntranet(config.connectionProfiles?.intranet?.chat||(config.chat.provider==='intranet'?config.chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'qwen3.8-27b-fp8',enableThinking:false,timeoutMs:180000}),{allowMissingModel:true})},...(config.chat.provider==='iteracompute'?{cloud:pick(config)}:config.connectionProfiles?.cloud?{cloud:pick(config.connectionProfiles.cloud)}:{})}};atomic(this.file,this.state);}
  if(this.state.schemaVersion!==1)fail('模型连接配置版本无效');this.apply();
 }
 apply(){const p=this.state.profiles[this.state.active];if(!p)fail('该连接尚未由维护者配置');if(this.state.active==='intranet')validateIntranet(p.chat,{allowMissingModel:true});else if(p.chat.provider!=='iteracompute'||p.chat.baseUrl!=='https://api.iteracompute.com/v1')fail('公网仅允许已有授权服务');
  for(const k of ['chat','asr','vision','ocr']){if(p[k]!==undefined)this.config[k]=clone(p[k]);else delete this.config[k];}
  this.config.externalWorkspace=this.state.active==='cloud';this.w.managed.classification=this.config.externalWorkspace?'external_authorized':'private';
  this.w.space.tx(s=>{s.projects[this.w.workspaceId].workspace.name='个人工作空间';});
 }
 view(){return {active:this.state.active,revision:this.state.revision,profiles:Object.fromEntries(Object.entries(this.state.profiles).map(([k,p])=>[k,{provider:p.chat.provider,baseUrl:p.chat.baseUrl,model:p.chat.model}])),contractLocalEnabled:this.config.contractReview?.localReview?.enabled===true};}
 busy(){return this.w.jobs.size||this.w.flow?.pending().length||[...this.w.activeUploads?.values()||[]].some(Boolean)||Object.values(this.w.state.conversations).some(c=>c.meetings?.some(m=>!m.reportTurnId&&!['failed','completed','cancelled','partial'].includes(m.state)));}
 update(body){if(this.busy())fail('任务或会议仍在处理中，请结束后再切换模型',409);if(body.expectedRevision!==this.state.revision)fail('连接配置已变化，请刷新重试',409);if(!['intranet','cloud'].includes(body.mode))fail('请选择公司内网或公网');
  const old=clone(this.state);try{if(body.intranet)this.state.profiles.intranet.chat=validateIntranet({...this.state.profiles.intranet.chat,baseUrl:body.intranet.baseUrl,model:body.intranet.model});if(!this.state.profiles[body.mode])fail('该公网服务尚未配置，请联系维护者');this.state.active=body.mode;this.state.revision++;this.state.updatedAt=new Date().toISOString();this.apply();atomic(this.file,this.state);return this.view();}catch(e){this.state=old;this.apply();throw e;}
 }
 async probe(body={},fetchImpl=fetch){const mode=body.mode||this.state.active;if(!['intranet','cloud'].includes(mode))fail('连接类型无效');let p=this.state.profiles[mode];if(!p)fail('该服务尚未配置');let chat=p.chat;if(mode==='intranet'&&body.intranet)chat=validateIntranet({...chat,...body.intranet});const started=Date.now();try{const r=await fetchImpl(chat.baseUrl+'/models',{signal:AbortSignal.timeout(5000),redirect:'error',headers:mode==='cloud'?{Authorization:'Bearer '+apiKeyFor(chat)}:{}});const j=await r.json();return {connected:r.ok,modelListed:!!j.data?.some(m=>m.id===chat.model),models:j.data?.map(m=>m.id)||[],status:r.status,elapsedMs:Date.now()-started,mode};}catch(e){return {connected:false,error:e.name==='TimeoutError'?'连接超时':e.message,elapsedMs:Date.now()-started,mode};}}
 markInternal(selected,current){if(this.config.externalWorkspace)return;const state=this.w.space.load(),ids=new Set(this.state.internalResources||[]),seen=new Set();const visit=ref=>{if(!ref||seen.has(ref.resourceId))return;seen.add(ref.resourceId);const v=state.resources[ref.resourceId]?.revisions[ref.revisionId];if(!v)return;if(!['public','synthetic'].includes(v.metadata.classification))ids.add(ref.resourceId);for(const p of v.parents||[])visit(p);};for(const r of [...selected,...(current?[current]:[])])visit(r);this.state.internalResources=[...ids];atomic(this.file,this.state);}
 privateRefs(){if(!this.config.externalWorkspace)return [];const state=this.w.space.load(),refs=[],blocked=new Set(this.state.internalResources||[]);for(const [id,r]of Object.entries(state.resources)){if(r.kind==='original'&&Object.values(r.revisions).some(v=>!['external_authorized','public','synthetic'].includes(v.metadata.classification)))blocked.add(id);}let changed=true;while(changed){changed=false;for(const [id,r]of Object.entries(state.resources))if(!blocked.has(id)&&Object.values(r.revisions).some(v=>v.parents?.some(p=>blocked.has(p.resourceId)))){blocked.add(id);changed=true;}}
  for(const id of blocked)if(state.resources[id])for(const revisionId of Object.keys(state.resources[id].revisions))refs.push({resourceId:id,revisionId});return refs;
 }
 guard(c,selected,current,request){if(!this.config.chat.model)fail('请先在模型连接中填写实际模型标识');if(!this.config.externalWorkspace)return;const privateIds=new Set(this.privateRefs().map(r=>r.resourceId));if(selected.some(r=>privateIds.has(r.resourceId))||current&&privateIds.has(current.resourceId)||c.networkOrigin==='intranet'&&c.turns.some(t=>!t.hostControl))fail('此对话包含内网材料或内网上下文，未发送公网。请切回内网；公网任务请新建对话并选择已授权材料。',409);}
}
