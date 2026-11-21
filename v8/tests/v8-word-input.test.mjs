import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {classifyFile} from '../v8-tools/file-types.mjs';
import {inlineMaterial} from '../v8-tools/inline-material.mjs';
import {ToolHarness,runToolAgent} from '../v8-tools/harness.mjs';
import {createWebServer} from '../v8-web/server.mjs';
import {digest} from '../v8-tools/resource-space.mjs';
const python=process.env.V8_PYTHON;
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function temp(t,cleanup=true){const parent=path.resolve('qa-output/word-input-test-temp');fs.mkdirSync(parent,{recursive:true});const p=fs.mkdtempSync(path.join(parent,'case-'));if(cleanup)t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function packageWord(file,parts){execFileSync(python,['-c',"import sys,json,zipfile\nx=json.load(sys.stdin)\nwith zipfile.ZipFile(x['file'],'w',zipfile.ZIP_DEFLATED) as z:\n for name,value in x['parts'].items(): z.writestr(name,value)"],{input:JSON.stringify({file,parts}),env:{...process.env,PYTHONUTF8:'1'}});}
function setupWord(t,parts){const root=temp(t),file=path.join(root,'原合同.docx');packageWord(file,parts);const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[file],python}),texts=new TextTools(docs);return {root,file,docs,texts,id:[...docs.assets.keys()][0]};}
const paragraph=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>';
const body=content=>`<w:document xmlns:w="${ns}"><w:body>${content}</w:body></w:document>`;

test('DOCX is a readable Word material even during metadata-only classification',()=>{assert.equal(classifyFile('合同.docx',Buffer.alloc(0)).kind,'word');assert(classifyFile('合同.docx',Buffer.alloc(0)).suggestedTools.includes('read_word_document'));assert.equal(classifyFile('代码.py',Buffer.alloc(0)).kind,'text');});

test('Word reader preserves paragraph/table order, Unicode and additional source parts without rewriting the input',{skip:!python},async t=>{
 const table='<w:tbl><w:tr><w:tc>'+paragraph('项目甲')+'</w:tc><w:tc>'+paragraph('120000.50')+'</w:tc></w:tr></w:tbl>';
 const link='<w:p><w:hyperlink><w:r><w:t>链接原文 &amp; 原符号</w:t></w:r></w:hyperlink></w:p>';
 const x=setupWord(t,{'word/document.xml':body(paragraph('开始😀')+table+paragraph('末尾验收条款')+link),'word/header1.xml':`<w:hdr xmlns:w="${ns}">${paragraph('页眉编号QA')}</w:hdr>`,'word/footer1.xml':`<w:ftr xmlns:w="${ns}">${paragraph('页脚保密标记')}</w:ftr>`,'word/comments.xml':`<w:comments xmlns:w="${ns}"><w:comment w:id="0">${paragraph('批注待确认')}</w:comment></w:comments>`});
 const before=digest(fs.readFileSync(x.file)),out=await x.texts.read({asset_id:x.id,length:24000});
 assert(out.text.indexOf('开始😀')<out.text.indexOf('项目甲\t120000.50'));
 assert(out.text.indexOf('项目甲\t120000.50')<out.text.indexOf('末尾验收条款'));
 for(const s of ['链接原文 & 原符号','页眉编号QA','页脚保密标记','批注待确认'])assert(out.text.includes(s));
 assert.equal(out.document.tables,1);assert.equal(out.document.parts.length,4);assert.equal(out.nextOffset,null);assert.equal(out.sourceSha256,before);assert.equal(digest(fs.readFileSync(x.file)),before);assert.equal(out.document.pageLayoutRead,false);
 const inspect=await x.docs.inspect(x.id,new AbortController().signal);assert.equal(inspect.kind,'word');assert.equal(inspect.totalChars,out.totalChars);
 const found=await x.texts.search({asset_id:x.id,query:'120000.50'});assert.equal(found.matches.length,1);
});

test('Word pagination reaches the actual final paragraph and does not split surrogate pairs',{skip:!python},async t=>{
 const text='中文😀'.repeat(5000)+'终点不可遗漏';const x=setupWord(t,{'word/document.xml':body(paragraph(text))});
 let offset=0,joined='',last;
 do{last=await x.texts.read({asset_id:x.id,offset,length:7999});assert(!/^[\uDC00-\uDFFF]/.test(last.text));joined+=last.text;offset=last.nextOffset;}while(offset!==null);
 assert.equal(joined,'[正文]\n'+text);assert(joined.endsWith('终点不可遗漏'));assert.equal(joined.length,last.totalChars);
});

