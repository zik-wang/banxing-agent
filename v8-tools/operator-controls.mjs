import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const defaultFile=fileURLToPath(new URL('./operator-controls.local.json',import.meta.url));
const fail=code=>{throw Object.assign(Error(code),{code});};
// Optional host-owned local file. Never accepted from a message or tool argument.
export function operatorControls(file=defaultFile){
 if(!fs.existsSync(file))return {};
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 if(c.version!==1||!/^worker-0[1-7]$/.test(c.workerId||'')||typeof c.slotModulePath!=='string'||!Array.isArray(c.cases))fail('OPERATOR_CONTROL_INVALID');
 for(const b of c.cases)if(!b.conversationId||!/^[a-f0-9]{64}$/.test(b.requestSha256)||!Number.isInteger(b.maxRequests)||b.maxRequests<1||b.maxRequests>12||!Number.isFinite(b.timeoutMs)||b.timeoutMs<1000||b.timeoutMs>1200000)fail('OPERATOR_BOUND_INVALID');
 return c;
}
function selected(config,file){return operatorControls(file).cases?.find(b=>b.conversationId===config.continuity?.conversationId);}
export function applyOperatorBounds(config,file=defaultFile){
 const b=selected(config,file);if(!b)return;
 if(createHash('sha256').update(config.request).digest('hex')!==b.requestSha256)fail('OPERATOR_REQUEST_CHANGED');
 if(b.requirePreload&&!globalThis[Symbol.for('banxing.siliconflow.shared-slot-installed')])fail('OPERATOR_SHARED_PRELOAD_REQUIRED');
 config.executionPolicy={mode:'bounded'};config.maxRounds=b.maxRequests;config.maxCalls=60;config.maxNoProgress=5;config.maxDiscoveryCalls=8;config.maxDiscoveryStreak=6;config.timeoutMs=b.timeoutMs;
 config.chat={...config.chat,maxAttempts:1};config.continuity.maxCumulativeModelRequests=b.maxRequests;config.continuity.maxCumulativeToolAttempts=60;
 if(b.requirePreload){
  // The inherited preload already buffers global fetch under one shared slot.
  // Native HTTPS streaming would bypass it; do not install a second queue.
  config.chat.streaming=false;
  fs.writeFileSync(file+'.proof-'+process.pid+'.json',JSON.stringify({pid:process.pid,entrypoint:process.argv[1],conversationId:b.conversationId,requestSha256:b.requestSha256,sharedPreloadInstalled:true,sharedWorker:process.env.BANXING_SF_WORKER||null,maxRequests:b.maxRequests,timeoutMs:b.timeoutMs,streaming:false,maxAttempts:1}));
 }
 if(!b.requirePreload)fs.writeFileSync(file+'.proof-'+process.pid+'.json',JSON.stringify({pid:process.pid,entrypoint:process.argv[1],conversationId:b.conversationId,requestSha256:b.requestSha256,provider:config.chat.provider,model:config.chat.model,hostBudgetApplied:true,maxRequests:b.maxRequests,timeoutMs:b.timeoutMs,maxAttempts:1}));
}
export function consumeOperatorRequest(config,file=defaultFile){
 const b=selected(config,file);if(!b)return;
 if(createHash('sha256').update(config.request).digest('hex')!==b.requestSha256)fail('OPERATOR_REQUEST_CHANGED');
 const stateFile=file+'.state',lock=stateFile+'.lock';let fd;
 try{fd=fs.openSync(lock,'wx');}catch{fail('OPERATOR_BUDGET_BUSY');}
 try{
  const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
  const key=b.conversationId+':'+b.requestSha256,entry=state[key]||{requests:0,startedAt:Date.now()};
  if(!Number.isInteger(entry.requests)||entry.requests<0||!Number.isFinite(entry.startedAt))fail('OPERATOR_BUDGET_INVALID');
  if(entry.requests>=b.maxRequests)fail('OPERATOR_REQUEST_BUDGET_EXHAUSTED');
  if(Date.now()-entry.startedAt>=b.timeoutMs)fail('OPERATOR_TIME_BUDGET_EXHAUSTED');
  entry.requests++;state[key]=entry;fs.writeFileSync(stateFile,JSON.stringify(state));
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
