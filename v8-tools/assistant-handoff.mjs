import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {digest} from './resource-space.mjs';
export class AssistantHandoffTools{
 constructor(config,continuity,canHandoff){this.config=config;this.c=continuity;this.canHandoff=canHandoff;}
 tools(){const p=this.config.assistantRouting;if(!p||p.phase!=='offer'||!this.c)return [];return [{name:'request_assistant_handoff',description:'If this task is better handled by an enabled colleague, request one host-controlled handoff. Colleague performs the original user task; you subsequently check its result. Only before business writes. No permission expansion, no recursive delegation. Colleagues: '+JSON.stringify(p.bots),inputSchema:{type:'object',properties:{bot_id:{type:'string',enum:p.bots.map(b=>b.id)},reason:{type:'string',minLength:4,maxLength:800},review_focus:{type:'string',minLength:4,maxLength:1200}},required:['bot_id','reason','review_focus'],additionalProperties:false},execute:async a=>{
  if(!this.canHandoff()||a.bot_id===p.sourceBotId||!p.bots.some(b=>b.id===a.bot_id))throw Error('HANDOFF_NOT_ALLOWED_AFTER_WRITES_OR_TO_SELF');
  const file=path.join(this.config.directory,'assistant-handoff.json');if(fs.existsSync(file))throw Error('HANDOFF_ALREADY_REQUESTED');
  const receipt={id:randomUUID(),sourceTurnId:this.config.continuity.interactionId,sourceBotId:p.sourceBotId,targetBotId:a.bot_id,reason:a.reason,reviewFocus:a.review_focus,requestHash:digest(this.config.request),refs:this.c.selected,projectId:this.c.projectId,createdAt:new Date().toISOString()};
  fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});return {hostHandoff:true,receiptId:receipt.id,note:'已请求转交，宿主验证后安排同事处理并由原助理核对；尚未完成用户任务。'};
 }}];}
}
