import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic} from './resource-space.mjs';
const fail=(code,message)=>{throw Object.assign(Error(message),{code,status:400});};
const iso=ms=>new Date(ms).toISOString();
export class ScheduledTasks {
 constructor(directory,{clock=()=>Date.now()}={}){fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'scheduled-tasks.json');this.lock=this.file+'.lock';this.clock=clock;if(!fs.existsSync(this.file))atomic(this.file,{schemaVersion:1,tasks:[],history:[]});this.load();}
 load(){const state=JSON.parse(fs.readFileSync(this.file,'utf8'));if(state.schemaVersion!==1)fail('SCHEDULE_SCHEMA_UNSUPPORTED','定时任务配置版本不受支持');return state;}
 tx(fn){let fd;for(let n=0;n<10;n++){try{fd=fs.openSync(this.lock,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;if(n===9)fail('SCHEDULE_BUSY','定时任务正在保存，请稍后重试');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(20*(n+1),100));}}try{const state=this.load(),result=fn(state);atomic(this.file,state);return result;}finally{fs.closeSync(fd);fs.unlinkSync(this.lock);}}
 list(){return this.load();}
 save(input){return this.tx(state=>{
  const old=input.id?state.tasks.find(t=>t.id===input.id):null;if(input.id&&!old)fail('SCHEDULE_NOT_FOUND','定时任务不存在');
  if(old&&input.expectedVersion!==undefined&&old.version!==input.expectedVersion)fail('SCHEDULE_VERSION_CHANGED','定时任务已更新，请重新读取后保存');
  for(const [key,max] of [['title',120],['prompt',6000]])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max)fail('SCHEDULE_INVALID_INPUT','请填写有效的提醒名称和内容');
  const interval=input.intervalMinutes===null||input.intervalMinutes===undefined?null:Number(input.intervalMinutes);
  if(interval!==null&&(!Number.isInteger(interval)||interval<1||interval>525600))fail('SCHEDULE_INVALID_INTERVAL','重复间隔需为1至525600分钟');
  const when=input.runAt?Date.parse(input.runAt):null;
  if(when!==null&&(!Number.isFinite(when)||!/(?:Z|[+-]\d\d:\d\d)$/.test(input.runAt)))fail('SCHEDULE_INVALID_TIME','执行时间需包含时区');
  if(!old&&when!==null&&when<=this.clock())fail('SCHEDULE_TIME_PAST','首次执行时间需在未来；已有提醒可用立即试运行');
  if(interval===null&&when===null)fail('SCHEDULE_TIME_REQUIRED','请选择一次执行时间或重复间隔');
  const mode=input.mode||'remind';if(!['remind','work'].includes(mode))fail('SCHEDULE_INVALID_MODE','执行方式无效');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('SCHEDULE_INVALID_ENABLED','启用状态无效');
  const inputRefs=input.inputRefs||[];if(!Array.isArray(inputRefs)||inputRefs.length>50||inputRefs.some(r=>typeof r?.resourceId!=='string'||typeof r?.revisionId!=='string'))fail('SCHEDULE_INVALID_SCOPE','材料引用无效');
  const sameTiming=old&&old.intervalMinutes===interval&&old.runAt===(when===null?null:iso(when));
  const value={id:old?.id||randomUUID(),title:input.title.trim(),prompt:input.prompt.trim(),mode,botId:input.botId||'general',intervalMinutes:interval,runAt:when===null?null:iso(when),nextRunAt:sameTiming?old.nextRunAt:when===null?iso(this.clock()+interval*60000):iso(when),inputRefs,enabled:input.enabled!==false,version:(old?.version||0)+1,createdAt:old?.createdAt||iso(this.clock()),updatedAt:iso(this.clock()),lastClaim:old?.lastClaim||null,lastResult:old?.lastResult||null};
  if(old)state.tasks[state.tasks.indexOf(old)]=value;else state.tasks.push(value);return value;
 });}
 setEnabled(id,enabled){if(typeof enabled!=='boolean')fail('SCHEDULE_INVALID_ENABLED','启用状态无效');return this.tx(s=>{const t=s.tasks.find(t=>t.id===id);if(!t)fail('SCHEDULE_NOT_FOUND','定时任务不存在');t.enabled=enabled;t.version++;t.updatedAt=iso(this.clock());return t;});}
 runNow(id){return this.tx(s=>{const t=s.tasks.find(t=>t.id===id);if(!t?.enabled)fail('SCHEDULE_DISABLED','请先启用这个定时任务');t.nextRunAt=iso(this.clock());t.version++;return t;});}
 claimDue(){const due=t=>t.enabled&&Date.parse(t.nextRunAt)<=this.clock()&&(!t.lastClaim||t.lastClaim.finishedAt||this.clock()-Date.parse(t.lastClaim.claimedAt)>60000);if(!this.load().tasks.some(due))return null;return this.tx(s=>{const now=this.clock(),t=s.tasks.filter(due).sort((a,b)=>a.nextRunAt.localeCompare(b.nextRunAt))[0];if(!t)return null;const key=t.id+'@'+t.nextRunAt;t.lastClaim={key,dueAt:t.nextRunAt,claimedAt:iso(now),taskVersion:t.version};let h=s.history.find(h=>h.key===key);if(!h){h={key,taskId:t.id,title:t.title,scheduledAt:t.nextRunAt,startedAt:iso(now),status:'dispatching'};s.history.push(h);}s.history=s.history.slice(-200);return {...structuredClone(t),executionKey:key};});}
 finish(task,result){return this.tx(s=>{const t=s.tasks.find(t=>t.id===task.id),h=s.history.find(h=>h.key===task.executionKey);if(h)Object.assign(h,result,{dispatchedAt:iso(this.clock())});if(!t||t.lastClaim?.key!==task.executionKey)return;Object.assign(t.lastClaim,{finishedAt:iso(this.clock())});t.lastResult={...result,at:iso(this.clock()),executionKey:task.executionKey};if(t.version===task.version&&t.nextRunAt===task.lastClaim.dueAt){if(t.intervalMinutes){const interval=t.intervalMinutes*60000,prior=Date.parse(t.nextRunAt),steps=Math.max(1,Math.floor((this.clock()-prior)/interval)+1);t.nextRunAt=iso(prior+steps*interval);}else t.enabled=false;}return t;});}
 markResult(key,result){return this.tx(s=>{const h=s.history.find(h=>h.key===key);if(h)Object.assign(h,result,{finishedAt:iso(this.clock())});const t=s.tasks.find(t=>t.lastResult?.executionKey===key);if(t)t.lastResult={...t.lastResult,...result,finishedAt:iso(this.clock())};});}
}
export class ScheduleEngine {
 constructor(store,{isBusy=()=>false,dispatch,reconcile=()=>{},intervalMs=5000}={}){this.store=store;this.isBusy=isBusy;this.dispatch=dispatch;this.reconcile=reconcile;this.intervalMs=intervalMs;this.pending=null;this.lastError=null;}
 start(){if(this.timer)return;this.timer=setInterval(()=>this.tick().catch(()=>{}),this.intervalMs);this.timer.unref();this.tick().catch(()=>{});}
 stop(){clearInterval(this.timer);this.timer=null;}
 async tick(){if(this.pending||this.isBusy())return;this.pending=(async()=>{this.reconcile();const task=this.store.claimDue();if(!task)return;try{const result=await this.dispatch(task);this.store.finish(task,result);}catch(error){this.store.finish(task,{status:'failed',error:{code:error.code||'SCHEDULE_DISPATCH_FAILED',message:error.message}});}})();try{await this.pending;this.lastError=null;}catch(e){this.lastError={code:e.code||'SCHEDULE_ENGINE_FAILED',message:e.message,at:iso(this.store.clock())};throw e;}finally{this.pending=null;}}
}

