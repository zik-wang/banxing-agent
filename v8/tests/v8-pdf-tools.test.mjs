import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {DocumentTools} from '../v8-tools/document-tools.mjs';import {DocumentExtras} from '../v8-tools/document-extras.mjs';import {PdfTools} from '../v8-tools/pdf-tools.mjs';import {ResultTools} from '../v8-tools/result-tools.mjs';import {requestedFormats} from '../v8-tools/delivery-format.mjs';import {outputTools,turnIntent} from '../v8-tools/turn-intent.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';import {TextTools} from '../v8-tools/text-tools.mjs';import {settleDelivery} from '../v8-tools/delivery-settlement.mjs';
const python=process.env.V8_PYTHON;
function setup(t,name='image.tiff'){
 const parent=path.resolve('qa-output/pdf-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,name),pdf=path.join(root,'provider.pdf');
 execFileSync(python,['-c',"from PIL import Image\nimport sys\na=Image.new('RGBA',(120,80),(255,0,0,100));b=Image.new('RGB',(80,120),'blue')\na.save(sys.argv[1],save_all=True,append_images=[b]);a.convert('RGB').save(sys.argv[2],'PDF')",input,pdf],{windowsHide:true});
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[input],python}),extras=new DocumentExtras(docs),id=[...docs.assets.keys()][0];return {root,input,pdf,docs,extras,id};
}
test('plain Chinese 转PDF is an output request and answer-only turns forbid PDF creation',()=>{assert.deepEqual(requestedFormats('把这个转PDF'),['pdf']);assert.deepEqual(requestedFormats('转换成 PDF'),['pdf']);assert.equal(turnIntent('只回答，不用生成PDF').noNewFiles,true);assert(outputTools.has('convert_to_pdf'));});
test('image frames become separate real pages; original bytes and PDF readback remain accessible',{skip:!python},async t=>{
 const x=setup(t),before=fs.readFileSync(x.input),tool=new PdfTools(x.docs,x.extras,{fetchImpl:()=>{throw Error('Image conversion must stay local');}});
 const out=await tool.convert({asset_id:x.id,title:'图像PDF'});assert.equal(out.pages,2);assert.equal(out.preparation.frames,2);assert.equal(out.contentVerified,false);assert.deepEqual(fs.readFileSync(x.input),before);
 const readback=await x.extras.inspect({artifact_id:out.artifactId},{});assert.equal(readback.exportIntegrityPassed,true);assert.equal(readback.document.pages,2);assert.equal(readback.document.pagesWithoutText.length,2);
 const read=await new ResultTools(x.docs,x.extras).read({artifact_id:out.artifactId},{});assert(read.text.includes('[第2页]'));assert.equal(out.previews.length,2);assert.equal(x.docs.asset(out.pdfAssetId).kind,'pdf');
 const copy=await tool.convert({artifact_id:out.artifactId,title:'副本'});assert.deepEqual(fs.readFileSync(copy.path),fs.readFileSync(out.path));
});
test('conversion rejects ambiguous sources, changed bytes and unsupported audio before network calls',{skip:!python},async t=>{
 const x=setup(t),tool=new PdfTools(x.docs,x.extras,{fetchImpl:()=>{throw Error('Unexpected network');}});
 await assert.rejects(tool.convert({asset_id:x.id,artifact_id:'fake'}),e=>e.code==='PDF_SOURCE_REQUIRED');
 await assert.rejects(tool.convert({artifact_id:'unknown'}),e=>e.code==='UNKNOWN_ARTIFACT');
 x.docs.assets.get(x.id).kind='audio';await assert.rejects(tool.convert({asset_id:x.id}),e=>e.code==='PDF_FORMAT_UNSUPPORTED');
 fs.appendFileSync(x.docs.asset(x.id).path,'changed');await assert.rejects(tool.convert({asset_id:x.id}),e=>e.code==='ASSET_CHANGED');assert.equal(x.extras.artifacts.size,0);
});
test('office conversion uses only fixed intranet catalog, sends no model credential and validates provider bytes',{skip:!python},async t=>{
 const x=setup(t),calls=[],bytes=fs.readFileSync(x.pdf);x.docs.assets.get(x.id).kind='word';
 let mode='invalid';const fetchImpl=async(url,opts)=>{calls.push({url,opts});if(url.endsWith('/services'))return Response.json({items:[{id:'node-93--mygpt-lo--p2010',auth:'none',selected_base_url:mode==='foreign'?'https://foreign.example':'http://10.0.0.93:2010'}]});if(mode==='invalid')return Response.json({success:true});if(mode==='http')return new Response('error',{status:503});return new Response(bytes);};
 const tool=new PdfTools(x.docs,x.extras,{fetchImpl,apiKey:'must-not-forward'});
 await assert.rejects(tool.convert({asset_id:x.id}),e=>e.code==='INVALID_PDF_RESPONSE');assert.equal(x.extras.artifacts.size,0);
 mode='foreign';await assert.rejects(tool.convert({asset_id:x.id}),/允许范围/);assert(!calls.some(c=>c.url.includes('foreign')));
 mode='http';await assert.rejects(tool.convert({asset_id:x.id}),e=>e.code==='PDF_CONVERSION_HTTP_ERROR');
 mode='ok';const out=await tool.convert({asset_id:x.id});assert.equal(out.pages,1);assert(calls.filter(c=>c.opts.method==='POST').every(c=>c.opts.body instanceof FormData&&!c.opts.headers));assert.equal(out.originalUnchanged,true);
});
test('workbook print copy wraps cells and expands width without touching source or excluding the last row',{skip:!python},async t=>{
 const x=setup(t),input=path.join(x.root,'book.xlsx'),output=path.join(x.root,'prepared.xlsx');
 execFileSync(python,['-c',"from openpyxl import Workbook\nimport sys\nw=Workbook();s=w.active;s.append(['编号','很长的完整供应商名称 and & Company']);s.append([2,'LAST-ROW-002']);w.save(sys.argv[1])",input]);
 const before=fs.readFileSync(input),prepared=await x.docs.worker({operation:'prepare_pdf_input',mode:'workbook',input,output});
 assert.equal(prepared.visibleSheets[0].rows,2);assert.deepEqual(fs.readFileSync(input),before);
 const actual=JSON.parse(execFileSync(python,['-c',"from openpyxl import load_workbook\nimport sys,json\ns=load_workbook(sys.argv[1]).active\nprint(json.dumps({'width':s.column_dimensions['B'].width,'wrap':s['B1'].alignment.wrap_text,'last':s['B2'].value,'height':s.row_dimensions[1].height}))",output],{encoding:'utf8'}));assert(actual.width>13);assert(actual.wrap);assert.equal(actual.last,'LAST-ROW-002');assert(actual.height>15);
});
test('PDF report may use a text intermediate but cannot finish until a real PDF is delivered',{skip:!python},async t=>{
 const x=setup(t);x.docs.requestedFormats=['pdf'];x.docs.turnIntent=turnIntent('生成 PDF 报告');
 const source=await new DeliveryTools(x.docs,x.extras,new TextTools(x.docs)).export({title:'报告中间件',format:'txt',content:'完整的报告内容'});
 const delivery=await settleDelivery({docs:x.docs,extras:x.extras,records:{guardPresentation:text=>({text,corrections:[],ambiguous:[]})}},'报告还在转换',{status:'model_finished'});
 assert.equal(path.extname(source.path),'.txt');assert.equal(delivery.requirementsSatisfied,false);assert.deepEqual(delivery.formatCheck.missing,['pdf']);assert.equal(delivery.verifiedArtifacts.length,0);
});
