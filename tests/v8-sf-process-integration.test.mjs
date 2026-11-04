import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const shared=process.env.V8_SF_TEST_SHARED_ROOT||path.join(here,'fixtures/sf-shared-source');
const required=['sf-turn.mjs','siliconflow-queue.mjs','core.mjs','control.mjs'];
const available=required.every(name=>fs.existsSync(path.join(shared,name)));
assert(available,'shared-source fixture is required; do not silently skip integration');
const sourceIdentity=JSON.parse(fs.readFileSync(path.join(here,'fixtures/sf-shared-source/source-identity.json'),'utf8'));
for(const entry of sourceIdentity.files)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(shared,entry.file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),entry.sha256,'shared source drift: '+entry.file);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const summary=[];

async function until(fn,timeout=8000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await wait(15);}throw Error('isolated fixture timeout');}
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function fixture(t,name){
 const parent=fs.realpathSync(process.env.V8_SF_PROCESS_EVIDENCE||os.tmpdir());
 const folder=fs.mkdtempSync(path.join(parent,'sf-process-'+name+'-')),boardData=path.join(folder,'board');fs.mkdirSync(boardData);
 const port=await freePort(),env={...process.env,V8_SF_PROCESS_TEST:'1',V8_SF_TEST_SHARED_ROOT:shared,BOARD_DATA:boardData,BOARD_PORT:String(port),V8_SF_SLOT_MODULE:path.join(here,'helpers/sf-process-slot.mjs')};
 delete env.AFK_SILICONFLOW_WORKER;
 const children=[];
 const launch=(file,args=[],extra={})=>{
  const child=spawn(process.execPath,[path.join(here,'helpers',file),...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe',...(extra.ipc?['ipc']:[])]});children.push(child);
  const log=fs.createWriteStream(path.join(folder,'process-'+child.pid+'.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('close',()=>log.end());return child;
 };
 const server=launch('sf-process-scheduler.mjs',[],{ipc:true});
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('test scheduler did not start')),8000);server.once('message',r=>{clearTimeout(timer);resolve(r);});server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('scheduler exited '+code));});});
 const base='http://127.0.0.1:'+port,upstream='http://127.0.0.1:'+ready.upstreamPort;
 const status=async()=>await(await fetch(base+'/api/siliconflow')).json();
 const control=async(action,body)=>{const r=await fetch(base+'/test/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-test-control-only'},body:JSON.stringify(body)});assert(r.ok);return r.json();};
 const events=()=>fs.existsSync(path.join(boardData,'events.jsonl'))?fs.readFileSync(path.join(boardData,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const client=(worker,mode='json')=>{
  const output=path.join(folder,worker+'.json');const child=launch('sf-process-client.mjs',[worker,mode,upstream,output]);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve({code,...JSON.parse(fs.readFileSync(output,'utf8'))}));});
  return {child,done};
 };
 t.after(async()=>{
  // Only this fixture's clients/coordinator exist here. Never release/clear a
  // retained uncertain lease. Pause waiting synthetic clients for shutdown.
  try{await control('control',{mode:'paused'});}catch{}
  await until(()=>children.filter(c=>c!==server).every(c=>c.exitCode!==null||c.signalCode!==null),1500).catch(()=>{});
  for(const child of children)if(child!==server&&child.exitCode===null&&child.signalCode===null)child.kill();
  const closed=new Promise(r=>server.once('exit',r));server.send('shutdown');await Promise.race([closed,wait(1500)]);if(server.exitCode===null)server.kill();
  if(!process.env.V8_SF_PROCESS_EVIDENCE){assert.equal(path.dirname(folder),parent);assert(path.basename(folder).startsWith('sf-process-'));fs.rmSync(folder,{recursive:true,force:true});}
 });
 return {folder,status,control,events,client};
}
function verifySequence(events){
 const starts=events.filter(e=>e.kind==='upstream_start'),maximum=Math.max(...starts.map(e=>e.maximum));assert.equal(maximum,1);
 for(const start of starts){const grant=events.find(e=>e.kind==='queue_acquire'&&e.granted&&e.worker===start.worker);assert(grant&&grant.sequence<start.sequence);}
 const one=starts[0],two=starts[1];
 const ended=events.find(e=>e.kind==='upstream_body_end'&&e.worker===one.worker);
 const released=events.find(e=>e.kind==='queue_release'&&e.worker===one.worker);
 assert(ended.sequence<released.sequence);assert(released.sequence<two.sequence);
 return {maximum,order:events.filter(e=>['upstream_start','upstream_body_end','queue_release'].includes(e.kind)),actualSfBranchGrants:events.filter(e=>e.kind==='queue_acquire'&&e.granted).length};
}

