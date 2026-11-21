import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderWorkbookPreview} from '../v8-tools/workbook-preview.mjs';

function fixture(t,code){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'preview-isolation-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const workerPath=path.join(folder,'worker.mjs'),input=path.join(folder,'saved.xlsx'),output=path.join(folder,'preview.png');
  fs.writeFileSync(workerPath,code);fs.writeFileSync(input,'saved-workbook-must-not-change');
  return {workerPath,input,output};
}
test('preview child nonzero exit retains original error and leaves workbook unchanged',async t=>{
  const f=fixture(t,"console.error('native graphics allocation failed');process.exit(134);");
  const r=await renderWorkbookPreview(f,{workerPath:f.workerPath});
  assert.equal(r.ok,false);assert.equal(r.error.exitCode,134);assert.match(r.error.message,/native graphics/);
  assert.equal(fs.readFileSync(f.input,'utf8'),'saved-workbook-must-not-change');assert.equal(r.path,null);
});
test('preview timeout does not hang the delivery caller',async t=>{
  const f=fixture(t,'setInterval(()=>{},100);');
  const r=await renderWorkbookPreview(f,{workerPath:f.workerPath,timeoutMs:300});
  assert.equal(r.ok,false);assert.equal(r.error.code,'PREVIEW_TIMEOUT');assert(r.elapsedMs<10000);
});
test('success without a PNG is not advertised as a preview',async t=>{
  const f=fixture(t,'process.exit(0);');
  assert.equal((await renderWorkbookPreview(f,{workerPath:f.workerPath})).error.code,'PREVIEW_OUTPUT_INVALID');
});
test('successful child returns only its generated PNG and leaves saved data untouched',async t=>{
  const f=fixture(t,"import fs from 'node:fs';let s='';for await(const p of process.stdin)s+=p;const r=JSON.parse(s);fs.writeFileSync(r.output,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64'));");
  const r=await renderWorkbookPreview(f,{workerPath:f.workerPath});assert.equal(r.ok,true);assert.equal(r.path,f.output);
  assert.equal(fs.readFileSync(f.input,'utf8'),'saved-workbook-must-not-change');
});
test('already cancelled preview does not start a child',async t=>{
  const f=fixture(t,"throw Error('must not run')");const controller=new AbortController();controller.abort();
  const r=await renderWorkbookPreview(f,{workerPath:f.workerPath,signal:controller.signal});assert.equal(r.error.code,'PREVIEW_CANCELLED');
});
