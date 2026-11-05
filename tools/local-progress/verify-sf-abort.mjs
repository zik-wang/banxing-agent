import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
const root=path.dirname(fileURLToPath(import.meta.url));
const output=fs.mkdtempSync(path.join(root,'test-output','sf-abort-'));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
Object.assign(process.env,{BOARD_DATA:path.join(output,'data'),BOARD_PORT:String(port),BOARD_SF_GAP_MS:'0'});
const {base,init}=await import('./core.mjs');
const {withSiliconflowSlot}=await import('./sf-turn.mjs');
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:process.env,windowsHide:true,stdio:'ignore'});
const nativeFetch=globalThis.fetch;
const passed=[];
try{
 for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await wait(50);}
 const creds=init();
 const post=async(worker,action,body)=>{const r=await fetch(base+'/api/siliconflow/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+creds.workers[worker]},body:JSON.stringify({worker_id:worker,...body})});assert(r.ok);return r.json();};
 const status=async()=> (await fetch(base+'/api/siliconflow')).json();
 const held=await post('demo-a','acquire',{request_id:'11111111-aaaa-bbbb-cccc-111111111111'});assert(held.granted);
 let calls=0;const controller=new AbortController();
 const pending=withSiliconflowSlot('demo-b',async()=>{calls++;return {status:200};},{pollMs:20,signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 let queued=false;for(let i=0;i<60;i++){if((await status()).waiting.length){queued=true;break;}await wait(10);}assert(queued);
 controller.abort();await rejected;
 let s=await status();assert.equal(calls,0);assert.equal(s.waiting.length,0);assert.equal(s.active.worker_id,'demo-a');
 passed.push('取消排队立即移除自身等待项，未调用回调且未释放其他worker活跃槽');
 await post('demo-a','release',{lease_id:held.lease_id,outcome:'ok'});
 const atGrant=new AbortController();
 globalThis.fetch=async(input,options)=>{const response=await nativeFetch(input,options);if(String(input).endsWith('/api/siliconflow/acquire')&&JSON.parse(options.body).worker_id==='demo-b')atGrant.abort();return response;};
 await assert.rejects(withSiliconflowSlot('demo-b',async()=>{calls++;return {status:200};},{signal:atGrant.signal}),{name:'AbortError'});
 globalThis.fetch=nativeFetch;s=await status();assert.equal(calls,0);assert.equal(s.active,null);assert.equal(s.waiting.length,0);assert.equal(s.granted_total,s.released_total);
 passed.push('获得许可时取消不派发供应商调用，正确结算未开始的自身槽');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),passed,provider_requests:0},null,2));
 console.log(JSON.stringify({passed,evidence:path.join(output,'result.json'),provider_requests:0},null,2));
}finally{globalThis.fetch=nativeFetch;child.kill();}