for(const mode of ['json','sse'])test('real client processes serialize full '+mode+' through actual test scheduler',{skip:!available,timeout:15000},async t=>{
 const f=await fixture(t,mode);for(const worker of ['worker-02','worker-03'])await f.control('config',{worker,mode,delayMs:450});
 const a=f.client('worker-02',mode);await until(()=>f.events().some(e=>e.kind==='upstream_start'));
 const b=f.client('worker-03',mode);await until(async()=>!!(await f.status()).waiting.length);
 assert.equal(f.events().filter(e=>e.kind==='upstream_start').length,1);
 const results=await Promise.all([a.done,b.done]);assert(results.every(r=>r.ok&&r.providerDispatches===1));
 const proof=verifySequence(f.events());fs.writeFileSync(path.join(f.folder,'proof.json'),JSON.stringify({mode,results,proof},null,2));summary.push({case:mode,...proof});
});

test('real shared 429 cooldown blocks other process until isolated test clock advances',{skip:!available,timeout:15000},async t=>{
 const f=await fixture(t,'429');await f.control('config',{worker:'worker-02',mode:'json',status:429,delayMs:450});await f.control('config',{worker:'worker-03',mode:'json',delayMs:20});
 const a=f.client('worker-02');await until(()=>f.events().some(e=>e.kind==='upstream_start'));const b=f.client('worker-03');
 const first=await a.done;assert.equal(first.error.httpStatus,429);assert.equal(first.providerDispatches,1);
 const cooling=await until(async()=>{const s=await f.status();return s.cooldown_remaining_ms>119000?s:null;});await wait(80);assert.equal(f.events().filter(e=>e.kind==='upstream_start').length,1);
 await f.control('clock',{advanceMs:120100});const second=await b.done;assert(second.ok);verifySequence(f.events());
 const proof={case:'429',retryAfterSeconds:120,cooling,clockAdvanceMs:120100,first,second};fs.writeFileSync(path.join(f.folder,'proof.json'),JSON.stringify(proof,null,2));summary.push(proof);
});

for(const kind of ['pause','deadline'])test(kind+' prevents queued process dispatch, in-flight synthetic response finishes',{skip:!available,timeout:15000},async t=>{
 const f=await fixture(t,kind);await f.control('config',{worker:'worker-02',mode:'json',delayMs:1000});
 const a=f.client('worker-02');await until(()=>f.events().some(e=>e.kind==='upstream_start'));const b=f.client('worker-03');await until(async()=>!!(await f.status()).waiting.length);
 await f.control('control',kind==='pause'?{mode:'paused'}:{mode:'running',expired:true});const [first,second]=await Promise.all([a.done,b.done]);
 assert(first.ok);assert.equal(second.providerDispatches,0);assert.equal(second.metrics.networkAttempts,0);assert.equal(second.ok,false);const s=await f.status();assert.equal(s.granted_total,1);assert.equal(s.dispatch_allowed,false);
 const proof={case:kind,first,second,state:s};fs.writeFileSync(path.join(f.folder,'proof.json'),JSON.stringify(proof,null,2));summary.push(proof);
});

test('disconnect retains actual uncertain lease; stale status never grants waiting process',{skip:!available,timeout:15000},async t=>{
 const f=await fixture(t,'disconnect');await f.control('config',{worker:'worker-02',mode:'disconnect',delayMs:450});
 const a=f.client('worker-02');await until(()=>f.events().some(e=>e.kind==='upstream_start'));const b=f.client('worker-03');await until(async()=>!!(await f.status()).waiting.length);
 const first=await a.done;assert.equal(first.ok,false);assert.equal(first.providerDispatches,1);await f.control('clock',{advanceMs:100000});
 const retained=await f.status();assert.equal(retained.active.worker_id,'worker-02');assert.match(retained.active.freshness,/待核实/);await wait(80);assert.equal(f.events().filter(e=>e.kind==='upstream_start').length,1);
 await f.control('control',{mode:'paused'});const second=await b.done;assert.equal(second.providerDispatches,0);
 const final=await f.status();assert.equal(final.active.worker_id,'worker-02');assert.equal(final.released_total,0);
 const proof={case:'disconnect',first,second,retained,final,noLeaseCleared:true};fs.writeFileSync(path.join(f.folder,'proof.json'),JSON.stringify(proof,null,2));summary.push(proof);
});

test.after(()=>{
 if(process.env.V8_SF_PROCESS_EVIDENCE)fs.writeFileSync(path.join(process.env.V8_SF_PROCESS_EVIDENCE,'integration-results.json'),JSON.stringify({scope:'real cross-process scheduler + mock upstream',cases:summary,actualModelCalls:0,productionSlotAcquisitions:0,testSettings:{gapMs:20,pollMs:25,clockAdvanceFor429Ms:120100,productionGapMsUnchanged:60000},sharedSource:sourceIdentity.files,productionRestarted:false},null,2));
});
