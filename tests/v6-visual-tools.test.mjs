import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {Store} from '../core.mjs';
import {Harness} from '../runtime.mjs';
import {Workspace} from '../workspace.mjs';
import {ocrForChat,lookForChat,imageFromConverted} from '../document-tools.mjs';
import {modelFixture,temporary,waitFor,call} from './dsh-fixture.mjs';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

test('文字附件不注册OCR和多模态工具，图片附件会写出执行计划并留下两步结果',async t=>{
  const plans={};
  const x=await modelFixture(t,body=>{const request=body.messages.find(m=>m.role==='user').content;return plans[request]?.shift()?.()||{text:'已按工具回执回答。'};});
  const store=new Store(temporary(t,'v6-visual-'));store.state.conversations=[{id:'c',title:'测试'}];store.state.runs=[];
  const h=new Harness(store,{directory:x.directory,runAgent:undefined}),w=new Workspace(store,h);
  h.runAgent=h.runAgent.bind(h);h.chatActions={workspace:w,definitions:()=>[],acknowledgement:()=>null};
  const png=await w.upload({name:'票据.png',base64:PNG.toString('base64')});
  const text=await w.upload({name:'说明.txt',base64:Buffer.from('普通文字').toString('base64')});
  w.ocrForChat=async()=>({fileId:png.id,name:png.name,worker:'intranet-ocr',text:'价税合计 12.00',preview:'价税合计 12.00',note:'未经对照原件'});
  w.lookForChat=async()=>({fileId:png.id,name:png.name,worker:'intranet-vision',text:'看到金额12',preview:'看到金额12',note:'不能替代OCR'});
  const names=new Set();
  async function chat(request,fileIds){const run=h.start(request,{conversationId:'c',fileIds});await waitFor(()=>!h.active.has(run.id));assert.equal(run.status,'done',run.error);for(const req of x.requests)req.tools?.forEach(tool=>names.add(tool.function.name));x.requests.length=0;return run;}
  plans['只读文字']=[()=>({text:'这是文字。'})];
  const plain=await chat('只读文字',[text.id]);
  assert.equal(plain.trace.some(item=>item.type==='plan'),false);
  assert.equal(names.has('ocr_document'),false);assert.equal(names.has('read_with_vision'),false);
  plans['请识别这张发票并做多模态对照']=[()=>({calls:[call('read_with_vision',{file_id:png.id,question:'读金额'}),call('ocr_document',{file_id:png.id})]})];
  const visual=await chat('请识别这张发票并做多模态对照',[png.id]);
  assert.equal(names.has('ocr_document'),true);assert.equal(names.has('read_with_vision'),true);assert.equal(names.has('recognize_attachment'),true);
  assert.match(visual.trace.find(item=>item.type==='plan').detail,/票据\.png：先由多模态读一遍，再由OCR读一遍/);
  assert.equal(visual.trace.some(item=>item.type==='step'&&item.label==='OCR结果'&&item.detail.includes('12.00')),true);
  assert.equal(visual.trace.some(item=>item.type==='step'&&item.label==='多模态结果'&&item.detail.includes('看到金额12')),true);
  assert.equal(visual.trace.filter(item=>item.type==='tool_status'&&item.detail==='completed').length,2);
});

test('已有文字层的PDF仍走OCR，且不盖住正文核对闸门',async()=>{
  const file={id:'f',name:'a.pdf',extension:'.pdf',sha256:'abc',parseStatus:'ready',content:'文字层 金额 10.00'};
  const workspace={store:{state:{workspaceFiles:[file]},save(){}},async recognize(){return {content:'OCR 价税合计 10.00',model:'MinerU test'};},recognizeForChat(){throw new Error('不应走扫描件路径');}};
  const result=await ocrForChat(workspace,'f',AbortSignal.timeout(1000));
  assert.equal(result.worker,'intranet-ocr');assert.equal(result.text,'OCR 价税合计 10.00');assert.match(result.textLayer,/文字层/);
  assert.equal(file.recognition,undefined);assert.equal(file.content,'文字层 金额 10.00');
});

test('PDF转换结果取第一张图片交给多模态',async()=>{
  const zip=new JSZip();zip.file('note.txt','x');zip.file('page.png',PNG);
  const packed=await zip.generateAsync({type:'nodebuffer'});
  const picked=await imageFromConverted(packed);assert.equal(picked.count,1);assert.equal(picked.bytes[0],137);
  const file={id:'p',name:'发票.pdf',extension:'.pdf',sha256:'s',parseStatus:'ready',content:'文字层'};
  let seen=0;const workspace={store:{state:{workspaceFiles:[file]},save(){}},harness:{directory:{capabilities:[{kind:'vision',ready:true,model:'MiniCPM'}]}},async convertFile(){return packed;},async describeImage(_harness,bytes){seen=bytes.length;return '看到发票号码 100';}};
  const result=await lookForChat(workspace,'p','看号码',AbortSignal.timeout(1000),()=>{});
  assert.equal(seen,PNG.length);assert.equal(result.model,'MiniCPM');assert.match(result.note,/还要做OCR/);assert.match(result.text,/100/);
});
