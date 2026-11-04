import https from 'node:https';import {StringDecoder} from 'node:string_decoder';import {streamingFetch} from '../../v8-tools/streaming-fetch.mjs';
// Diagnostic counters only: never copy headers, content, reasoning or arguments.
export function observedStreamingFetch(record,save=()=>{},requestImpl=https.request){
 return(input,options)=>{const started=Date.now();record.upstreamTransport='https-sse-agent-false';record.stream={bytes:0,events:0,contentChars:0,reasoningChars:0,toolArgumentChars:0,doneSeen:false};let lastSaved=0;
  const persist=force=>{if(force||Date.now()-lastSaved>1000){lastSaved=Date.now();try{save(record.stream);}catch{/* Observation cannot replace a model response. */}}};
  const request=(url,opts,onResponse)=>requestImpl(url,opts,res=>{
   const decoder=new StringDecoder('utf8');let pending='';Object.assign(record.stream,{httpStatus:res.statusCode,headersMs:Date.now()-started,sse:/text\/event-stream/i.test(res.headers['content-type']||'')});persist(true);
   const line=s=>{if(!s.startsWith('data:'))return;const value=s.slice(5).trim();if(value==='[DONE]'){record.stream.doneSeen=true;return;}if(!value)return;try{const x=JSON.parse(value),c=x.choices?.[0],d=c?.delta||{};record.stream.events++;if(x.model)record.stream.modelId=x.model;record.stream.contentChars+=(d.content||'').length;record.stream.reasoningChars+=(d.reasoning_content||'').length;record.stream.toolArgumentChars+=(d.tool_calls||[]).reduce((n,t)=>n+(t.function?.arguments||'').length,0);if(c?.finish_reason)record.stream.finishReason=c.finish_reason;}catch{record.stream.observerParseErrors=(record.stream.observerParseErrors||0)+1;}};
   res.on('data',b=>{record.stream.bytes+=b.length;record.stream.firstByteMs??=Date.now()-started;record.stream.lastByteMs=Date.now()-started;if(record.stream.sse){pending+=decoder.write(b);const lines=pending.split(/\r?\n/);pending=lines.pop();for(const text of lines)line(text);}persist(record.stream.doneSeen);});
   res.on('end',()=>{pending+=decoder.end();if(pending.trim())line(pending.trim());record.stream.httpEnded=true;persist(true);});res.on('error',()=>persist(true));onResponse(res);
  });return streamingFetch(input,options,request);
 };
}
