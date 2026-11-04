import test from 'node:test';import assert from 'node:assert/strict';import {PassThrough} from 'node:stream';import {EventEmitter} from 'node:events';import https,{request as namedRequest} from 'node:https';
import {createSiliconflowSlotTransport,installSiliconflowSlotTransport,SF_QUEUE_HOST} from '../qa-support/siliconflow-slot-fetch.mjs';
import {streamingFetch} from '../v8-tools/streaming-fetch.mjs';
import {createChatApi} from '../v8-tools/model-transport.mjs';
const url='https://api.siliconflow.cn/v1/chat/completions';
for(const type of ['application/json','text/event-stream'])test('shared slot is held through complete '+type+' body',async()=>{
 let held=false,finish,releases=0;const events=[];
 const transport=createSiliconflowSlotTransport({withSlot:async fn=>{held=true;const result=await fn();assert.equal(held,true);releases++;held=false;return result;},onRecord:e=>events.push(e),fetchImpl:async(_url,options)=>{assert(held);assert(options.waitForStreamEnd);return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(type==='application/json'?'{':'data: first\n\n'));finish=()=>{assert(held);c.enqueue(new TextEncoder().encode(type==='application/json'?'"ok":true}':'data: [DONE]\n\n'));c.close();};}}),{headers:{'Content-Type':type}});}});
 const pending=transport.fetch(url);await new Promise(r=>setImmediate(r));assert(held);assert.equal(releases,0);finish();const response=await pending;await response.text();assert.equal(releases,1);assert(events.some(e=>e.event==='provider-end'&&e.bodyFullyConsumed&&e.queueWaitMs>=0&&e.providerElapsedMs>=0));assert.equal(new Set(events.map(e=>e.requestId)).size,1);assert.match(events[0].requestId,/^[a-f0-9-]{36}$/);
});
test('SSE protocol DONE cannot release the queued transport before HTTP EOF',async()=>{
 let finish,ended=false;const request=(_url,_opts,cb)=>{const req=new EventEmitter();req.end=()=>{const res=new PassThrough();res.statusCode=200;res.headers={'content-type':'text/event-stream'};cb(res);res.write('data: '+JSON.stringify({choices:[{delta:{content:'ok'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');finish=()=>{ended=true;res.end();};};return req;};
 const transport=createSiliconflowSlotTransport({withSlot:async fn=>{const result=await fn();assert(ended);return result;},fetchImpl:(u,o)=>streamingFetch(u,o,request)});
 let settled=false;const pending=transport.fetch(url,{method:'POST',body:'{}'}).then(x=>{settled=true;return x;});await new Promise(r=>setImmediate(r));assert(!settled);finish();assert.equal((await(await pending).json()).choices[0].message.content,'ok');
});
test('429 complete body and Retry-After reach the global scheduler exactly once',async()=>{
 let calls=0,outcome;const transport=createSiliconflowSlotTransport({withSlot:async fn=>outcome=await fn(),fetchImpl:async()=>{calls++;return new Response('{"error":"limit"}',{status:429,headers:{'Retry-After':'23'}});}});const r=await transport.fetch(url);assert.equal(r.status,429);assert.equal(await r.text(),'{"error":"limit"}');assert.equal(outcome.retry_after_seconds,'23');assert.equal(calls,1);
});
test('streaming HTTPS adapter preserves provider Retry-After for the shared cooldown',async()=>{
 let outcome;const request=(_url,_opts,cb)=>{const req=new EventEmitter();req.end=()=>{const res=new PassThrough();res.statusCode=429;res.headers={'content-type':'application/json','retry-after':'41','x-ratelimit-remaining':'0'};cb(res);res.end('{"error":"synthetic limit"}');};return req;};const transport=createSiliconflowSlotTransport({withSlot:async fn=>outcome=await fn(),fetchImpl:(u,o)=>streamingFetch(u,o,request)});const response=await transport.fetch(url,{method:'POST',body:'{}'});assert.equal(response.status,429);assert.equal(outcome.retry_after_seconds,'41');assert.equal(response.headers.get('x-ratelimit-remaining'),'0');
});
test('uncertain body end retains lease decision and cannot trigger a local retry',async()=>{
 let calls=0,outcome;const transport=createSiliconflowSlotTransport({withSlot:async fn=>outcome=await fn(),fetchImpl:async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(Object.assign(Error('synthetic termination'),{code:'ECONNRESET'}));}}));}});
 const api=createChatApi({baseUrl:'https://api.siliconflow.cn/v1',model:'fixture',provider:'siliconflow',fetchImpl:transport.fetch,maxAttempts:3,timeoutMs:1000},class extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}});
 await assert.rejects(()=>api([],[]),e=>e.details.error.code==='SF_SLOT_UNCERTAIN');assert.equal(calls,1);assert.equal(outcome.uncertain,true);await assert.rejects(()=>transport.fetch(url),{code:'SF_SLOT_UNCERTAIN'});assert.equal(calls,1);
});
test('pause/queue failure prevents provider dispatch; non-SF never acquires a slot',async()=>{
 let calls=0,slots=0;const transport=createSiliconflowSlotTransport({withSlot:async()=>{slots++;throw Error('paused fixture');},fetchImpl:async()=>{calls++;return new Response('ok');}});await assert.rejects(()=>transport.fetch(url),/paused/);assert.equal(calls,0);assert.equal(await(await transport.fetch('https://example.test/v1')).text(),'ok');assert.equal(slots,1);
});
test('cancelled queued request is not dispatched and does not create uncertain ownership',async()=>{
 let calls=0,outcome;const cancel=new AbortController();const transport=createSiliconflowSlotTransport({withSlot:async fn=>{cancel.abort();return outcome=await fn();},fetchImpl:async()=>{calls++;}});await assert.rejects(()=>transport.fetch(url,{signal:cancel.signal}),{code:'SF_REQUEST_NOT_STARTED'});assert.equal(calls,0);assert.equal(outcome.notStarted,true);assert(!outcome.uncertain);
});
test('host preload rejects direct HTTPS and duplicate/nested slot layers',async()=>{
 const restore=installSiliconflowSlotTransport({withSlot:async fn=>fn()});try{assert(globalThis[SF_QUEUE_HOST]);assert.throws(()=>https.request(url),{code:'SF_SLOT_REQUIRED'});assert.throws(()=>namedRequest(url),{code:'SF_SLOT_REQUIRED'});assert.throws(()=>installSiliconflowSlotTransport({withSlot:async fn=>fn()}),/second layer/);const transport=globalThis[SF_QUEUE_HOST];assert.equal(transport.wrapFetch(globalThis.fetch),globalThis.fetch);const nested=transport.wrapFetch(()=>transport.fetch(url));await assert.rejects(()=>nested(url),{code:'SF_SLOT_UNCERTAIN'});}finally{restore();}
});
test('real chat client streaming path uses the installed shared host exactly once',async()=>{
 const original=https.request;let acquisitions=0,ended=false;
 https.request=(_url,_options,cb)=>{const req=new EventEmitter();req.end=()=>{const res=new PassThrough();res.statusCode=200;res.headers={'content-type':'text/event-stream'};cb(res);res.write('data: '+JSON.stringify({model:'fixture',choices:[{delta:{content:'ok'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');setImmediate(()=>{ended=true;res.end();});};return req;};
 const restore=installSiliconflowSlotTransport({withSlot:async fn=>{acquisitions++;const result=await fn();assert(ended);return result;}});
 try{const api=createChatApi({baseUrl:'https://api.siliconflow.cn/v1',model:'fixture',provider:'siliconflow',streaming:true,maxAttempts:1,timeoutMs:1000});assert.equal((await api([],[])).content,'ok');assert.equal(acquisitions,1);}finally{restore();https.request=original;}
});
