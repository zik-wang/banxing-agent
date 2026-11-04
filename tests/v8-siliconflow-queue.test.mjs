import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createChatApi} from '../v8-tools/model-transport.mjs';
import {queuedProviderFetch,isSiliconflowEndpoint,siliconflowTiming} from '../v8-tools/siliconflow-queue.mjs';
import {streamingFetch} from '../v8-tools/streaming-fetch.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {ModelConnections} from '../v8-web/model-connections.mjs';
import {createWebServer} from '../v8-web/server.mjs';

const SF='https://api.siliconflow.cn/v1/chat/completions';
const messages=[{role:'user',content:'Synthetic local fixture only'}];
const payload=()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'synthetic result'}}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

// Independent in-process mock scheduler, never the production slot service.
function scheduler(){
 let tail=Promise.resolve(),active=0,maximum=0,grants=0,paused=false;
 const outcomes=[];
 const withSlot=async(worker,fn)=>{
  assert.match(worker,/^worker-0[1-7]$/);
  const previous=tail,gate=deferred();tail=gate.promise;
  try{
   await previous;
   if(paused)throw Object.assign(Error('mock paused'),{code:'AFK_PAUSED'});
   active++;grants++;maximum=Math.max(maximum,active);
   try{const value=await fn();outcomes.push({status:value.status,retry:value.retry_after_seconds});return value;}
   catch(e){outcomes.push({status:e.status||'error',retry:e.retry_after_seconds});throw e;}
   finally{active--;}
  }finally{gate.resolve();}
 };
 return {queue:workerId=>({workerId,withSlot}),pause:()=>{paused=true;},get maximum(){return maximum;},get grants(){return grants;},get active(){return active;},outcomes};
}
function api(fetchImpl,queue,extra={}){return createChatApi({baseUrl:'https://api.siliconflow.cn/v1',provider:'siliconflow',model:'fixture-27b',fetchImpl,siliconflowQueue:queue,timeoutMs:2000,maxAttempts:3,...extra});}
function temp(t){const parent=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(parent,'v8-sf-queue-'));t.after(()=>{assert.equal(path.dirname(dir),parent);assert(path.basename(dir).startsWith('v8-sf-queue-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;}

test('different workers and keys serialize actual localhost JSON bodies until end', {timeout:5000},async t=>{
 const fifo=scheduler(),firstBody=deferred(),finish=deferred();let dispatched=0;
 const server=http.createServer(async(req,res)=>{const id=++dispatched;req.resume();res.writeHead(200,{'content-type':'application/json'});const body=payload();res.write(body.slice(0,10));if(id===1){firstBody.resolve();await finish.promise;}res.end(body.slice(10));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{finish.resolve();server.closeAllConnections();server.close();});
 const directory=temp(t),mappedFetch=(_url,init)=>fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',init);
 const a=api(mappedFetch,fifo.queue('worker-02'),{apiKey:'synthetic-key-a',logDirectory:directory}),b=api(mappedFetch,fifo.queue('worker-03'),{apiKey:'synthetic-key-b'});
 const one=a(messages,[]);await firstBody.promise;const two=b(messages,[]);await wait(20);
 assert.equal(dispatched,1);assert.equal(b.metrics().networkAttempts,0,'queue wait is not a network attempt');finish.resolve();
 assert.equal((await one).content,'synthetic result');assert.equal((await two).content,'synthetic result');assert.equal(dispatched,2);assert.equal(fifo.maximum,1);
 const log=JSON.parse(fs.readFileSync(path.join(directory,fs.readdirSync(directory).find(n=>n.endsWith('.json'))),'utf8'));
 assert(log.sfQueue.bodyFullyConsumed);assert(log.sfQueue.queueWaitMs>=0);assert(log.sfQueue.supplierRequestMs>=0);assert.equal(log.networkRequestAttempted,true);
});

test('actual URL controls queue membership; a non-SF endpoint never acquires',async()=>{
 const fifo=scheduler();let count=0;
 const r=await queuedProviderFetch('http://127.0.0.1:1/mock',{}, {fetchImpl:async()=>{count++;return new Response(payload());},queue:fifo.queue('worker-02')});
 assert.equal(r.status,200);assert.equal(count,1);assert.equal(fifo.grants,0);assert(isSiliconflowEndpoint(SF));assert(!isSiliconflowEndpoint('https://api.siliconflow.cn.attacker.invalid/v1'));
});

test('429 reports shared cooldown once, preserves request and never SDK-retries',async()=>{
 const fifo=scheduler();let count=0;
 const next=api(async(url,init)=>{count++;assert.equal(url,SF);assert.equal(init.headers.Authorization,'Bearer synthetic-key');const body=JSON.parse(init.body);assert.equal(body.model,'fixture-27b');assert.equal(body.max_tokens,321);assert.equal(body.enable_thinking,false);assert.deepEqual(body.messages,messages);return new Response('{"error":{"message":"fixture limit"}}',{status:429,headers:{'retry-after':'73'}});},fifo.queue('worker-02'),{apiKey:'synthetic-key',maxTokens:321,enableThinking:false});
 await assert.rejects(next(messages,[]),e=>e.code==='MODEL_HTTP_ERROR'&&e.details.httpStatus===429&&e.details.retryAfterSeconds===73);
 assert.equal(count,1);assert.equal(next.metrics().retries,0);assert.deepEqual(fifo.outcomes,[{status:429,retry:73}]);
});

test('SF body disconnect releases with explicit error and does not retry',async()=>{
 const fifo=scheduler();let count=0;
 const next=api(async()=>{count++;return {status:200,ok:true,headers:new Headers(),text:async()=>{throw Object.assign(new TypeError('terminated'),{code:'UND_ERR_SOCKET'});}};},fifo.queue('worker-02'));
 await assert.rejects(next(messages,[]),e=>e.code==='MODEL_NETWORK_ERROR');assert.equal(count,1);assert.equal(fifo.active,0);assert.equal(next.metrics().retries,0);
});

test('429 body disconnect still reports rate limiting to caller and shared cooldown',async()=>{
 const fifo=scheduler();let count=0;
 const next=api(async()=>{count++;return {status:429,ok:false,headers:new Headers({'retry-after':'37'}),text:async()=>{throw Error('fixture body disconnected');}};},fifo.queue('worker-02'));
 await assert.rejects(next(messages,[]),e=>e.code==='MODEL_HTTP_ERROR'&&e.details.httpStatus===429&&e.details.retryAfterSeconds===37);
 assert.equal(count,1);assert.deepEqual(fifo.outcomes,[{status:429,retry:37}]);
});

function mockedStream({disconnect=false,gate,observed,status=200,headers={}}={}){
 return (_url,_options,callback)=>{
  const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{
   const res=new PassThrough();res.statusCode=status;res.headers={'content-type':'text/event-stream',...headers};callback(res);
   res.write('data: '+JSON.stringify({choices:[{delta:{content:'synthetic result'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');observed?.resolve();
   if(disconnect)res.destroy();else (gate?.promise||Promise.resolve()).then(()=>res.end('data: '+JSON.stringify({choices:[],usage:{total_tokens:9}})+'\n\n'));
  });return req;
 };
}

test('SSE finish/DONE does not release until stream ends including final usage',async()=>{
 const fifo=scheduler(),gate=deferred(),observed=deferred();let calls=0;
 const fetchImpl=(url,init)=>{calls++;return streamingFetch(url,init,mockedStream({gate,observed}));};
 const one=api(fetchImpl,fifo.queue('worker-02'))(messages,[]);await observed.promise;
 const two=api(fetchImpl,fifo.queue('worker-03'))(messages,[]);await wait(15);assert.equal(calls,1);assert.equal(fifo.active,1);
 gate.resolve();assert.equal((await one).content,'synthetic result');assert.equal((await two).content,'synthetic result');assert.equal(calls,2);assert.equal(fifo.maximum,1);
});

test('stream adapter preserves Retry-After and handles disconnect without hanging',async()=>{
 const result=await streamingFetch(SF,{method:'POST',body:'{}'},(_url,_init,callback)=>{
  const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=429;res.headers={'content-type':'application/json','retry-after':'91'};callback(res);res.end('{"error":"limited"}');});return req;
 });assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'91');
 const fifo=scheduler();const next=api((url,init)=>streamingFetch(url,init,mockedStream({disconnect:true})),fifo.queue('worker-02'));
 await assert.rejects(next(messages,[]),e=>e.code==='MODEL_NETWORK_ERROR');assert.equal(fifo.active,0);assert.equal(next.metrics().networkAttempts,1);
});

test('pause rejects a queued call without dispatch or budget accounting',async()=>{
 const fifo=scheduler();fifo.pause();let calls=0,announced=0;
 const next=api(async()=>{calls++;return new Response(payload());},fifo.queue('worker-02'),{onAttempt:()=>announced++});
 await assert.rejects(next(messages,[]));assert.equal(calls,0);assert.equal(announced,0);assert.equal(next.metrics().networkAttempts,0);
});

test('abort during queue waiting never starts provider request after grant',async()=>{
 const fifo=scheduler(),hold=deferred(),entered=deferred();let secondCalls=0;
 const first=queuedProviderFetch(SF,{}, {queue:fifo.queue('worker-02'),fetchImpl:async()=>{entered.resolve();await hold.promise;return new Response('{}');}});await entered.promise;
 const controller=new AbortController(),next=api(async()=>{secondCalls++;return new Response(payload());},fifo.queue('worker-03'));
 const waiting=next(messages,[],controller.signal);controller.abort(Error('cancelled'));hold.resolve();await first;
 await assert.rejects(waiting,e=>e.code==='MODEL_REQUEST_CANCELLED');assert.equal(secondCalls,0);assert.equal(next.metrics().networkAttempts,0);
});

test('host budget rejects before dispatch with its original identity',async()=>{
 const fifo=scheduler(),budget=Object.assign(Error('fixture budget'),{code:'CUMULATIVE_MODEL_BUDGET_EXHAUSTED'});let calls=0;
 const next=api(async()=>{calls++;return new Response(payload());},fifo.queue('worker-02'),{onAttempt:()=>{throw budget;}});
 await assert.rejects(next(messages,[]),e=>e===budget);assert.equal(calls,0);assert.equal(fifo.active,0);
});

test('nested slots are rejected rather than deadlocking',async()=>{
 const fifo=scheduler();
 await assert.rejects(queuedProviderFetch(SF,{}, {queue:fifo.queue('worker-02'),fetchImpl:()=>queuedProviderFetch(SF,{}, {queue:fifo.queue('worker-02'),fetchImpl:async()=>new Response('{}')})}),e=>e.code==='SF_QUEUE_NESTED');assert.equal(fifo.grants,1);assert.equal(fifo.active,0);
});

test('outer CLI lease marker fails closed rather than acquiring a second lease',async t=>{
 const previous=process.env.AFK_SILICONFLOW_WORKER;t.after(()=>{if(previous===undefined)delete process.env.AFK_SILICONFLOW_WORKER;else process.env.AFK_SILICONFLOW_WORKER=previous;});
 process.env.AFK_SILICONFLOW_WORKER='worker-02';const fifo=scheduler();let count=0;
 await assert.rejects(queuedProviderFetch(SF,{}, {queue:fifo.queue('worker-02'),fetchImpl:async()=>{count++;return new Response('{}');}}),e=>e.code==='SF_QUEUE_NESTED');assert.equal(count,0);assert.equal(fifo.grants,0);
});

test('missing worker identity fails closed before any shared queue or network access',async t=>{
 const previous=process.env.V8_SF_WORKER_ID;t.after(()=>{if(previous===undefined)delete process.env.V8_SF_WORKER_ID;else process.env.V8_SF_WORKER_ID=previous;});delete process.env.V8_SF_WORKER_ID;let count=0;
 await assert.rejects(queuedProviderFetch(SF,{}, {fetchImpl:async()=>{count++;return new Response('{}');}}),e=>e.code==='SF_QUEUE_ID_REQUIRED');assert.equal(count,0);
});

test('unavailable coordinator fails closed before any provider fetch',async t=>{
 const previous={module:process.env.V8_SF_SLOT_MODULE,worker:process.env.V8_SF_WORKER_ID};
 t.after(()=>{for(const [key,value]of [['V8_SF_SLOT_MODULE',previous.module],['V8_SF_WORKER_ID',previous.worker]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 process.env.V8_SF_SLOT_MODULE=path.join(temp(t),'nonexistent-slot.mjs');process.env.V8_SF_WORKER_ID='worker-02';let calls=0;
 await assert.rejects(queuedProviderFetch(SF,{}, {fetchImpl:async()=>{calls++;return new Response('{}');}}),e=>e.code==='SF_QUEUE_UNAVAILABLE');assert.equal(calls,0);
});

test('vision extraction and connection probe use the same queued boundary',async t=>{
 const root=temp(t),fifo=scheduler(),source=path.join(root,'fixture.png');fs.writeFileSync(source,Buffer.from('synthetic image fixture'));
 const vision={baseUrl:'https://api.siliconflow.cn/v1',model:'fixture-vision',apiKey:'synthetic',siliconflowQueue:fifo.queue('worker-02')};
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[source],python:'not-invoked',vision,fetchImpl:async()=>new Response(payload())});
 const asset=[...docs.assets.values()][0];Object.assign(asset,{kind:'image',format:'png',page:1});docs.inspect=async()=>asset;
 await docs.extract({asset_id:asset.id,question:'read synthetic'}, {signal:new AbortController().signal});assert.equal(fifo.grants,1);assert([...docs.results.values()][0].sfQueue.bodyFullyConsumed);
 const state={active:'cloud',profiles:{cloud:{chat:{...vision,model:'fixture-27b'}}}};
 const result=await ModelConnections.prototype.probe.call({state},{},async()=>new Response('{"data":[{"id":"fixture-27b"}]}'));
 assert.equal(result.connected,true);assert.equal(result.modelListed,true);assert.equal(fifo.grants,2);assert(result.sfQueue.bodyFullyConsumed);
});

test('real isolated web health route consumes model probe through the shared boundary',async t=>{
 const root=temp(t),fifo=scheduler(),chat={provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3.8-27B',apiKey:'synthetic-key'};
 const config={dataRoot:root,externalWorkspace:true,workspaceId:'external-siliconflow',chat};let count=0;
 const {server,workspace}=createWebServer(config,{startScheduler:false,modelProbeFetch:async(url,init)=>{count++;assert.equal(url,'https://api.siliconflow.cn/v1/models');assert.equal(init.headers.Authorization,'Bearer synthetic-key');return new Response('{"data":[]}');}});
 workspace.config.chat.siliconflowQueue=fifo.queue('worker-02');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/health')).json();assert.equal(result.connected,true);assert(result.sfQueue.bodyFullyConsumed);assert.equal(count,1);assert.equal(fifo.grants,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
