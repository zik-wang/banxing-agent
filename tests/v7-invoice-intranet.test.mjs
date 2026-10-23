import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateInvoiceRuntimeConfig,invoiceModelConnection,assertInvoiceScope,assertTextOnlyAnalysis} from '../invoice-runtime.mjs';
import {ConfiguredIntranetDirectory} from '../configured-intranet.mjs';
import {runDeepSeek} from '../deepseek-runtime.mjs';
import {modelFixture} from './dsh-fixture.mjs';
const c={version:'v7-invoice-intranet-local-1',enabled:true,chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'qwen3.8-27b-fp8',auth:{type:'none'},images:false},python:path.resolve('python'),libraries:path.resolve('libraries'),ocr:{model:'OpenDataLab/MinerU2.5-Pro-2605-1.2B',modelPath:path.resolve('weights')},allowedOriginalSha256:['a'.repeat(64)]};
test('09内网固定端点与真实型号，拒绝外网、路径变体、认证猜测及跨版本偷换',()=>{
 assert.deepEqual(validateInvoiceRuntimeConfig(c),c);
 for(const chat of [{...c.chat,baseUrl:'https://api.siliconflow.cn/v1'},{...c.chat,baseUrl:'http://10.0.0.32:8861/v1?x=1'},{...c.chat,baseUrl:'http://10.0.0.32:8861/v1/'},{...c.chat,model:'qwen36-27b-fp8'},{...c.chat,auth:{type:'env'}},{...c.chat,images:true}])assert.throws(()=>validateInvoiceRuntimeConfig({...c,chat}));
 assert.throws(()=>validateInvoiceRuntimeConfig({...c,version:'v7-invoice-cloud-local-1'}));
});
test('09内网不读取云端凭据，不带云端专属思考开关',()=>{
 const connection=invoiceModelConnection({...c,chat:{...c.chat,envFile:path.resolve('does-not-exist.env')}});
 assert.equal(connection.provider,'qwen');assert.equal(connection.apiKey,'local-keyless');assert.equal(connection.invoiceTextOnly,undefined);assert.equal(connection.baseUrl,c.chat.baseUrl);
});
test('内网迁移不扩大原件授权或图像通道',()=>{
 assert.doesNotThrow(()=>assertInvoiceScope(c,['a'.repeat(64)]));assert.throws(()=>assertInvoiceScope(c,['b'.repeat(64)]));
 assert.throws(()=>assertTextOnlyAnalysis({kind:'invoice-evidence',documents:[{text:'synthetic',image_url:'image'}]}));
});
test('09实际Harness内网协议发送chat_template_kwargs，未使用云端顶层enable_thinking',async t=>{
 const peer=await modelFixture(t,body=>{assert.deepEqual(body.chat_template_kwargs,{enable_thinking:false});assert.equal(body.enable_thinking,undefined);return {text:'INTRANET_FIXTURE_OK'};});
 const chat=peer.directory.get('chat');const result=await runDeepSeek({connection:{...invoiceModelConnection(c),baseUrl:chat.baseUrl+'/v1',modelName:chat.model},systemPrompt:'synthetic',request:'synthetic',maxTokens:40,timeoutMs:10000});assert.equal(result.answer,'INTRANET_FIXTURE_OK');
});
const directoryConfig={version:'v7-intranet-1',chat:{...c.chat,analysisMode:'structured-json'},local:{},dataDirectory:path.resolve('data')};
test('主服务内网目录只查固定内网模型，不触碰云端凭据或外网',async()=>{
 const calls=[],directory=new ConfiguredIntranetDirectory(directoryConfig,{localMedia:{status:()=>({ocr:{ready:true}})},readCredentials:()=>assert.fail('cloud credentials read'),fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return new Response(JSON.stringify({data:[{id:c.chat.model}]}));}});
 await directory.refresh();assert.deepEqual(calls,[c.chat.baseUrl+'/models']);assert.equal(directory.connection().provider,'qwen');assert.equal(directory.status().publicCloudEnabled,false);assert.equal(directory.get('ocr').ready,true);
});
test('内网断线保持失败，不偷偷回云端，本地OCR仍可用',async()=>{
 let calls=0;const directory=new ConfiguredIntranetDirectory(directoryConfig,{localMedia:{status:()=>({ocr:{ready:true}})},fetchImpl:async()=>{calls++;throw Error('synthetic disconnect');}});
 await directory.refresh();assert.equal(calls,1);assert.throws(()=>directory.connection());assert.equal(directory.get('ocr').ready,true);assert.equal(directory.status().publicCloudEnabled,false);
});

test('09内网连接继承已配置的结构化模式与预算，未知输出模式拒绝',()=>{
 const inference={temperature:0.1,max_output_tokens:6500,context_budget_tokens:28000},connection=invoiceModelConnection({...c,chat:{...c.chat,analysisMode:'structured-json',inference}});
 assert.equal(connection.analysisMode,'structured-json');assert.deepEqual(connection.inference,inference);assert.throws(()=>invoiceModelConnection({...c,chat:{...c.chat,analysisMode:'invented'}}));
});

test('主体占位词不成为名称，但真实名称含相同字样仍可采用',async()=>{
 const {canonical,makeSource,validateCandidate}=await import('../invoice-evidence.mjs');
 for(const value of ['未知','不详','未识别','空白','无','unknown','N/A','not specified','unreadable','—'])for(const f of ['buyer','seller'])assert.equal(canonical(f,value),null);
 assert.equal(canonical('buyer','未知科技有限公司'),'未知科技有限公司');assert.equal(canonical('seller','Unknown Ventures LLC'),'Unknown Ventures LLC');
 const source=makeSource({id:'synthetic',sha256:'a'.repeat(64)},'ocr','购买方：未知');assert.equal(validateCandidate({field:'buyer',value:'未知',sourceId:source.id,quote:source.text},[source]).accepted,false);
});
test('视觉生成的主体角色须有另一读者角色支持，船名/账户上下文不能冒充销售方',async()=>{
 const {makeSource,validateCandidate}=await import('../invoice-evidence.mjs'),file={id:'synthetic',sha256:'a'.repeat(64)};
 const ocr=makeSource(file,'ocr','# 测试船舶ABC20260101\n账户名称：测试供应商有限公司'),vision=makeSource(file,'vision','销售方名称：测试船舶ABC20260101');
 const candidate={field:'seller',value:'测试船舶ABC20260101',sourceId:vision.id,quote:vision.text};const result=validateCandidate(candidate,[ocr,vision]);assert.equal(result.accepted,false);assert.equal(result.reason,'vision_role_requires_source_support');assert(result.evidence);
});
test('角色明确时两读者不同名称仍进入冲突，相同名称可交叉核对',async()=>{
 const {makeSource,validateCandidate,resolveFields}=await import('../invoice-evidence.mjs'),file={id:'synthetic',sha256:'a'.repeat(64)};
 for(const same of [false,true]){const ocr=makeSource(file,'ocr','销售方：甲方测试有限公司'),vision=makeSource(file,'vision','销售方：'+(same?'甲方测试有限公司':'乙方测试有限公司')),sources=[ocr,vision];const cs=sources.map(s=>validateCandidate({field:'seller',value:s===ocr||same?'甲方测试有限公司':'乙方测试有限公司',sourceId:s.id,quote:s.text},sources));assert(cs.every(c=>c.accepted));const fields=resolveFields(cs);assert.equal(fields.seller.status,same?'corroborated':'conflict');if(!same)assert.equal(fields.seller.value,null);}
});
