import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
if(process.env.V8_SF_PROCESS_TEST!=='1'||!process.env.BOARD_DATA||!process.env.BOARD_PORT)throw Error('TEST_ISOLATION_REQUIRED');
const load=name=>import(pathToFileURL(path.join(process.env.V8_SF_TEST_SHARED_ROOT,name)).href);
const {init,read,write}=await load('core.mjs');
const {policy}=await load('control.mjs');
const {SiliconflowQueue}=await load('siliconflow-queue.mjs');
const root=process.env.BOARD_DATA,credentials=init(),journal=path.join(root,'events.jsonl');
let offset=0,sequence=0,active=0,maximum=0;
const settings=new Map();
const event=(kind,detail={})=>fs.appendFileSync(journal,JSON.stringify({sequence:++sequence,at:Date.now(),clock:Date.now()+offset,kind,...detail})+'\n');
const queue=new SiliconflowQueue({load:()=>read(path.join(root,'siliconflow-queue.json')),save:s=>write(path.join(root,'siliconflow-queue.json'),s),now:()=>Date.now()+offset,gapMs:20,allowed:()=>!policy().paused});
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(obj));};
const board=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/api/siliconflow'&&req.method==='GET')return json(res,200,queue.status());
  let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):{};
  if(req.url.startsWith('/test/')){
   if(req.headers.authorization!=='Bearer synthetic-test-control-only')return json(res,403,{});
   if(req.url==='/test/config')settings.set(data.worker,data);
   else if(req.url==='/test/clock'){if(!(data.advanceMs>=0))throw Error('clock must advance');offset+=data.advanceMs;event('test_clock_advanced',{advanceMs:data.advanceMs});}
   else if(req.url==='/test/control'){write(path.join(root,'run-control.json'),{mode:data.mode||'running',deadline:data.expired?new Date(Date.now()-1000).toISOString():new Date(Date.now()+120000).toISOString(),reason:'isolated synthetic test'});event('test_control',{mode:data.mode,expired:!!data.expired});}
   else throw Error('unknown test route');
   return json(res,200,queue.status());
  }
  const action=req.url.match(/^\/api\/siliconflow\/(acquire|release|heartbeat|cancel|cooldown|drained)$/)?.[1];
  if(!action)return json(res,404,{});
  if(req.headers.authorization!=='Bearer '+credentials.workers[data.worker_id])return json(res,403,{});
  const value=queue.act(action,data);
  event('queue_'+action,{worker:data.worker_id,granted:!!value.granted,outcome:data.outcome||null,cooldownMs:value.cooldown_remaining_ms,activeWorker:value.active?.worker_id||null});
  json(res,200,value);
 }catch(e){json(res,409,{error:e.message});}
});
const upstream=http.createServer(async(req,res)=>{
 const worker=req.headers['x-test-worker'],setting=settings.get(worker)||{};
 let raw='';for await(const chunk of req)raw+=chunk;
 if(req.headers.authorization!=='Bearer synthetic-model-only'||JSON.parse(raw).model!=='synthetic-27b')return json(res,403,{});
 active++;maximum=Math.max(maximum,active);event('upstream_start',{worker,mode:setting.mode,active,maximum});
 let ended=false;res.once('close',()=>{active--;event(ended?'upstream_closed':'upstream_disconnect',{worker,active});});
 const status=setting.status||200;
 const body=JSON.stringify(status===429?{error:{message:'synthetic limited'}}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'synthetic result'}}]});
 res.writeHead(status,{'content-type':setting.mode==='sse'?'text/event-stream':'application/json',...(status===429?{'retry-after':'120'}:{})});
 if(setting.mode==='sse')res.write('data: '+JSON.stringify({choices:[{delta:{content:'synthetic result'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');else res.write(body.slice(0,8));
 event('upstream_partial_body',{worker});
 setTimeout(()=>{
  if(setting.mode==='disconnect'){req.socket.destroy();return;}
  ended=true;event('upstream_body_end',{worker});
  res.end(setting.mode==='sse'?'data: '+JSON.stringify({choices:[],usage:{total_tokens:7}})+'\n\n':body.slice(8));
 },setting.delayMs??100);
});
await new Promise(r=>board.listen(Number(process.env.BOARD_PORT),'127.0.0.1',r));
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
process.send?.({type:'ready',boardPort:board.address().port,upstreamPort:upstream.address().port});
process.on('message',message=>{if(message==='shutdown'){upstream.closeAllConnections();board.closeAllConnections();upstream.close(()=>board.close(()=>process.exit(0)));}});
