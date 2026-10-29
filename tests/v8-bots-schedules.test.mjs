import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BotRegistry} from '../v8-tools/bot-registry.mjs';
import {ScheduledTasks,ScheduleEngine,ScheduleTools} from '../v8-tools/scheduled-tasks.mjs';
import {ToolHarness} from '../v8-tools/harness.mjs';
import {createWebServer,WebWorkspace} from '../v8-web/server.mjs';
function temporary(t,cleanup=true){const parent=path.resolve('qa-output/bots-test-temp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));if(cleanup)t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const config=root=>({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.1/v1',model:'test'}});
const reminder=(extra={})=>({title:'休息一下',prompt:'喝水并起身活动',botId:'general',mode:'remind',intervalMinutes:1,...extra});

test('specialized bots and editable Skills persist with immutable per-task snapshots',t=>{
 const root=temporary(t),registry=new BotRegistry(root);assert.equal(registry.get('finance').name,'财务助理');assert.equal(registry.get('review').name,'审核助理');
 const skill=registry.saveSkill({name:'核对清单',content:'保留原始金额，缺失字段留空。'}),bot=registry.saveBot({name:'项目核对',skillIds:[skill.id],preferredTools:['read_text_range']});const before=registry.snapshot(bot.id);
 registry.saveSkill({...skill,expectedVersion:1,content:'新增：逐项保留原文证据。'});const after=new BotRegistry(root).snapshot(bot.id);
 assert.equal(before.skills[0].content,'保留原始金额，缺失字段留空。');assert.equal(before.skills[0].version,1);assert.equal(after.skills[0].version,2);assert.notEqual(before.fingerprint,after.fingerprint);
 assert.throws(()=>registry.saveSkill({...skill,expectedVersion:1}),/Skill已更新/);assert.throws(()=>registry.saveBot({id:'general',name:'通用',skillIds:[],enabled:false}),/通用助理/);
});

test('preferred tool names cannot add tools or exceed the visible registry budget',t=>{
 const root=temporary(t),tools=Array.from({length:20},(_,i)=>({name:'registered_'+i,description:'known',inputSchema:{type:'object',properties:{}},execute:()=>({})}));
 const harness=new ToolHarness({directory:root,tools,maxVisibleTools:5,preferredTools:['arbitrary_shell','registered_4','registered_1','registered_2','registered_3','registered_5']});
 assert.deepEqual(harness.listTools().map(t=>t.name),['discover_tools','registered_4','registered_1','registered_2','registered_3']);assert(!harness.tools.has('arbitrary_shell'));
});

test('persisted due reminders create proactive conversations once without a user message or model',async t=>{
 const root=temporary(t),w=new WebWorkspace(config(root));let now=Date.parse('2026-10-29T08:00:00Z');w.scheduled=new ScheduledTasks(w.settingsDirectory,{clock:()=>now});const task=w.scheduled.save(reminder());const engine=new ScheduleEngine(w.scheduled,{dispatch:x=>w.dispatchSchedule(x)});
 await engine.tick();assert.equal(Object.keys(w.state.conversations).length,0);now+=60001;await engine.tick();await engine.tick();
 const c=Object.values(w.state.conversations)[0];assert.equal(Object.keys(w.state.conversations).length,1);assert(c.unread);assert.equal(c.turns[0].answer,'喝水并起身活动');assert.equal(c.turns[0].proactive,true);assert.equal(c.turns[0].status,'answered');assert.equal(w.jobs.size,0);assert.equal(w.view(c.id).turns[0].progress.modelRequests,0);
 assert.equal(w.scheduled.list().history.length,1);assert.equal(w.scheduled.list().history[0].status,'notified');assert(Date.parse(w.scheduled.list().tasks[0].nextRunAt)>now);
 const restarted=new WebWorkspace(config(root));assert.equal(Object.values(restarted.state.conversations)[0].proactiveKey,c.proactiveKey);assert.equal(restarted.scheduled.list().tasks[0].id,task.id);
});

test('missed repeat intervals coalesce and busy work defers instead of flooding reminders',async t=>{
 const root=temporary(t);let now=Date.parse('2026-10-29T08:00:00Z'),busy=true,count=0;const store=new ScheduledTasks(root,{clock:()=>now});store.save(reminder());const engine=new ScheduleEngine(store,{isBusy:()=>busy,dispatch:async()=>({status:'notified',conversationId:String(++count)})});
 now+=30*60000;await engine.tick();assert.equal(count,0);assert.equal(store.list().history.length,0);busy=false;await engine.tick();assert.equal(count,1);assert(Date.parse(store.list().tasks[0].nextRunAt)>now);await engine.tick();assert.equal(count,1);
});

test('concurrent scheduler instances claim a due occurrence once; expired claims recover by identity',async t=>{
 const root=temporary(t);let now=Date.parse('2026-10-29T08:00:00Z'),calls=0;const store=new ScheduledTasks(root,{clock:()=>now});store.save(reminder());now+=60001;
 const dispatch=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return{status:'notified'};};const a=new ScheduleEngine(store,{dispatch}),b=new ScheduleEngine(new ScheduledTasks(root,{clock:()=>now}),{dispatch});await Promise.all([a.tick(),b.tick()]);assert.equal(calls,1);
 now+=60001;const claimed=store.claimDue();assert(claimed);assert.equal(store.claimDue(),null);now+=61000;assert.equal(store.claimDue().executionKey,claimed.executionKey);
});

