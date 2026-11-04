// Transport conversion only. No document parsing, task routing, answers or tools execute here.
import {randomUUID} from 'node:crypto';
export function contentParts(value){
 if(typeof value==='string')return value;if(value==null)return '';
 if(!Array.isArray(value))throw Error('Unsupported message content');
 const parts=value.map(p=>{
  if(['input_text','output_text','text'].includes(p.type))return{type:'text',text:p.text||''};
  if(p.type==='input_image')return{type:'image_url',image_url:{url:typeof p.image_url==='string'?p.image_url:p.image_url?.url}};
  if(p.type==='image_url')return p;
  throw Error('Unsupported content part: '+p.type);
 });return parts.every(p=>p.type==='text')?parts.map(p=>p.text).join('\n'):parts;
}
export function convertRequest(request,settings){
 const messages=[],names=new Map(),tools=[];
 if(request.instructions)messages.push({role:'system',content:request.instructions});
 for(const item of typeof request.input==='string'?[{role:'user',content:request.input}]:request.input||[]){
  if(item.type==='reasoning')continue;
  if(item.type==='function_call'){
   let last=messages.at(-1);if(last?.role!=='assistant'){last={role:'assistant',content:null};messages.push(last);}
   const name=item.namespace?item.namespace+'__'+item.name:item.name;
   (last.tool_calls??=[]).push({id:item.call_id,type:'function',function:{name,arguments:item.arguments||'{}'}});continue;
  }
  if(item.type==='function_call_output'){messages.push({role:'tool',tool_call_id:item.call_id,content:typeof item.output==='string'?item.output:JSON.stringify(item.output)});continue;}
  if(item.role){messages.push({role:item.role==='developer'?'system':item.role,content:contentParts(item.content)});continue;}
  throw Error('Unsupported Responses input: '+item.type);
 }
 function append(t,namespace){
  if(t.type==='namespace'){for(const child of t.tools||[])append(child,t.name);return;}
  if(t.type!=='function')throw Error('Unsupported tool type: '+t.type);
  const name=namespace?namespace+'__'+t.name:t.name;if(names.has(name))throw Error('Tool name collision');
  names.set(name,{name:t.name,...(namespace?{namespace}:{})});tools.push({type:'function',function:{name,description:t.description||'',parameters:t.parameters||{type:'object',properties:{}}}});
 }
 for(const t of request.tools||[])append(t);
 let choice=request.tool_choice||'auto';if(typeof choice==='object'){if(choice.type!=='function')throw Error('Unsupported tool choice');choice={type:'function',function:{name:choice.name}};}
 const compatible=[];
 for(const m of messages){const prev=compatible.at(-1);if(m.role==='system'&&compatible.some(x=>x.role!=='system'))throw Error('Provider cannot represent a mid-conversation system message');
  if(prev?.role===m.role&&['system','user'].includes(m.role)){
   if(typeof prev.content==='string'&&typeof m.content==='string')prev.content+='\n\n'+m.content;
   else {const parts=v=>typeof v==='string'?[{type:'text',text:v}]:v;prev.content=[...parts(prev.content),...parts(m.content)];}
  }else compatible.push(m);
 }
 return {names,body:{model:settings.model,messages:compatible,...(tools.length?{tools,tool_choice:choice}:{}),stream:false,temperature:settings.temperature,top_p:settings.topP,max_tokens:settings.maxTokens,enable_thinking:false}};
}
export function responseEnvelope(chat,names,maxTokens){
 const message=chat.choices?.[0]?.message;if(!message)throw Error('Provider returned no message');
 const output=[];if(message.content)output.push({id:'msg_'+randomUUID(),type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:message.content,annotations:[]}]});
 for(const call of message.tool_calls||[]){const name=names.get(call.function.name)||{name:call.function.name};output.push({id:'fc_'+randomUUID(),type:'function_call',status:'completed',call_id:call.id||'call_'+randomUUID(),...name,arguments:call.function.arguments||'{}'});}
 const u=chat.usage||{},truncated=chat.choices[0].finish_reason==='length';
 return {id:'resp_'+randomUUID(),object:'response',created_at:Math.floor(Date.now()/1000),status:truncated?'incomplete':'completed',error:null,incomplete_details:truncated?{reason:'max_output_tokens'}:null,model:chat.model,output,parallel_tool_calls:true,max_output_tokens:maxTokens,reasoning:{effort:'none',summary:null},usage:{input_tokens:u.prompt_tokens??0,output_tokens:u.completion_tokens??0,total_tokens:u.total_tokens??0,input_tokens_details:{cached_tokens:u.prompt_tokens_details?.cached_tokens??0},output_tokens_details:{reasoning_tokens:u.completion_tokens_details?.reasoning_tokens??0}}};
}
export function responseEvents(response){
 const events=[],add=(type,fields)=>events.push({type,sequence_number:events.length,...fields});
 const pending={...response,status:'in_progress',output:[],usage:null};add('response.created',{response:pending});add('response.in_progress',{response:pending});
 response.output.forEach((item,output_index)=>{
  add('response.output_item.added',{output_index,item:{...item,status:'in_progress',...(item.type==='message'?{content:[]}:{arguments:''})}});
  if(item.type==='message')item.content.forEach((part,content_index)=>{
   add('response.content_part.added',{item_id:item.id,output_index,content_index,part:{...part,text:''}});
   add('response.output_text.delta',{item_id:item.id,output_index,content_index,delta:part.text});
   add('response.output_text.done',{item_id:item.id,output_index,content_index,text:part.text});
   add('response.content_part.done',{item_id:item.id,output_index,content_index,part});
  });
  else {add('response.function_call_arguments.delta',{item_id:item.id,output_index,delta:item.arguments});add('response.function_call_arguments.done',{item_id:item.id,output_index,arguments:item.arguments});}
  add('response.output_item.done',{output_index,item});
 });
 add(response.status==='completed'?'response.completed':'response.incomplete',{response});return events;
}
