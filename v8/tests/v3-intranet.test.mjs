import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ServiceDirectory,SERVICE_IDS,validateServiceUrl,readJson} from '../intranet.mjs';
import {recognizeIntranet,transcribeIntranet} from '../intranet-media.mjs';
import {findFfmpeg} from '../audio-decode.mjs';
import {Store} from '../core.mjs';
import {addWorkspaceFile} from '../workspace-files.mjs';
import {Workspace} from '../workspace.mjs';
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function directoryFixture(){const calls=[],catalog={items:Object.entries(SERVICE_IDS).map(([kind,id],index)=>({id,name:kind,auth:'none',selected_base_url:'http://10.0.0.'+(index===0?'93:5055':index===1?'32:6001':'32:8010')}))};const directory=new ServiceDirectory(async(url,options)=>{calls.push({url,options});if(url.endsWith('/services'))return response(catalog);if(url.endsWith('/v1/models'))return response({data:[{id:'qwen36-27b-fp8'}]});return response(url.endsWith('/health/ready')?{status:'ready',id:'Qwen/Qwen3-ASR-1.7B'}:{status:'healthy',version:'fixture'});});return {directory,calls,catalog};}
function storeFixture(t){const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,'agent-v3-test-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),root);assert(path.basename(dir).startsWith('agent-v3-test-'));fs.rmSync(dir,{recursive:true,force:true});});return new Store(dir);}

test('只接受指定内网服务地址，拒绝公网、凭据和可跳转路径',()=>{assert.equal(validateServiceUrl('http://10.0.0.32:6001/'),'http://10.0.0.32:6001');for(const url of ['https://example.com','http://127.0.0.1:8080','http://10.0.0.32:6001/private','http://user:pass@10.0.0.32:6001','http://10.0.0.32:6001/?x=1'])assert.throws(()=>validateServiceUrl(url));});
test('目录发现只探测选定三项，禁止重定向，不传任何云端密钥',async()=>{const {directory,calls}=directoryFixture();await Promise.all([directory.refresh(),directory.refresh()]);assert.equal(calls.length,4);assert.equal(directory.get('chat').model,'qwen36-27b-fp8');assert.equal(directory.get('asr').model,'Qwen/Qwen3-ASR-1.7B');assert(calls.every(c=>c.options.redirect==='error'&&!c.options.headers));assert.equal(directory.status().searchEnabled,false);});
test('目录失效后暂停旧地址调用，不自动寻找公网替代',async()=>{const {directory}=directoryFixture();await directory.refresh();directory.fetch=async()=>{throw Error('目录断开');};await directory.refresh();assert.throws(()=>directory.get('chat'),/未就绪/);assert.equal(directory.services.chat.ready,false);});

test('目录没有OCR条目时改探测固定MinerU地址，不拖垮聊天和ASR',async()=>{const {directory,catalog}=directoryFixture();catalog.items=catalog.items.filter(x=>x.id!==SERVICE_IDS.ocr);await directory.refresh();assert.equal(directory.get('chat').model,'qwen36-27b-fp8');assert.equal(directory.services.asr.ready,true);assert.equal(directory.services.ocr.ready,true);assert.equal(directory.services.ocr.baseUrl,'http://10.0.0.32:8010');assert.match(directory.services.ocr.model,/MinerU/);});
test('固定MinerU地址无响应时只让OCR未就绪',async()=>{const {directory,catalog}=directoryFixture();catalog.items=catalog.items.filter(x=>x.id!==SERVICE_IDS.ocr);const inner=directory.fetch;directory.fetch=async(url,options)=>{if(String(url).startsWith('http://10.0.0.32:8010'))throw Error('连接失败');return inner(url,options);};await directory.refresh();assert.equal(directory.services.asr.ready,true);assert.equal(directory.services.ocr.ready,false);assert.throws(()=>directory.get('ocr'),/未就绪/);});

test('TTS健康但音色为空时标不可用，配置音色后重新检查恢复',async()=>{let voices=[];const directory=new ServiceDirectory(async url=>url.endsWith('/services')?response({items:[{id:'node-94--cosyvoice3-api--p50000',selected_base_url:'http://10.0.0.94:50000',auth:'none'}]}):response(url.endsWith('/speakers')?{speakers:voices}:{ready:true}));await directory.discoverMore();const first=directory.capabilities.find(c=>c.kind==='tts');assert.equal(first.ready,false);assert.match(first.error,/音色/);voices=['configured-fixture-voice'];await directory.discoverMore();assert.equal(directory.capabilities.find(c=>c.kind==='tts').ready,true);});
test('API响应严格要求JSON且有大小上限，保留HTTP错误',async()=>{await assert.rejects(readJson(new Response('<html>not API</html>')),/有效JSON/);await assert.rejects(readJson(response({content:'long result'}),3),/过大/);await assert.rejects(readJson(new Response('{"error":"unavailable"}',{status:503})),/503/);});
test('OCR仅上传原件到MinerU，保留原图页码来源，不跟随返回的结果URL',async t=>{const store=storeFixture(t),file=await addWorkspaceFile(store,{name:'fixture.png',base64:Buffer.from('fixture-image').toString('base64')}),{directory}=directoryFixture();await directory.refresh();let called=0;directory.fetch=async(url,options)=>{called++;assert.equal(url,'http://10.0.0.32:8010/file_parse');assert.equal(options.body.get('backend'),'vlm-engine');assert.equal(options.body.get('return_images'),'false');assert.equal(options.headers,undefined);assert.equal(await options.body.get('files').text(),'fixture-image');return response({status:'completed',task_id:'fixture-task',result_url:'https://example.com/not-followed',results:{source:{md_content:'价税合计：128.50',content_list:JSON.stringify([{text:'价税合计：128.50',page_idx:0,bbox:[0,0,10,10]}])}}});};const result=await recognizeIntranet(store,directory,file,new AbortController().signal);assert.equal(called,1);assert.equal(result.records[0].page,1);assert.equal(result.remoteTaskId,'fixture-task');});
test('超过数兆字节的录音可以入库，不因编码校验栈溢出',async t=>{
  const store=storeFixture(t),bytes=Buffer.alloc(7*1024*1024,7);
  const file=await addWorkspaceFile(store,{name:'光华大道+18.m4a',base64:bytes.toString('base64')});
  assert.equal(file.parseStatus,'audio');assert.equal(file.bytes,bytes.length);assert.equal(file.name,'光华大道+18.m4a');
  await assert.rejects(addWorkspaceFile(store,{name:'坏录音.m4a',base64:'A'.repeat(8*1024*1024)+'!!!!'}),/编码不合法/);
});
test('常见录音格式可入库，非PCM录音会交给内网ASR',async t=>{
  const store=storeFixture(t),names=['memo.m4a','voice.amr','clip.flac','note.ogg','talk.aac','rec.wma','a.opus','b.aiff','c.webm','d.mp4','e.mka','f.3gp'];
  for(const name of names)assert.equal((await addWorkspaceFile(store,{name,base64:Buffer.from('not-really-'+name).toString('base64')})).parseStatus,'audio');
  await assert.rejects(addWorkspaceFile(store,{name:'bad.exe',base64:Buffer.from('x').toString('base64')}));
  const file=store.state.workspaceFiles[0],{directory}=directoryFixture();await directory.refresh();
  directory.fetch=async(url,options)=>{assert.equal(url,'http://10.0.0.32:6001/v1/audio/transcriptions');assert.equal(options.body.get('file').name,'audio.m4a');return response({text:'手机录音'});};
  if(await findFfmpeg())await assert.rejects(transcribeIntranet(store,directory,file,new AbortController().signal),/无法转成/);
  else{const result=await transcribeIntranet(store,directory,file,new AbortController().signal);assert.match(result.content,/\[整段\] 手机录音/);assert.equal(result.segments,1);}
});
test('ASR使用目录模型和WAV分段，不向接口携带笔记或偏好',async t=>{const store=storeFixture(t),wav=fs.readFileSync(new URL('../samples/media/synthetic-meeting.wav',import.meta.url)),file=await addWorkspaceFile(store,{name:'test.wav',base64:wav.toString('base64')}),{directory}=directoryFixture();await directory.refresh();directory.fetch=async(url,options)=>{assert.equal(url,'http://10.0.0.32:6001/v1/audio/transcriptions');assert.deepEqual([...options.body.keys()],['model','file']);assert.equal(options.body.get('model'),'Qwen/Qwen3-ASR-1.7B');return response({text:'测试转写'});};const result=await transcribeIntranet(store,directory,file,new AbortController().signal);assert.match(result.content,/\[00:00–00:13\] 测试转写/);assert.equal(result.device,'intranet-api');});
test('停止等待不保存草稿，不宣称已经撤销远端任务',async t=>{const store=storeFixture(t),{directory}=directoryFixture(),workspace=new Workspace(store,{directory,active:new Map()},{recognize:async(file,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});const file=await workspace.upload({name:'fixture.png',base64:Buffer.from('fixture').toString('base64')});const pending=workspace.recognizeFile(file.id);workspace.cancelRecognition(file.id);await assert.rejects(pending,/内网请求可能继续/);assert.equal(file.recognition,undefined);assert.equal(workspace.recognizing.size,0);});
