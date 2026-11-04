import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {root} from './core.mjs';
const output=path.join(root,'test-output',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const env={...process.env,BOARD_DATA:path.join(output,'data'),BOARD_PORT:String(port),BOARD_INTERVAL_MS:'400',BOARD_STALE_MS:'600'};
const base=`http://127.0.0.1:${port}`;
const children=[];const results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
function launch(role){const c=spawn(process.execPath,[path.join(root,role+'.mjs')],{env,windowsHide:true,stdio:['ignore',fs.openSync(path.join(output,role+'.log'),'a'),fs.openSync(path.join(output,role+'.err'),'a')]});children.push(c);return c;}
async function waitFor(fn){for(let i=0;i<70;i++){if(await fn())return;await delay(100);}throw Error('timeout');}
function check(name,fn){fn();results.push(name);console.log('PASS '+name);}
let browser;
try{
 const server=launch('server');await waitFor(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}});
 const creds=JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'credentials.json'),'utf8'));
 const get=async()=>await (await fetch(base+'/api/state')).json();
 const report=async(id,stage,extra={})=>fetch(base+'/api/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+creds.workers[id]},body:JSON.stringify({task_id:'DEMO',worker_id:id,status:'running',stage,next_step:'演示下一步',blocker:'',result_path:'DEMO/only',...extra})});
 let s=await get();check('四项任务均待办，七个真实 worker 未接入',()=>{assert.equal(s.tasks.length,4);assert(s.tasks.every(t=>t.status==='待办'&&t.workers.every(w=>!w.connected)));});
 const reports=await Promise.all(Array.from({length:30},(_,i)=>report(i%2?'demo-a':'demo-b','演示并发 '+i)));assert(reports.every(r=>r.ok));
 s=await get();check('30 次并发请求，两个 demo worker 独立保存，无真实任务污染',()=>{assert.equal(s.demo.filter(w=>w.connected).length,2);assert(s.demo.every(w=>w.stage.startsWith('演示并发')));assert(s.tasks.every(t=>t.workers.every(w=>!w.connected)));});
 const conflict=await report('demo-a','演示',{task_id:'T1'});check('模拟 worker 不能污染真实任务',()=>assert.equal(conflict.status,409));
 const multi=await report('worker-01','同一窗口跨任务',{task_id:'T1',task_ids:['T1','T4']});assert(multi.ok);
 assert((await report('worker-01','独立更新T4',{task_id:'T4',status:'blocked',blocker:'演示阻塞'})).ok);
 assert((await report('worker-01','暂时不确定归属',{task_id:'GENERAL'})).ok);
 assert((await report('worker-02','第二窗口独立推进T1',{task_id:'T1'})).ok);
 s=await get();check('同一窗口关联多任务、切换保留原进度、多窗口同任务隔离、支持待归类',()=>{assert.equal(s.tasks[0].workers.length,2);assert.equal(s.tasks[0].workers.find(w=>w.worker_id==='worker-01').stage,'同一窗口跨任务');assert.equal(s.tasks[3].workers[0].stage,'独立更新T4');assert.equal(s.tasks[3].workers[0].status,'blocked');assert.equal(s.unclassified[0].stage,'暂时不确定归属');assert.equal(s.workers.filter(w=>w.connected).length,2);});
 const impersonated=await report('worker-01','覆盖别人',{worker_id:'worker-02',task_id:'T1'});check('跨任务自由关联时仍拒绝覆盖其他窗口身份',()=>assert.equal(impersonated.status,403));
 const thread='11111111-2222-3333-4444-555555555555';assert((await report('worker-01','绑定聊天',{task_id:'GENERAL',thread_id:thread})).ok);
 const rebound=await report('worker-01','错误改绑',{task_id:'GENERAL',thread_id:'22222222-2222-3333-4444-555555555555'});check('拒绝不同聊天共用同一个worker身份',()=>assert.equal(rebound.status,409));
 const duplicate=await report('worker-02','重复绑定',{task_id:'GENERAL',thread_id:thread});check('一个聊天只能登记一个worker身份',()=>assert.equal(duplicate.status,409));
 const ackCycle='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';fs.mkdirSync(path.join(env.BOARD_DATA,'supervision'),{recursive:true});fs.writeFileSync(path.join(env.BOARD_DATA,'supervision',ackCycle+'.json'),JSON.stringify({workers:[{worker_id:'worker-01',thread_id:thread}],deliveries:{'worker-01':{status:'queued_pending_worker_ack'}}}));
 assert((await report('worker-01','已实际核实并开始 AFK_ACK:'+ackCycle,{task_id:'GENERAL',thread_id:thread})).ok);
 check('只有绑定worker的明确回执才记录收到，不把入队当执行完成',()=>{const receipt=JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'supervision-receipts',ackCycle,'worker-01.json'),'utf8'));assert(receipt.acknowledged_at);});
 const firstAck=JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'supervision-receipts',ackCycle,'worker-01.json'),'utf8')).acknowledged_at;
 await delay(15);assert((await report('worker-01','后续结果 AFK_ACK:'+ackCycle,{task_id:'GENERAL',thread_id:thread})).ok);
 check('重复回执保留首次收到时间，不把后续结果退回刚开始',()=>assert.equal(JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'supervision-receipts',ackCycle,'worker-01.json'),'utf8')).acknowledged_at,firstAck));
 fs.mkdirSync(path.join(env.BOARD_DATA,'onboarding'),{recursive:true});fs.writeFileSync(path.join(env.BOARD_DATA,'onboarding','worker-01.json'),JSON.stringify({id:ackCycle,thread_id:thread,requested_at:new Date().toISOString()}));
 assert((await report('worker-01','收到接入 AFK_CONNECT_ACK:'+ackCycle,{task_id:'GENERAL',thread_id:thread})).ok);
 assert((await report('worker-01','完成有限步骤 AFK_CONNECT_PROGRESS:'+ackCycle,{task_id:'GENERAL',thread_id:thread,status:'done'})).ok);
 check('接入回执与实际阶段结果分别持久记录',()=>{const receipt=JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'onboarding-receipts','worker-01.json'),'utf8'));assert(receipt.acknowledged_at);assert(receipt.progress_reported_at);assert.equal(receipt.progress_report.status,'done');});
 const bad=await fetch(base+'/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});check('拒绝无凭证请求',()=>assert.equal(bad.status,403));
 const forged=await fetch(base+'/api/accept',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+creds.workers['demo-a']},body:JSON.stringify({task_id:'T1',accepted:true})});check('worker 无法将任务标为用户已验收',()=>assert.equal(forged.status,403));
 const accepted=await fetch(base+'/api/accept',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+creds.admin},body:JSON.stringify({task_id:'T1',accepted:true})});check('独立用户验收接口可用（隔离测试数据）',()=>assert.equal(accepted.status,200));
 const done=await report('demo-a','演示完成',{status:'done'});assert(done.ok);s=await get();check('worker 完成状态独立保存',()=>assert.equal(s.demo.find(w=>w.worker_id==='demo-a').status,'done'));
 launch('inspector');await waitFor(async()=>fs.existsSync(path.join(env.BOARD_DATA,'inspector.json')));await delay(1400);s=await get();
 check('无更新超时标记为状态待核实，同时保留完成上报',()=>{assert(s.demo.every(w=>w.freshness==='状态待核实'));assert.equal(s.demo.find(w=>w.worker_id==='demo-a').status,'done');});
 let summaries=fs.readdirSync(path.join(env.BOARD_DATA,'summaries')).filter(f=>f.endsWith('.json'));
 check('独立巡检进程按缩短周期多次写入带时间戳的 JSON/Markdown 和日志',()=>{assert(summaries.length>=2);assert(fs.existsSync(path.join(env.BOARD_DATA,'afk.jsonl')));});
 // Browser is used only for verification, not a runtime dependency.
 const require=createRequire(import.meta.url);
 let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.BOARD_PLAYWRIGHT_MODULE||path.join(root,'..','code','computer_use','node_modules','playwright','index.js'));}
 const {chromium}=playwright;browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#tasks article').length===4);await page.locator('#demo summary').click();await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 check('浏览器实际渲染四任务、七个独立窗口及待归类，演示区明确隔离',()=>{assert.equal(errors.length,0);});
 assert.equal(await page.locator('#sessions .worker').count(),7);assert.equal(await page.locator('#unclassified .worker').count(),1);assert.equal(await page.locator('#demos .worker').count(),2);
 assert((await report('worker-01','仅T4刷新',{task_id:'T4'})).ok);s=await get();check('更新T4不会使同窗口旧T1进度假装新鲜',()=>{assert.equal(s.tasks[0].workers.find(w=>w.worker_id==='worker-01').freshness,'状态待核实');assert.equal(s.tasks[3].workers[0].freshness,'最近有上报');});
 await report('demo-b','浏览器自动刷新验证');await page.waitForFunction(()=>document.querySelector('#demos').textContent.includes('浏览器自动刷新验证'),{},{timeout:10000});results.push('浏览器 5 秒自动刷新显示新上报');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));results.push('390px 页面无水平溢出');await browser.close();browser=null;
 server.kill();await delay(1200);summaries=fs.readdirSync(path.join(env.BOARD_DATA,'summaries')).filter(f=>f.endsWith('.json')).sort();const latest=JSON.parse(fs.readFileSync(path.join(env.BOARD_DATA,'summaries',summaries.at(-1)),'utf8'));check('上报服务停止后巡检仍运行，并记录服务不可用',()=>assert.equal(latest.report_service_available,false));
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({at:new Date().toISOString(),passed:results,isolated_data:env.BOARD_DATA,test_interval_ms:400,production_interval_ms:1800000},null,2));console.log('EVIDENCE '+output);
}finally{if(browser)await browser.close();for(const c of children)c.kill();}
