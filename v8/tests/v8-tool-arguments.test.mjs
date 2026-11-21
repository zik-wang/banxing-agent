import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {normalizeToolArguments} from '../v8-tools/tool-arguments.mjs';import {ToolHarness} from '../v8-tools/harness.mjs';
import {ResultTools} from '../v8-tools/result-tools.mjs';
const schema={type:'object',properties:{result_ids:{type:'array',items:{type:'string'},minItems:1},content:{type:'string'}},required:['result_ids'],additionalProperties:false};
test('only declared JSON array fields are decoded and the input object is preserved',()=>{const a={result_ids:'["saved-result"]',content:'["literal paragraph"]'},r=normalizeToolArguments(schema,a);assert.deepEqual(r.arguments.result_ids,['saved-result']);assert.equal(r.arguments.content,a.content);assert.equal(a.result_ids,'["saved-result"]');assert.equal(r.changes.length,1);});
test('malformed JSON, comma lists and objects are not guessed into arrays',()=>{for(const s of ['[broken]','a,b','{"id":"a"}'])assert.equal(normalizeToolArguments(schema,{result_ids:s}).changes.length,0);});
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v8-array-args-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let handled=0;const h=new ToolHarness({directory,tools:[{name:'export_document',inputSchema:schema,execute:async a=>{handled++;if(a.result_ids.some(x=>x!=='saved-result'))throw Object.assign(Error('unauthorized result'),{code:'RESULT_SCOPE_DENIED'});return {resultIds:a.result_ids};}}]});return{h,directory,count:()=>handled};}
test('actual harness accepts valid double-serialized IDs and logs both raw and normalized input',async t=>{const {h,directory}=setup(t),r=await h.execute('export_document',{result_ids:'["saved-result"]'});assert.equal(r.status,'ok');assert.deepEqual(r.data.resultIds,['saved-result']);const log=JSON.parse(fs.readFileSync(path.join(directory,'tool-calls.jsonl'),'utf8').trim());assert.equal(log.arguments.result_ids,'["saved-result"]');assert.deepEqual(log.normalizedArguments.result_ids,['saved-result']);});
test('normalization still rejects wrong element types, empty required IDs and unknown fields',async t=>{const {h,count}=setup(t);for(const a of [{result_ids:'[12]'},{result_ids:'[]'},{result_ids:'["saved-result"]',extra:true}])assert.equal((await h.execute('export_document',a)).status,'error');assert.equal(count(),0);});
test('decoded foreign IDs still reach and fail the real handler authorization check',async t=>{const {h}=setup(t),r=await h.execute('export_document',{result_ids:'["foreign-result"]'});assert.equal(r.status,'error');assert.equal(r.error.code,'RESULT_SCOPE_DENIED');});

test('quoted integer offsets resume real artifact pagination and retain the submitted value', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-integer-args-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'synthetic-test.txt');
  fs.writeFileSync(file, '甲'.repeat(5000) + '乙');
  const extras = {artifacts: new Map([['001', {kind: 'text', path: file}]]), inspect: async () => ({})};
  const harness = new ToolHarness({directory, tools: new ResultTools({}, extras).tools()});
  const first = await harness.execute('read_artifact', {artifact_id: '001', offset: '0'});
  assert.equal(first.data.nextOffset, 5000);
  const second = await harness.execute('read_artifact', {artifact_id: '001', offset: String(first.data.nextOffset)});
  assert.equal(second.data.text, '乙');
  assert.equal(second.data.nextOffset, null);
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'tool-calls.jsonl'), 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(record.arguments, {artifact_id: '001', offset: '5000'});
  assert.deepEqual(record.normalizedArguments, {artifact_id: '001', offset: 5000});

  for (const args of [
    {offset: '05000'}, {offset: '5.0'}, {offset: '5e3'}, {offset: ' '},
    {offset: '9007199254740993'}, {offset: '-1'}, {offset: '10000001'},
    {offset: '5000', length: '24000'}
  ]) {
    const rejected = await harness.execute('read_artifact', {artifact_id: '001', ...args});
    assert.equal(rejected.error.code, 'INVALID_ARGUMENT', JSON.stringify(args));
  }
  const foreign = await harness.execute('read_artifact', {artifact_id: '002', offset: '0'});
  assert.equal(foreign.error.code, 'UNKNOWN_ARTIFACT');
});
