import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {inlineRuns,plainInline,wordBlocks} from '../v8-tools/word-markdown.mjs';
import {buildWord,wordColumnWidths} from '../v8-tools/word-document.mjs';

test('emphasis formats prose while escaped stars, code, multiplication and identifiers stay literal',()=>{
 assert.deepEqual(inlineRuns('*运行路径*：说明'),[{text:'运行路径',italics:true},{text:'：说明'}]);
 for(const [input,expected] of [['\\*原值\\*','*原值*'],['`*原值*`','*原值*'],['2*3*4','2*3*4'],['a_b_c','a_b_c'],['* x *','* x *'],['**标题**','标题']])assert.equal(plainInline(input),expected);
});
test('nested bullet indentation remains explicit and code is not parsed as a list',()=>{
 const blocks=wordBlocks('- 主项\n  - 子项\n    - 细项\n```txt\n  - 原文\n```');
 assert.deepEqual(blocks.slice(0,3).map(b=>b.bulletLevel),[0,1,2]);assert.equal(blocks[3].code,true);assert.equal(blocks[3].text,'  - 原文');
});
test('column allocation leaves readable label space and never exceeds page width',()=>{
 const rows=[['项目','说明','说明','说明'],['LongLabel','长说明'.repeat(40),'文字'.repeat(40),'文字'.repeat(40)]];
 const widths=wordColumnWidths(rows,10106);assert(widths[0]>=9*115+240);assert.equal(widths.reduce((a,b)=>a+b,0),10106);
 for(const n of [2,7,30,100]){const w=wordColumnWidths([Array(n).fill('字段'),Array(n).fill('x'.repeat(80))],10106,n>6);assert(w.every(v=>v>0));assert.equal(w.reduce((a,b)=>a+b,0),10106);}
});
test('DOCX preserves literal table data, italic style, list levels and parent-child pagination',async t=>{
 const r=await buildWord({title:'排版测试',text:'5. 分组：\n- **父项**：\n  - *路径*：文字\n  - `*代码*`\n- 另一项',tables:[{headers:['字段'],rows:[['*原值*']]}]});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'word-layout-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'test.docx');fs.writeFileSync(file,r.bytes);
 const script="import sys,json\nfrom zipfile import ZipFile\nfrom xml.etree import ElementTree as E\nn={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}\nr=E.fromstring(ZipFile(sys.argv[1]).read('word/document.xml'))\nps=[]\nfor p in r.findall('./w:body/w:p',n):\n level=p.find('./w:pPr/w:numPr/w:ilvl',n)\n ps.append({'text':''.join(t.text or '' for t in p.findall('.//w:t',n)),'level':None if level is None else level.get('{'+n['w']+'}val'),'keep':p.find('./w:pPr/w:keepNext',n) is not None,'italic':len(p.findall('.//w:rPr/w:i',n))})\nprint(json.dumps(ps))";
 const ps=JSON.parse(execFileSync(process.env.V8_PYTHON||'C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-c',script,file],{encoding:'utf8',windowsHide:true}));
 assert.equal(ps[1].keep,true);assert.equal(ps[2].keep,true);assert.equal(ps[2].level,'0');assert.equal(ps[3].level,'1');assert.equal(ps[3].italic,1);assert.equal(ps[4].text,'*代码*');assert.deepEqual(r.expected.tables,[[['字段'],['*原值*']]]);
});