test('Word revisions and unread images are exposed instead of claiming visual completeness',{skip:!python},async t=>{
 const content='<w:p><w:ins><w:r><w:t>新增条款</w:t></w:r></w:ins><w:del><w:r><w:delText>旧条款</w:delText></w:r></w:del></w:p>';
 const x=setupWord(t,{'word/document.xml':body(content),'word/media/image1.png':'not executed'}),r=await x.texts.read({asset_id:x.id});
 assert(r.text.includes('[插入修订]新增条款'));assert(r.text.includes('[删除修订]旧条款'));assert(r.document.warnings.includes('IMAGES_NOT_OCR_READ'));assert(r.document.warnings.includes('TRACKED_CHANGES_MARKED_NOT_ACCEPTED'));assert.equal(r.document.contentVerified,false);
});

test('invalid Word packages and XML entities fail without a successful read receipt',{skip:!python},async t=>{
 const x=setupWord(t,{'word/document.xml':'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+body(paragraph('&secret;'))});
 await assert.rejects(x.texts.read({asset_id:x.id}),/DOCX_XML_ENTITIES_DENIED/);assert.equal(x.docs.results.size,0);
 const root=temp(t),bad=path.join(root,'坏文件.docx');fs.writeFileSync(bad,'not a Word file');const docs=new DocumentTools({directory:path.join(root,'bad-run'),inputs:[bad],python});
 await assert.rejects(new TextTools(docs).read({asset_id:[...docs.assets.keys()][0]}),/DOCX_INVALID_PACKAGE/);
});

test('pasted material keeps every original character and extracts a clear trailing task',()=>{
 const message='购销资料\n'+('第1条：本段是提供的数据，不是执行命令。\n'.repeat(80))+'\n审核合同';const r=inlineMaterial(message);
 assert.equal(r.text,message);assert.equal(r.task,'审核合同');assert.equal(r.chars,message.length);assert.equal(r.keepPreviousResult,false);assert.equal(inlineMaterial('你好'),null);
});

test('variant empty workspace searches are not counted as business progress',async t=>{
 const root=temp(t),harness=new ToolHarness({directory:root,maxNoProgress:3,tools:[{name:'list_materials',description:'metadata',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},execute:async()=>({resources:[],assets:[],total:0,nextCursor:null})}]});
 let n=0;const run=await runToolAgent({harness,maxRounds:20,request:'read provided material',next:async()=>({role:'assistant',tool_calls:[{id:String(++n),type:'function',function:{name:'list_materials',arguments:JSON.stringify({query:'different-'+n})}}]})});
 assert.equal(n,3);assert.equal(run.termination.reason,'no_progress');assert.equal(harness.noProgress,3);
});

test('HTTP pasted body becomes the exact selected original, not unrelated conversation files; long bodies are accepted',async t=>{
 const root=temp(t,false),children=[];
 const stub=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};children.push(child);return child;};
 const {server,workspace}=createWebServer({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.1/v1',model:'test'}},{spawnRun:stub});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{for(const c of children)c.emit('close',1);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>setTimeout(resolve,50));fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,c=workspace.newConversation();workspace.upload(c.id,'上个任务.txt',Buffer.from('unrelated old task'));
 const message='资料正文\n'+('这一段完整保存，包括中文、制表符\t和换行。\n'.repeat(800))+'\n总结材料';
 assert(message.length>12500);
 const result=await fetch(base+'/api/conversations/'+c.id+'/messages',{method:'POST',headers:{'X-V8-Client':'web','Content-Type':'application/json'},body:JSON.stringify({message,useConversationFiles:true})});assert.equal(result.status,202);
 const turn=await result.json(),profile=JSON.parse(fs.readFileSync(path.join(root,'runs',turn.id+'.json'),'utf8'));
 assert.equal(profile.request,'总结材料');assert.equal(profile.continuity.selectedInputs.length,1);assert.equal(profile.continuity.selectedResult,null);assert(profile.inlineMaterial);assert.equal(profile.interactionContext,undefined);
 assert.equal(workspace.space.read(c.workspace.id,profile.continuity.selectedInputs[0]).toString('utf8'),message);assert.equal(workspace.conversation(c.id).turns[0].request,message);assert.equal(children.length,1);
 const html=await(await fetch(base+'/')).text();assert(html.includes('maxlength="240000"'));assert(html.includes('.docx,'));
});