export class ScheduleTools {
 constructor(config,continuity){this.config=config;this.c=continuity;this.store=config.scheduleDirectory?new ScheduledTasks(config.scheduleDirectory):null;}
 tools(){if(!this.store)return [];const properties={title:{type:'string',minLength:1,maxLength:120},prompt:{type:'string',minLength:1,maxLength:6000},bot_id:{type:'string',maxLength:100},mode:{type:'string',enum:['remind','work']},interval_minutes:{type:'integer',minimum:1,maximum:525600},run_at:{type:'string',maxLength:60}};return [
  {name:'schedule_task',description:'Create an actual persisted user reminder or scheduled work conversation. Use only when the user explicitly requests a future/recurring reminder or action. remind posts a host reminder without model calls; work starts the chosen bot later and binds current authorized source versions. Include interval_minutes or RFC3339 run_at with timezone. No external messages are sent.',inputSchema:{type:'object',properties,required:['title','prompt'],additionalProperties:false},execute:async a=>{const request=this.config.request||'';if(this.config.proactiveExecution||/(?:不|别|禁止).{0,8}(?:创建|建立|设置|安排|启动|发送).{0,16}(?:提醒|定时|委托|跟进)/u.test(request))fail('SCHEDULE_INTENT_DENIED','本轮禁止新增定时任务');if(!/提醒|定时|每天|每周|每月|间隔|预约|闹钟|(?:分钟|小时|天).{0,6}(?:后|一次)/u.test(request))fail('SCHEDULE_INTENT_REQUIRED','本轮用户没有明确要求创建定时任务');const {BotRegistry}=await import('./bot-registry.mjs');const registry=new BotRegistry(this.config.scheduleDirectory),botId=a.bot_id||this.config.botPolicy?.id||'general';registry.get(botId);const task=this.store.save({title:a.title,prompt:a.prompt,botId,mode:a.mode||'remind',intervalMinutes:a.interval_minutes,runAt:a.run_at,inputRefs:a.mode==='work'?(this.c?.selected||[]):[]});return {taskId:task.id,title:task.title,nextRunAt:task.nextRunAt,mode:task.mode,botId:task.botId,persisted:true,note:'应用服务运行时主动发起对话；忙时等待，错过的重复周期合并一次。'};}},
  {name:'list_scheduled_tasks',description:'Read actual configured reminders and scheduled work, their next due time and dispatch history. Does not create or send notifications.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},execute:async()=>this.store.list()}
 ];}
}
