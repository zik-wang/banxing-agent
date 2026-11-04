import test from 'node:test';import assert from 'node:assert/strict';
import {createSiliconflowSlotFetch} from '../v8-tools/siliconflow-slot-fetch.mjs';
const address='https://api.siliconflow.cn/v1/chat/completions';
test('non-SF endpoints use no shared slot',async()=>{let slots=0;const f=createSiliconflowSlotFetch({workerId:'w',fetchImpl:async()=>new Response('local'),withSlot:async()=>{slots++;}});assert.equal(await(await f('http://127.0.0.1:9/v1')).text(),'local');assert.equal(slots,0);});
test('SF SSE holds its slot until upstream closes, not merely until HTTP headers',async()=>{
 let close,released=false;const states=[];
 const f=createSiliconflowSlotFetch({workerId:'worker-01',onReceipt:r=>states.push(r),withSlot:async(id,fn)=>{assert.equal(id,'worker-01');const result=await fn();released=true;assert.equal(result.status,200);return result;},fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: first\n\n'));close=()=>{c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();};}}),{headers:{'content-type':'text/event-stream'}})});
 let returned=false;const pending=f(address).then(r=>{returned=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(released,false);assert.equal(returned,false);close();const response=await pending;assert.equal(released,true);assert.match(await response.text(),/\[DONE\]/);const end=states.at(-1);assert.equal(end.fullBodyConsumed,true);assert.ok(end.queueWaitMs>=0&&end.providerElapsedMs>=0);assert.equal(end.responseBytes,27);
});
test('different API keys share the same worker queue and are never copied into receipts',async()=>{
 let tail=Promise.resolve(),active=0,peak=0;const receipts=[];const withSlot=(id,fn)=>{assert.equal(id,'worker-01');const promise=tail.then(async()=>{peak=Math.max(peak,++active);try{return await fn();}finally{active--;}});tail=promise.catch(()=>{});return promise;};
 const f=createSiliconflowSlotFetch({workerId:'worker-01',withSlot,onReceipt:r=>receipts.push(r),fetchImpl:async()=>{await new Promise(r=>setImmediate(r));return new Response('{}');}});
 await Promise.all([f(address,{headers:{Authorization:'Bearer secret-a'},body:'private-a'}),f(address,{headers:{Authorization:'Bearer secret-b'},body:'private-b'})]);assert.equal(peak,1);assert.equal(new Set(receipts.map(r=>r.id)).size,2);assert.doesNotMatch(JSON.stringify(receipts),/secret-|private-/);
});
test('a fully consumed 429 exposes Retry-After to shared cooldown without local retry',async()=>{
 let count=0,outcome;const f=createSiliconflowSlotFetch({workerId:'w',withSlot:async(_,fn)=>outcome=await fn(),fetchImpl:async()=>{count++;return new Response('{"error":"rate limit"}',{status:429,headers:{'retry-after':'17'}});}});const response=await f(address);assert.equal(count,1);assert.equal(outcome.status,429);assert.equal(outcome.retry_after_seconds,'17');assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'rate limit'});
});
test('cancelled wait does not dispatch provider fetch after acquiring a slot',async()=>{
 let calls=0;const receipts=[],c=new AbortController();c.abort();const f=createSiliconflowSlotFetch({workerId:'w',onReceipt:r=>receipts.push(r),withSlot:async(_,fn)=>fn(),fetchImpl:async()=>{calls++;}});await assert.rejects(f(address,{signal:c.signal}),e=>e.request_not_started===true);assert.equal(calls,0);assert.ok(receipts.at(-1).queueWaitMs>=0);assert.equal(receipts.at(-1).providerElapsedMs,0);
});
test('a broken upstream stream stays a failure with incomplete-consumption evidence',async()=>{
 const receipts=[];const f=createSiliconflowSlotFetch({workerId:'w',withSlot:async(_,fn)=>fn(),onReceipt:r=>receipts.push(r),fetchImpl:async()=>new Response(new ReadableStream({start(c){c.error(Error('synthetic broken stream'));}}))});await assert.rejects(f(address),/synthetic broken stream/);assert.equal(receipts.at(-1).fullBodyConsumed,false);assert.equal(receipts.at(-1).uncertain,true);
});
