import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {Store} from '../core.mjs';
import {extractUpload,extractUploadWorker,importUpload} from '../uploads.mjs';
const input=(name,value)=>({name,base64:Buffer.from(value).toString('base64')});
test('上传文本在独立进程解析，按段完整保存并在重启后可读',async t=>{
  const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,'companion-upload-'));
  t.after(()=>{const target=path.resolve(dir);assert.equal(path.dirname(target),root);assert(path.basename(target).startsWith('companion-upload-'));fs.rmSync(target,{recursive:true,force:true});});
  const body='上传文件中的私人原文。'.repeat(2200),file=await extractUploadWorker(input('工作材料.md',body)),store=new Store(dir),result=importUpload(store,file);
  assert(result.parts>1);assert.equal(store.state.notes.filter(n=>n.source?.documentId===result.documentId).map(n=>n.body).join(''),body);
  assert.equal(new Store(dir).state.notes.at(-1).source.name,'工作材料.md');
  const count=store.state.notes.length;store.state.notes=Array.from({length:40},()=>({}));assert.throws(()=>importUpload(store,file));assert.equal(store.state.notes.length,40);assert(count<40);
});
test('拒绝不支持格式、路径文件名、伪base64、空文件和二进制',async()=>{
  for(const value of [input('x.exe','abc'),input('../x.txt','abc'),{name:'x.txt',base64:'!invalid'},input('empty.txt',''),input('binary.txt',Buffer.from([0,1,2]))])await assert.rejects(extractUpload(value));
  const file=await extractUpload(input('large.txt','x'.repeat(60001)));assert.equal(file.truncated,true);assert.equal(file.content.length,60000);
});
test('DOCX实际提取段落为纯文本',async()=>{
  const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>私人DOCX验收文字</w:t></w:r></w:p></w:body></w:document>');
  const bytes=await zip.generateAsync({type:'nodebuffer'});const result=await extractUploadWorker(input('样例.docx',bytes));assert.match(result.content,/私人DOCX验收文字/);
});
test('文字PDF实际提取正文；扫描PDF不冒充成功',async()=>{
  const stream='BT /F1 12 Tf 72 720 Td (PDF upload verification) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result=await extractUploadWorker(input('example.pdf',pdf));assert.match(result.content,/PDF upload verification/);
  await assert.rejects(extractUploadWorker(input('broken.pdf','not a pdf')));
});
