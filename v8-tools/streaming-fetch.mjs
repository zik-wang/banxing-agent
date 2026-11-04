import https from 'node:https';import {StringDecoder} from 'node:string_decoder';
export function completionDecoder(){
 const decoder=new StringDecoder('utf8');let pending='',last={},content='',usage=null,finish=null,ended=false;const calls=new Map();
 function event(raw){for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;const text=line.slice(5).trim();if(text==='[DONE]'){ended=true;continue;}if(!text)continue;const x=JSON.parse(text);if(x.error)throw Error('Provider stream returned an error');last=x;if(x.usage)usage=x.usage;const c=x.choices?.[0];if(!c)continue;if(c.finish_reason)finish=c.finish_reason;const d=c.delta||{};content+=d.content||'';for(const t of d.tool_calls||[]){const key=t.index??0,v=calls.get(key)||{id:'',type:'function',function:{name:'',arguments:''}};v.id+=t.id||'';v.function.name+=t.function?.name||'';v.function.arguments+=t.function?.arguments||'';calls.set(key,v);}}}
 function consume(s){pending+=s;let end;while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}}
 return {write:b=>consume(decoder.write(b)),end:()=>{consume(decoder.end());if(pending.trim())event(pending);if(!finish)throw Error('Incomplete model stream without finish_reason');return {id:last.id,model:last.model,choices:[{index:0,message:{role:'assistant',content,...(calls.size?{tool_calls:[...calls.values()]}:{})},finish_reason:finish}],usage};}};
}
// Host opt-in only. No implicit provider fallback or unbounded timeout/retry.
export function streamingFetch(input,options={}){
 const url=new URL(String(input));if(url.origin!=='https://api.siliconflow.cn'||options.method!=='POST'||typeof options.body!=='string')return globalThis.fetch(input,options);
 const body=JSON.stringify({...JSON.parse(options.body),stream:true,stream_options:{include_usage:true}});
 return new Promise((resolve,reject)=>{const req=https.request(url,{method:'POST',headers:options.headers,signal:options.signal,agent:false},res=>{const stream=/text\/event-stream/i.test(res.headers['content-type']||''),parser=stream?completionDecoder():null,chunks=[];res.on('data',b=>{try{if(parser)parser.write(b);else chunks.push(b);}catch(e){res.destroy(e);}});res.once('error',reject);res.once('end',()=>{try{const data=parser?JSON.stringify(parser.end()):Buffer.concat(chunks);resolve(new Response(data,{status:res.statusCode,headers:{'content-type':'application/json'}}));}catch(e){reject(e);}});});req.once('error',reject);req.end(body);});
}
