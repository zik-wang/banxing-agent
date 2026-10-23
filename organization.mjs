import {createHash} from 'node:crypto';
import {readOriginal} from './workspace-files.mjs';
import {id,now,text} from './core.mjs';

const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const STATES={in_progress:'进行中',blocked:'受阻',done:'已完成'};
const fingerprint=e=>digest({conversationId:e.conversationId,kind:e.kind,key:e.key,project:e.project,title:e.title,owner:e.owner,dueDate:e.dueDate,status:e.status,source:{sha256:e.source.sha256,quote:e.source.quote}});
export function organizationView(store,conversationId,date=new Date()){
 const events=(store.state.organizationEvents||[]).filter(e=>e.conversationId===conversationId),items=new Map();
 for(const e of events){let item=items.get(e.key);
  if(e.kind==='commitment'){
   if(!item){item={key:e.key,project:e.project,title:e.title,owner:e.owner,dueDate:e.dueDate,status:'open',history:[],conflicts:[],revision:0};items.set(e.key,item);}
   else if(['project','title','owner','dueDate'].some(k=>item[k]!==e[k]))item.conflicts.push({eventId:e.id,reason:'同一事项存在不同承诺，未覆盖原责任人或期限'});
  }else if(item){if(item.status==='done'&&e.status!=='done')item.conflicts.push({eventId:e.id,reason:'完成后出现未完成记录，需核对是否重开或记录过时'});else item.status=e.status;}
  if(item){item.history.push(e);item.revision++;}
 }
 return [...items.values()].map(i=>({...i,risks:[...(i.conflicts.length?['记录冲突']:[]),...(i.status==='blocked'?['进展受阻']:[]),...(i.status!=='done'&&!i.owner?['缺少责任人']:[]),...(i.status!=='done'&&!i.dueDate?['缺少期限']:[]),...(i.status!=='done'&&i.dueDate&&Date.parse(i.dueDate+'T23:59:59.999+08:00')<date.getTime()?['已逾期']:[])]}));
}
export function recordOrganizationEvents(store,conversationId,sources,input){
 if(!Array.isArray(input)||!input.length||input.length>50)throw Error('每次记录1至50项组织事件');
 const files=sources.map(s=>{const f=store.state.workspaceFiles.find(f=>f.id===s.id);if(!f||f.sha256!==s.sha256)throw Error('组织事实附件越权或已变化');return f;});
 const pending=[],existing=store.state.organizationEvents||[];
 for(const raw of input){
  if(!raw||!['commitment','progress'].includes(raw.kind))throw Error('未知组织事件类型');
  const matches=files.filter(f=>f.name===raw.sourceName);if(matches.length!==1)throw Error('来源文件必须属于本次附件且名称唯一');const f=matches[0];readOriginal(store,f);
  if(f.parseStatus!=='ready'||f.truncated||f.recognition&&!f.recognition.confirmedAt)throw Error('组织事实需要完整解析并已核对的材料');
  const quote=text(raw.quote,2000);if(quote.length<4||!f.content.includes(quote))throw Error('组织事实缺少逐字原文依据');
  const e={kind:raw.kind,key:text(raw.key,120),source:{fileId:f.id,name:f.name,sha256:f.sha256,line:f.content.slice(0,f.content.indexOf(quote)).split('\n').length,quote}};
  if(raw.kind==='commitment'){
   for(const field of ['project','title','owner','dueDate']){const value=raw[field]??'';if(typeof value!=='string'||value.length>160||value&&!quote.includes(value))throw Error('项目、行动、负责人或期限没有逐字来源');e[field]=value.trim();}
   if(!e.project||!e.title)throw Error('请明确项目和行动标题');
   if(e.dueDate&&(!DATE.test(e.dueDate)||!Number.isFinite(Date.parse(e.dueDate+'T00:00:00Z'))||new Date(e.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==e.dueDate))throw Error('截止日期须为真实YYYY-MM-DD日期，不猜相对时间');
  }else{
   const prior=[...existing,...pending].find(e=>e.conversationId===conversationId&&e.key===raw.key&&e.kind==='commitment');if(!prior)throw Error('进展必须关联当前对话已有承诺');
   if(!STATES[raw.status]||!quote.includes(STATES[raw.status])||!quote.includes(prior.title)||!quote.includes(prior.project))throw Error('进展原文需明确对应项目、行动和状态');e.status=raw.status;
  }
  e.conversationId=conversationId;e.fingerprint=fingerprint(e);
  if(![...existing,...pending].some(p=>fingerprint(p)===e.fingerprint))pending.push({...e,id:id(),recordedAt:now()});
 }
 if(existing.length+pending.length>5000)throw Error('本地组织事件已达5000条，请先导出整理');
 store.state.organizationEvents=[...existing,...pending];store.save();return {recorded:pending.length,duplicates:input.length-pending.length,items:organizationView(store,conversationId)};
}
export function organizationSummary(store,conversationId,{risksOnly=false,date=new Date()}={}){
 const all=organizationView(store,conversationId,date),items=all.filter(i=>!risksOnly||i.risks.length),shown=items.slice(0,15);
 return (all.length?`本对话已记录${all.length}项组织承诺，${all.filter(i=>i.risks.length).length}项需要关注。`:'本对话还没有组织承诺记录。')+'\n\n'+shown.map(i=>`- ${i.project} / ${i.title}：${STATES[i.status]||'待推进'}；负责人：${i.owner||'待明确'}；期限：${i.dueDate||'待明确'}${i.risks.length?'；关注：'+i.risks.join('、'):''}\n  承诺依据：${i.history[0].source.name} 第${i.history[0].source.line}行：“${i.history[0].source.quote}”${i.history.length>1?"\n  最新记录："+i.history.at(-1).source.name+" 第"+i.history.at(-1).source.line+"行：“"+i.history.at(-1).source.quote+"”":""}${i.conflicts.length?"\n  冲突说明："+i.conflicts.map(c=>c.reason).join("；"):""}`).join('\n\n')+(items.length>15?'\n\n仅展示前15项。':'')+'\n\n依据为已提供材料，不代表已向责任人核实。范围是当前对话；不会自动发邮件或修改他人系统。';
}
export function organizationChat(store,conversationId,message,files=[]){
 const query=message.trim().replace(/[。！？?!]+$/u,'');
 if(!files.length&&['组织进展','查看组织进展','组织风险','查看组织风险'].includes(query))return {answer:organizationSummary(store,conversationId,{risksOnly:query.includes('风险')}),jobIds:[]};
 if(query!=='记录组织事项')return null;
 const manifests=files.filter(f=>f.extension==='.json');if(manifests.length!==1)throw Error('请同时上传一份组织事项JSON清单及其引用的原始材料');const f=manifests[0];readOriginal(store,f);let manifest;try{manifest=JSON.parse(f.content);}catch{throw Error('组织事项清单不是有效JSON');}
 if(f.parseStatus!=='ready'||f.truncated||f.recognition&&!f.recognition.confirmedAt)throw Error('组织事项清单需要完整解析并核对');
 if(manifest?.schema!=='org-memory/v1')throw Error('组织事项清单schema须为org-memory/v1');
 const result=recordOrganizationEvents(store,conversationId,files.map(f=>({id:f.id,sha256:f.sha256})),manifest.events);
 return {answer:`已记录${result.recorded}条组织事件，跳过${result.duplicates}条重复记录。\n\n`+organizationSummary(store,conversationId),jobIds:[],mutation:true};
}
