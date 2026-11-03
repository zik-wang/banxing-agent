import http from'node:http';import fs from'node:fs';import path from'node:path';import{randomUUID}from'node:crypto';import{convertRequest,responseEnvelope,responseEvents}from'./protocol.mjs';
import{setTimeout as sleep}from'node:timers/promises';
const [manifestFile,keyFile]=process.argv.slice(2);if(!manifestFile||!keyFile)throw Error('Usage: gateway.mjs manifest.json api-key-file.json');
const manifest=JSON.parse(fs.readFileSync(manifestFile)),secret=JSON.parse(fs.readFileSync(keyFile)).apiKey,settings=manifest.settings,root=path.dirname(manifestFile),counts=new Map();
if(settings.endpoint!=='https://api.siliconflow.cn/v1'||settings.model!=='Qwen/Qwen3.8-27B')throw Error('Experiment provider/model mismatch');
const redact=x=>String(x).split(secret).join('[REDACTED]');
for(const framework of ['harness','codex'])for(const c of manifest.cases){const dir=path.join(root,'api',framework,'s'+c.id);if(fs.existsSync(dir)){const previous=fs.readdirSync(dir).filter(f=>f.endsWith('.receipt.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));counts.set(framework+'-'+c.id,Math.max(0,...previous.map(r=>r.requestNumber||0)));}}
let active=0;const queue=[];async function acquire(){if(active>=2)await new Promise(r=>queue.push(r));active++;}function release(){active--;queue.shift()?.();}
const reservations=[];
async function pace(body,record,signal){const budget=settings.estimatedTokensPerMinute;if(!budget)return;const began=Date.now(),estimate=Math.ceil(JSON.stringify(body).length/2)+settings.maxTokens,charge=Math.min(budget,estimate);record.estimatedTokens=estimate;record.singleEstimateAbovePacingBudget=estimate>budget;
 for(;;){if(signal.aborted)throw signal.reason;const now=Date.now();while(reservations.length&&now-reservations[0].at>=61000)reservations.shift();if(reservations.reduce((n,r)=>n+r.tokens,0)+charge<=budget){reservations.push({at:now,tokens:charge});break;}await sleep(Math.min(5000,Math.max(100,61050-(now-reservations[0].at))),undefined,{signal});}
 record.pacingWaitMs=Date.now()-began;
}
http.createServer(async(req,res)=>{
 const route=req.url.match(/^\/(harness|codex)\/s(11|15|19)\/v1\/(chat\/completions|responses|models)$/);
 if(!route){res.writeHead(404);res.end();return;}
 const [,framework,caseId,kind]=route,controller=new AbortController(),started=Date.now(),id=randomUUID(),dir=path.join(root,'api',framework,'s'+caseId);fs.mkdirSync(dir,{recursive:true});
 const record={id,framework,caseId,kind,startedAt:new Date().toISOString(),sampling:settings,protocolTranslation:kind==='responses'};let timer,heartbeat,locked=false;
 const finish=()=>{clearTimeout(timer);clearInterval(heartbeat);record.elapsedMs=Date.now()-started;fs.writeFileSync(path.join(dir,id+'.receipt.json'),JSON.stringify(record,null,2));if(locked)release();};
 res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 try{
  if(kind==='models'){const r=await fetch(settings.endpoint+'/models',{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(10000)});res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;}
  let bytes=Buffer.alloc(0);for await(const b of req){bytes=Buffer.concat([bytes,b]);if(bytes.length>8*1024*1024)throw Error('Experiment request exceeds 8MiB');}
  const request=JSON.parse(bytes);if(request.model!==settings.model)throw Error('Requested model differs from frozen model');
  const tag=framework+'-'+caseId,n=(counts.get(tag)||0)+1;counts.set(tag,n);record.requestNumber=n;
  if(n>settings.maxRequestsPerRun){record.localBudgetRefusal=true;res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'LOCAL_EXPERIMENT_BUDGET; not SiliconFlow rate limit'}}));return;}
  let names=new Map(),body;
  if(kind==='responses')({names,body}=convertRequest(request,settings));
  else body={...request,model:settings.model,stream:false,temperature:settings.temperature,top_p:settings.topP,max_tokens:settings.maxTokens,enable_thinking:false};
  fs.writeFileSync(path.join(dir,id+'.client-request.json'),JSON.stringify(request,null,2));fs.writeFileSync(path.join(dir,id+'.upstream-request.json'),JSON.stringify(body,null,2));
  await acquire();locked=true;timer=setTimeout(()=>controller.abort(),settings.singleCallTimeoutMs);
  if(kind==='responses'&&request.stream){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': waiting for same SiliconFlow model\n\n');heartbeat=setInterval(()=>res.write(': still waiting\n\n'),10000);}
  await pace(body,record,controller.signal);record.networkRequestAttempted=true;const r=await fetch(settings.endpoint+'/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const raw=redact(await r.text());record.httpStatus=r.status;record.rateHeaders=Object.fromEntries([...r.headers].filter(([k])=>/ratelimit|retry-after/i.test(k)));fs.writeFileSync(path.join(dir,id+'.upstream-response.json'),raw);
  let data;try{data=JSON.parse(raw)}catch{throw Error('Provider returned invalid JSON')};record.usage=data.usage;record.providerModel=data.model;record.finishReason=data.choices?.[0]?.finish_reason;
  if(!r.ok){record.providerFailure=true;if(!res.headersSent){res.writeHead(r.status,{'Content-Type':'application/json'});res.end(raw);}else{res.write('event: error\ndata: '+JSON.stringify({type:'error',message:'SiliconFlow HTTP '+r.status,error:data.error})+'\n\n');res.end();}return;}
  if(kind==='responses'){
   const envelope=responseEnvelope(data,names,settings.maxTokens);fs.writeFileSync(path.join(dir,id+'.adapted-response.json'),JSON.stringify(envelope,null,2));
   if(request.stream){for(const e of responseEvents(envelope))res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');res.end();}
   else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(envelope));}
  }else{res.writeHead(r.status,{'Content-Type':'application/json'});res.end(raw);}
  record.completed=true;
 }catch(e){record.error={name:e.name,message:redact(e.message)};if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:record.error.message}}));}else if(!res.writableEnded){res.write('event: error\ndata: '+JSON.stringify({type:'error',message:record.error.message})+'\n\n');res.end();}}
 finally{finish();}
}).listen(Number(process.argv[4])||manifest.port,'127.0.0.1',()=>console.log('Experiment gateway listening on loopback port '+(Number(process.argv[4])||manifest.port)));
