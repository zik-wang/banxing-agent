import https from 'node:https';import {StringDecoder} from 'node:string_decoder';
export function completionDecoder(){
 const decoder=new StringDecoder('utf8');let pending='',last={},content='',usage=null,finish=null,ended=false;const calls=new Map();
 function event(raw){for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;const text=line.slice(5).trim();if(text==='[DONE]'){ended=true;continue;}if(!text)continue;const x=JSON.parse(text);if(x.error)throw Error('Provider stream returned an error');last=x;if(x.usage)usage=x.usage;const c=x.choices?.[0];if(!c)continue;if(c.finish_reason)finish=c.finish_reason;const d=c.delta||{};content+=d.content||'';for(const t of d.tool_calls||[]){const key=t.index??0,v=calls.get(key)||{id:'',type:'function',function:{name:'',arguments:''}};v.id+=t.id||'';v.function.name+=t.function?.name||'';v.function.arguments+=t.function?.arguments||'';calls.set(key,v);}}}
 function consume(s){pending+=s;let end;while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}}
 return {write:b=>consume(decoder.write(b)),end:()=>{consume(decoder.end());if(pending.trim())event(pending);if(!finish)throw Error('Incomplete model stream without finish_reason');return {id:last.id,model:last.model,choices:[{index:0,message:{role:'assistant',content,...(calls.size?{tool_calls:[...calls.values()]}:{})},finish_reason:finish}],usage};}};
}
// Host opt-in only. No implicit provider fallback or unbounded timeout/retry.
export function streamingFetch(input,options={},requestImpl=https.request){
 const url=new URL(String(input));if(url.origin!=='https://api.siliconflow.cn'||options.method!=='POST'||typeof options.body!=='string')return globalThis.fetch(input,options);
 const body=JSON.stringify({...JSON.parse(options.body),stream:true,stream_options:{include_usage:true}});
 return new Promise((resolve,reject)=>{
  let settled=false;
  const req=requestImpl(url,{method:'POST',headers:options.headers,signal:options.signal,agent:false},res=>{
   const stream=/text\/event-stream/i.test(res.headers['content-type']||''),parser=stream?completionDecoder():null,chunks=[];let ended=false;
   const fail=error=>{if(settled)return;settled=true;if(res.statusCode===429){error.status=429;error.retry_after_seconds=res.headers['retry-after'];}if(ended||res.closed){reject(error);}else{res.once('close',()=>reject(error));res.destroy();}};
   res.on('data',b=>{if(settled)return;try{if(parser)parser.write(b);else chunks.push(b);}catch(e){fail(e);}});
   res.once('error',fail);
   res.once('aborted',()=>fail(Object.assign(Error('Provider stream aborted'),{code:'MODEL_STREAM_DISCONNECTED'})));
   res.once('close',()=>{if(!ended)fail(Object.assign(Error('Provider stream closed before end'),{code:'MODEL_STREAM_DISCONNECTED'}));});
   // A finish_reason or [DONE] is not the socket/body end. Keep the shared
   // request lease until all SSE bytes (including usage) have actually ended.
   res.once('end',()=>{ended=true;if(settled)return;try{const data=parser?JSON.stringify(parser.end()):Buffer.concat(chunks),headers=new Headers();for(const [key,value]of Object.entries(res.headers)){if(value!==undefined&&!['content-length','transfer-encoding'].includes(key))headers.set(key,Array.isArray(value)?value.join(', '):String(value));}headers.set('content-type','application/json');const response=new Response(data,{status:res.statusCode,headers});settled=true;resolve(response);}catch(e){fail(e);}});
  });
  req.once('error',error=>{if(!settled){settled=true;reject(error);}});req.end(body);
 });
}
