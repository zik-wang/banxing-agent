import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {digest,atomic} from './resource-space.mjs';import {ToolError} from './harness.mjs';
const worker=fileURLToPath(new URL('./material_diagnostics.py',import.meta.url)),version=digest(fs.readFileSync(worker));
export class MaterialDiagnostics {
 constructor(docs,config){this.docs=docs;this.config=config;this.directory=config.materialDiagnosticsRoot||path.join(config.continuity?path.dirname(config.continuity.spaceRoot):docs.directory,'material-diagnostics');fs.mkdirSync(this.directory,{recursive:true});this.records=new Map();docs.materialDiagnostics=this;}
 async check(a,signal){
  if(!['workbook','word','pdf'].includes(a.kind))return null;
  this.docs.asset(a.id);
  const key=digest({sha256:a.sha256,expected:a.kind,version}),file=path.join(this.directory,key+'.json');let record,cacheHit=false;
  if(fs.existsSync(file)){record=JSON.parse(fs.readFileSync(file,'utf8'));cacheHit=true;}
  else {record=await new Promise(resolve=>{const child=spawn(this.docs.python,[worker],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},signal});let out='',done=false;const end=r=>{if(done)return;done=true;clearTimeout(timer);resolve(r);},timer=setTimeout(()=>{child.kill();end({state:'probe_unavailable',blocked:false,detail:'PROBE_TIMEOUT'});},20000);child.stdout.on('data',b=>out+=b);child.stderr.resume();child.on('error',()=>end({state:'probe_unavailable',blocked:false,detail:'PROBE_PROCESS_UNAVAILABLE'}));child.on('close',()=>{try{end(JSON.parse(out));}catch{end({state:'probe_unavailable',blocked:false,detail:'PROBE_INVALID_RESPONSE'});}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({path:a.path}));});if(record.state!=='probe_unavailable')atomic(file,{...record,sourceSha256:a.sha256,version,checkedAt:new Date().toISOString()});}
  const action=record.state==='password_required'?'请提供获授权的密码或未加密副本；当前没有尝试破解密码。':record.state==='extension_mismatch'?'实际内容与扩展名不符，请从原软件重新另存为正确格式后上传；可提供可靠的CSV副本。':record.state==='legacy_office'?'这可能是旧版Office文件，请用Excel/WPS打开并另存为.xlsx，或提供可靠的CSV副本。':'请用Excel/WPS或原软件打开后另存为有效的'+(a.kind==='workbook'?'.xlsx':a.kind==='word'?'.docx':'.pdf')+'并重新上传；表格也可提供可靠的CSV副本。';
  const r={...record,sourceSha256:a.sha256,sourceRef:a.resourceRef||null,sourceName:a.name,cacheHit,action:record.blocked?action:null};this.records.set(a.sha256,r);fs.writeFileSync(path.join(this.docs.directory,'material-diagnostics.json'),JSON.stringify([...this.records.values()],null,2));return r;
 }
 async require(a,signal){const r=await this.check(a,signal);if(r?.blocked)throw new ToolError('MATERIAL_INPUT_UNREADABLE',this.message([r]),{diagnostic:r,retrySameBytes:false});return r;}
 message(records){return records.map(r=>'“'+r.sourceName+'”'+({password_required:'需要密码或未加密副本',extension_mismatch:'的实际内容与扩展名不符',legacy_office:'不是当前支持的新版Office文件',expansion_limit:'展开后的体积超过安全读取范围',corrupt_container:'的容器结构或校验已损坏',invalid_container:'不是有效的Office/PDF结构，可能未完整保存或文件类型不符',invalid_pdf:'不是可读取的PDF结构',unreadable_office_structure:'的Office内部结构目前无法解析'}[r.state]||'目前无法读取')+'。'+r.action).join('\n\n')+'\n原材料、已交付文件和执行记录均保留；不会对同一版本重复尝试其他不适用工具。';}
 async preflight(){
  if(this.docs.turnIntent.kind==='existing_file')return null;
  const assets=[...this.docs.assets.values()].filter(a=>!a.parentId);if(!assets.length)return null;
  const records=(await Promise.all(assets.map(a=>this.check(a)))).filter(Boolean),blocked=records.filter(r=>r.blocked);if(!blocked.length||blocked.length!==assets.length)return null;
  const followup=/怎么办|怎么(?:弄|处理|解决)|不行的话|如何(?:处理|修复)/u.test(this.docs.request),message=this.message(blocked);
  return followup?{completed:true,message,diagnostics:blocked,answerOrigin:'saved_material_diagnostic'}:{failed:true,message,diagnostics:blocked,reason:'material_input_unreadable'};
 }
 observe(result){const d=result.error?.details?.diagnostic;return result.error?.code==='MATERIAL_INPUT_UNREADABLE'&&d?{failed:true,message:this.message([d]),diagnostics:[d],reason:'material_input_unreadable'}:null;}
 wrap(tools){return tools.map(t=>({...t,execute:async(a,c)=>{if(a?.asset_id)await this.require(this.docs.asset(a.asset_id),c?.signal);return t.execute(a,c);}}));}
}
