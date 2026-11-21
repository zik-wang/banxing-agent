import {id,now} from '../runtime/core.mjs';
import {organizationView} from '../workspace/organization.mjs';
const defaults={enabled:false,jobEvents:true,reviewQueue:true,dailyBrief:true,dailyTime:'09:00',quietStart:22,quietEnd:8};
export class Proactive{
 constructor(store){this.store=store;store.state.proactive||={settings:{...defaults},seen:[],checks:[],baselineAt:now()};this.data=store.state.proactive;this.data.settings={...defaults,...this.data.settings};store.save();}
 configure(input){const s=input.settings;if(!s||['enabled','jobEvents','reviewQueue','dailyBrief'].some(k=>typeof s[k]!=='boolean')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyTime)||![s.quietStart,s.quietEnd].every(n=>Number.isInteger(n)&&n>=0&&n<24)||s.quietStart===s.quietEnd)throw Error('请填写有效的推送开关、时间和免打扰时段');const was=this.data.settings.enabled;this.data.settings={...defaults,...Object.fromEntries(Object.keys(defaults).map(k=>[k,s[k]]))};if(!was&&s.enabled)this.data.baselineAt=now();this.store.save();return this.data;}
 check(date=new Date(),{preview=false}={}){
  const s=this.data.settings,parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date),day=parts.slice(0,10),clock=parts.slice(11,16),hour=Number(clock.slice(0,2));
  const quiet=s.quietStart<s.quietEnd?hour>=s.quietStart&&hour<s.quietEnd:hour>=s.quietStart||hour<s.quietEnd;
  if(!preview&&(!s.enabled||quiet))return {sent:0,reason:!s.enabled?'已暂停':'免打扰中'};
  const candidates=[];
  if(s.jobEvents)for(const c of this.store.state.conversations||[])for(const item of organizationView(this.store,c.id,date))if(item.risks.length)candidates.push({key:`org:${c.id}:${item.key}:${item.revision}:${item.risks.join(',')}`,title:'组织事项需要关注',body:`${item.project} / ${item.title}：${item.risks.join('、')}；负责人：${item.owner||'待明确'}。依据：${item.history.at(-1).source.name}。`,target:{page:'chat',conversationId:c.id}});
  if(s.jobEvents)for(const j of this.store.state.jobs||[])if(['completed','partial','failed','interrupted','awaiting_approval','waiting_input','cancelled'].includes(j.status)&&Date.parse(j.finishedAt||j.createdAt)>=Date.parse(this.data.baselineAt))candidates.push({key:'job:'+j.id+':'+j.status,title:'交办有新进展',body:j.title+' · '+({completed:'已完成',partial:'部分完成',failed:'失败',interrupted:'中断',awaiting_approval:'待确认行动',waiting_input:'待补充',cancelled:'已取消'}[j.status]),target:{page:'workbench',jobId:j.id}});
  if(s.reviewQueue)for(const f of this.store.state.workspaceFiles||[])if(f.recognition&&!f.recognition.confirmedAt)candidates.push({key:'review:'+f.id+':'+f.recognition.draftHash,title:'材料还在等你核对',body:f.name+'：识别稿尚未确认，请对照原件核对。',target:{page:'workbench'}});
  if(s.dailyBrief&&(preview||clock>=s.dailyTime)){const tasks=this.store.state.tasks.filter(t=>!t.done),today=tasks.filter(t=>t.dueAt&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(t.dueAt))===day),overdue=tasks.filter(t=>t.dueAt&&Date.parse(t.dueAt)<date.getTime());if(tasks.length)candidates.push({key:'daily:'+day,title:'今日事项摘要',body:`未完成${tasks.length}项，今天到期${today.length}项，已过期${overdue.length}项。`+tasks.slice(0,3).map(t=>t.title).join('；'),target:{page:'tasks'}});}
  if(preview)return {preview:true,candidates,reason:candidates.length?'这是预览，不会发送或修改去重记录':'当前没有需要推送的事项'};
  const todayCount=this.store.state.notifications.filter(n=>n.kind==='proactive'&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(n.createdAt))===day).length;
  let sent=0;for(const c of candidates){if(sent>=3||todayCount+sent>=5)break;if(this.data.seen.includes(c.key))continue;this.data.seen.push(c.key);this.store.state.notifications.unshift({id:id(),kind:'proactive',title:c.title,body:c.body,target:c.target,createdAt:date.toISOString(),read:false});sent++;}
  this.data.seen=this.data.seen.slice(-2000);this.data.checks.unshift({at:date.toISOString(),sent,reason:sent?'产生新推送':todayCount>=5&&candidates.some(c=>!this.data.seen.includes(c.key))?'已达每日5条上限，等待后续检查':'没有新变化，保持安静'});this.data.checks=this.data.checks.slice(0,40);this.store.save();return {sent,reason:this.data.checks[0].reason};
 }
}