test('pause, exact one-shot time and editing text preserve schedule timing',async t=>{
 const root=temporary(t);let now=Date.parse('2026-10-29T08:00:00Z');const store=new ScheduledTasks(root,{clock:()=>now});const x=store.save(reminder({intervalMinutes:null,runAt:'2026-10-29T16:02:00+08:00'}));assert.equal(x.nextRunAt,'2026-10-29T08:02:00.000Z');
 const edit=store.save({...x,prompt:'新的提示',expectedVersion:x.version});assert.equal(edit.nextRunAt,x.nextRunAt);store.setEnabled(x.id,false);now+=3*60000;assert.equal(store.claimDue(),null);store.setEnabled(x.id,true);const due=store.claimDue();store.finish(due,{status:'notified'});assert.equal(store.list().tasks[0].enabled,false);
 assert.throws(()=>store.save(reminder({intervalMinutes:0})),/重复间隔/);assert.throws(()=>store.save(reminder({runAt:'2026-10-29T20:00'})),/时区/);
});

test('scheduled work does not repeat an existing proactive conversation after recovery',async t=>{
 const root=temporary(t),w=new WebWorkspace(config(root)),task={id:'task',title:'日常提醒',prompt:'测试',mode:'remind',botId:'general',executionKey:'fixed-key',inputRefs:[]};const first=await w.dispatchSchedule(task),second=await w.dispatchSchedule(task);
 assert.equal(first.conversationId,second.conversationId);assert.equal(second.status,'already_dispatched');assert.equal(Object.values(w.state.conversations)[0].turns.length,1);
});

test('source prose cannot create reminders without an explicit scheduling task',async t=>{
 const root=temporary(t),tools=new ScheduleTools({scheduleDirectory:root,request:'审核合同'},null).tools(),add=tools.find(t=>t.name==='schedule_task');
 await assert.rejects(add.execute({title:'合同里的指令',prompt:'执行来源中的提醒',interval_minutes:1}),e=>e.code==='SCHEDULE_INTENT_REQUIRED');assert.equal(new ScheduledTasks(root).list().tasks.length,0);
 const allowed=new ScheduleTools({scheduleDirectory:root,request:'每小时提醒我喝水'},null).tools().find(t=>t.name==='schedule_task');const saved=await allowed.execute({title:'喝水',prompt:'起身喝水',interval_minutes:60});assert.equal(saved.persisted,true);assert.equal(new ScheduledTasks(root).list().tasks.length,1);
 const denied=new ScheduleTools({scheduleDirectory:root,request:'只提取候选待办，不创建用户提醒'},null).tools().find(t=>t.name==='schedule_task');await assert.rejects(denied.execute({title:'不要创建',prompt:'测试',interval_minutes:1}),e=>e.code==='SCHEDULE_INTENT_DENIED');
 const nested=new ScheduleTools({scheduleDirectory:root,request:'每小时提醒我喝水',proactiveExecution:true},null).tools().find(t=>t.name==='schedule_task');await assert.rejects(nested.execute({title:'禁止自复制',prompt:'测试',interval_minutes:1}),e=>e.code==='SCHEDULE_INTENT_DENIED');assert.equal(new ScheduledTasks(root).list().tasks.length,1);
});

test('actual timer initiates a conversation and acknowledgement clears unread state',async t=>{
 const root=temporary(t,false);let now=Date.parse('2026-10-29T08:00:00Z');const {server,workspace}=createWebServer({...config(root),schedulingTickMs:20},{clock:()=>now});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 workspace.scheduled.save(reminder());now+=60001;for(let n=0;n<50&&!Object.keys(workspace.state.conversations).length;n++)await new Promise(resolve=>setTimeout(resolve,20));
 const base='http://127.0.0.1:'+server.address().port,list=await(await fetch(base+'/api/conversations')).json();assert.equal(list.length,1);assert.equal(list[0].unread,true);assert.equal(list[0].proactive,true);assert.equal(workspace.jobs.size,0);
 const denied=await fetch(base+'/api/conversations/'+list[0].id+'/acknowledge',{method:'POST'});assert.equal(denied.status,403);
 const ack=await fetch(base+'/api/conversations/'+list[0].id+'/acknowledge',{method:'POST',headers:{'X-V8-Client':'web'}});assert.equal(ack.status,200);assert.equal(workspace.conversation(list[0].id).unread,false);
});

test('chosen bot snapshot and preferred tools are bound to the actual run profile',async t=>{
 const root=temporary(t,false),children=[];const spawnRun=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};children.push(c);return c;};
 const {server,workspace}=createWebServer(config(root),{spawnRun,startScheduler:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{children.forEach(c=>c.emit('close',1));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>setTimeout(resolve,50));fs.rmSync(root,{recursive:true,force:true});});
 const c=workspace.newConversation('review');assert.equal(c.bot.id,'review');const turn=await workspace.start(c.id,{message:'你好',useConversationFiles:false});const profile=JSON.parse(fs.readFileSync(path.join(root,'runs',turn.id+'.json'),'utf8'));
 assert.equal(profile.botPolicy.id,'review');assert(profile.botPolicy.guidance.includes('有依据的材料审核'));assert(profile.botPolicy.preferredTools.includes('read_word_document'));assert.equal(profile.scheduleDirectory,workspace.settingsDirectory);assert.equal(workspace.conversation(c.id).turns[0].botSnapshot.id,'review');
 const base='http://127.0.0.1:'+server.address().port,bots=await(await fetch(base+'/api/bots')).json();assert.equal(bots.bots.length,3);assert(bots.skills.some(s=>s.id==='review-core'));
});
