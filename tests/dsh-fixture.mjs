import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function temporary(t,prefix='v4-dsh-'){
  const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,prefix));
  t.after(()=>{if(path.dirname(path.resolve(dir))!==root||!path.basename(dir).startsWith(prefix))throw Error('测试清理目录无效');fs.rmSync(dir,{recursive:true,force:true});});return dir;
}
export const call=(name,args={})=>({name,arguments:args});
// A local OpenAI-compatible SSE peer. Only model output is scripted; the real
// official DSH loop, adapter, schemas, business handlers and artifacts execute.
export async function modelFixture(t,respond){
  const requests=[];let serial=0;
  const server=http.createServer(async(req,res)=>{try{
    const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    const reply=await respond(body,requests.length,req);
    if(reply?.status){res.writeHead(reply.status,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:reply.error||'fixture error'}}));}
    if(res.destroyed)return;
    const id='fixture-'+(++serial),base={id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:body.model};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=x=>res.write('data: '+JSON.stringify({...base,...x})+'\n\n');
    emit({choices:[{index:0,delta:{role:'assistant',...(reply?.calls?{tool_calls:reply.calls.map((c,index)=>({index,id:'call_'+serial+'_'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.arguments)}}))}:{content:reply?.text??'处理完成。'})},finish_reason:null}]});
    emit({choices:[{index:0,delta:{},finish_reason:reply?.finish||(reply?.calls?'tool_calls':'stop')}],usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17}});
    res.end('data: [DONE]\n\n');
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error.message));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const baseUrl='http://127.0.0.1:'+server.address().port;
  return {requests,baseUrl,connection:{modelName:'fixture-qwen',label:'本机模拟模型',baseUrl:baseUrl+'/v1',apiKey:'local-keyless'},directory:{services:{chat:{ready:true}},get:()=>({baseUrl,model:'fixture-qwen'})}};
}
export async function waitFor(predicate,ms=10000){const until=Date.now()+ms;while(!predicate()){if(Date.now()>until)throw Error('测试等待超时');await new Promise(resolve=>setTimeout(resolve,10));}}
