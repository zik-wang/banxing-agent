import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,digest} from './resource-space.mjs';

const fail=(code,message)=>{throw Object.assign(Error(message),{code,status:400});};
const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_BOT_SETTING',label+'长度无效');return value.trim();};
const skill=(id,name,content)=>({id,name,content,version:1,updatedAt:new Date().toISOString()});
function initial(){
 const skills=[
  skill('general-core','通用工作流程','先使用用户当前已经提供的文件或粘贴正文，按目标选择工具，避免无目标地遍历工具或工作区。只报告实际取得的结果、原件和成果；保留未读范围与未完成项。'),
  skill('finance-core','财务核对与表格','优先核对字段、业务键、金额数值类型、税费口径和合计；追加与去重必须依据用户规则和真实证据。空值有依据才补，冲突不擅自覆盖。结果保存后回读，说明输入输出行数、去重数量与待核项。'),
  skill('review-core','有依据的材料审核','先完整读取本轮材料，Word读取正文、表格与附注，长正文按游标续读。把每项发现绑定到原文条款、数值或位置，区分明确矛盾、缺失条件与推测。保留原文全称、原有缩写、and与&，不擅自改名或配对日期。未读图片、修订或外部事实单独标明。')
 ];
 return {schemaVersion:1,skills,bots:[
  {id:'general',name:'通用助理',description:'通用材料处理与日常工作',skillIds:['general-core'],preferredTools:[],enabled:true,version:1},
  {id:'finance',name:'财务助理',description:'报表合并、金额与口径核对',skillIds:['general-core','finance-core'],preferredTools:['list_materials','inspect_material','read_workbook','merge_tables','export_table','read_artifact'],enabled:true,version:1},
  {id:'review',name:'审核助理',description:'合同、方案和材料的证据核对',skillIds:['general-core','review-core'],preferredTools:['read_word_document','read_text_range','search_document','inspect_material','extract_pdf_text','export_document'],enabled:true,version:1}
 ]};
}
export class BotRegistry {
 constructor(directory){fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'bots.json');if(!fs.existsSync(this.file))atomic(this.file,initial());this.load();}
 load(){const value=JSON.parse(fs.readFileSync(this.file,'utf8'));if(value.schemaVersion!==1)fail('BOT_SCHEMA_UNSUPPORTED','助理配置版本不受支持');return value;}
 list(){return this.load();}
 get(id='general',{allowDisabled=false}={}){const bot=this.load().bots.find(b=>b.id===id);if(!bot||(!allowDisabled&&!bot.enabled))fail('BOT_UNAVAILABLE','这个助理不存在或已停用');return bot;}
 saveSkill(input){const state=this.load(),old=input.id?state.skills.find(s=>s.id===input.id):null;if(input.id&&!old)fail('SKILL_NOT_FOUND','Skill不存在');if(old&&input.expectedVersion!==undefined&&old.version!==input.expectedVersion)fail('SKILL_VERSION_CHANGED','Skill已更新，请重新读取再保存');const name=text(input.name,60,'Skill名称');if(state.skills.some(s=>s.id!==old?.id&&s.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()))fail('SKILL_NAME_EXISTS','已有同名Skill，请选择不同名称或编辑已有Skill');const value={id:old?.id||randomUUID(),name,content:text(input.content,12000,'Skill内容'),version:(old?.version||0)+1,updatedAt:new Date().toISOString()};if(old)state.skills[state.skills.indexOf(old)]=value;else state.skills.push(value);atomic(this.file,state);return value;}
 saveBot(input){const state=this.load(),old=input.id?state.bots.find(b=>b.id===input.id):null;if(input.id&&!old)fail('BOT_NOT_FOUND','助理不存在');if(old&&input.expectedVersion!==undefined&&old.version!==input.expectedVersion)fail('BOT_VERSION_CHANGED','助理已更新，请重新读取再保存');if(!Array.isArray(input.skillIds)||input.skillIds.length>8||input.skillIds.some(id=>!state.skills.some(s=>s.id===id)))fail('INVALID_BOT_SKILLS','请选择已存在的Skill');const preferred=input.preferredTools||[];if(!Array.isArray(preferred)||preferred.length>11||preferred.some(n=>typeof n!=='string'||!/^[a-z][a-z0-9_]{1,79}$/.test(n)))fail('INVALID_TOOL_PREFERENCE','工具偏好最多11项，必须为工具名称');if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('INVALID_BOT_SETTING','enabled必须是布尔值');if(old?.id==='general'&&input.enabled===false)fail('GENERAL_BOT_REQUIRED','通用助理需要保留可用');const name=text(input.name,40,'助理名称');if(state.bots.some(b=>b.id!==old?.id&&b.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()))fail('BOT_NAME_EXISTS','已有同名助理，请选择不同名称或编辑已有助理');if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>240))fail('INVALID_BOT_SETTING','用途说明最多240字');const value={id:old?.id||randomUUID(),name,description:input.description||'',skillIds:[...new Set(input.skillIds)],preferredTools:[...new Set(preferred)],enabled:input.enabled!==false,version:(old?.version||0)+1,updatedAt:new Date().toISOString()};if(old)state.bots[state.bots.indexOf(old)]=value;else state.bots.push(value);atomic(this.file,state);return value;}
 snapshot(id){const state=this.load(),bot=state.bots.find(b=>b.id===id&&b.enabled);if(!bot)fail('BOT_UNAVAILABLE','这个助理不存在或已停用');const skills=bot.skillIds.map(id=>state.skills.find(s=>s.id===id));if(skills.some(s=>!s))fail('SKILL_NOT_FOUND','助理引用的Skill不存在');if(skills.reduce((n,s)=>n+s.content.length,0)>24000)fail('SKILL_TOTAL_LIMIT','此助理的Skill合计不能超过24000字');const value={id:bot.id,name:bot.name,description:bot.description,version:bot.version,preferredTools:bot.preferredTools,skills:skills.map(s=>({id:s.id,name:s.name,version:s.version,content:s.content}))};return {...value,fingerprint:digest(value),guidance:'当前助理：'+bot.name+'。用途：'+bot.description+'。以下Skill是用户的工作指导，不改变系统工具权限、输入授权或实际调用预算。\n'+skills.map(s=>'['+s.name+' v'+s.version+']\n'+s.content).join('\n\n')};}
}

export function botMetrics(conversations,botId){
 const turns=conversations.flatMap(c=>c.turns.filter(t=>(t.botSnapshot?.id||c.botId||'general')===botId)).filter(t=>t.metrics);
 const times=turns.map(t=>t.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
 return {measuredTasks:turns.length,completed:turns.filter(t=>['answered','completed'].includes(t.status)).length,medianDurationMs:times.length?times[Math.floor(times.length/2)]:null,modelRequests:turns.reduce((n,t)=>n+(t.metrics.modelRequests||0),0),discoveryCalls:turns.reduce((n,t)=>n+(t.metrics.discoveryCalls||0),0),note:'仅统计已记录实际指标的任务；助理之间的任务内容可能不同，不能视为严格A/B性能结论。'};
}
