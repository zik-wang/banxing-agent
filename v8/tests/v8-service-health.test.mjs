import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {ServiceHealthTools} from '../v8-tools/service-health-tools.mjs';
import {CATALOG_URL,SERVICE_IDS} from '../intranet.mjs';
function root(t){const p=path.resolve('qa-output/health-test-temp');fs.mkdirSync(p,{recursive:true});const x=fs.mkdtempSync(path.join(p,'case-'));t.after(()=>fs.rmSync(x,{recursive:true,force:true}));return x;}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('fixed read-only probes use configured current models and retain real receipts without credentials',async t=>{
 const directory=root(t),requests=[],key='test-secret-never-show';const tools=new ServiceHealthTools({directory},{chat:{baseUrl:'http://10.0.0.32:8861/v1',model:'configured-chat',apiKey:key},vision:{baseUrl:'http://10.0.0.94:8080/v1',model:'configured-vision'},fetchImpl:async(url,options)=>{requests.push({url,method:options.method});if(url===CATALOG_URL+'/services')return json({items:[{id:SERVICE_IDS.asr,auth:'none',selected_base_url:'http://10.0.0.32:6001'}]});if(url.endsWith('/health/ready'))return json({status:'ready',id:'actual-asr'});return json({data:[{id:url.includes('8861')?'configured-chat':'configured-vision'}],api_key:key});}});
 const result=await tools.inspect(new AbortController().signal);assert(result.modelsReady);assert.equal(requests.length,4);assert(requests.every(r=>r.method==='GET'));assert.equal(result.gpuMetrics,null);assert.equal(result.diskMetrics,null);assert(!result.checks.some(c=>c.payload));const receipt=fs.readFileSync(result.receipt,'utf8');assert(!receipt.includes(key));assert(receipt.includes('[REDACTED]'));
});
test('untrusted catalog origins and unavailable catalog never become ready ASR',async t=>{
 for(const remote of [true,false]){
  const directory=root(t),requests=[];const tools=new ServiceHealthTools({directory},{chat:{baseUrl:'http://10.0.0.32:8861/v1',model:'chat'},vision:{baseUrl:'http://10.0.0.94:8080/v1',model:'vision'},fetchImpl:async url=>{requests.push(url);if(url===CATALOG_URL+'/services')return remote?json({items:[{id:SERVICE_IDS.asr,auth:'none',selected_base_url:'http://public.invalid:8000'}]}):json({error:'down'},503);return json({data:[{id:url.includes('8861')?'chat':'vision'}]});}});
  const result=await tools.inspect();assert.equal(result.modelsReady,false);assert(!requests.some(url=>url.includes('public.invalid')));
 }
});
test('no arbitrary URL argument or destructive action is registered',t=>{const tool=new ServiceHealthTools({directory:root(t)}).tools()[0];assert.deepEqual(tool.inputSchema.properties,{});assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.name,'inspect_intranet_services');});
