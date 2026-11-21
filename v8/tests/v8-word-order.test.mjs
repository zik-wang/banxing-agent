import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {inlineRuns,plainInline,wordBlocks,tableCells} from '../v8-tools/word-markdown.mjs';import {buildWord} from '../v8-tools/word-document.mjs';
test('formatting preserves visible values, original ampersands and inline code',()=>{
 assert.equal(plainInline('**金额** `64MB` Microsoft & Co and A_B'), '金额 64MB Microsoft & Co and A_B');
 assert.equal(plainInline('`**not bold**`'), '**not bold**');assert.equal(inlineRuns('**重要**')[0].bold,true);
 assert.equal(plainInline('[来源](https://example.org/a)'), '来源 (https://example.org/a)');assert.equal(plainInline('A \\| B'),'A | B');
});
test('tables stay between their headings and following text; fence content stays literal',()=>{
 const b=wordBlocks('## 一\n|名称|值|\n|---|---|\n|A|**100**|\n## 二\n正文\n```text\n**literal**\n|not a table|\n```');
 assert.deepEqual(b.map(x=>x.kind),['paragraph','table','paragraph','paragraph','paragraph','paragraph']);assert.equal(b[1].rows[1][1],'**100**');assert.equal(b[4].code,true);assert.equal(b[4].text,'**literal**');
});
test('escaped pipes and pipes inside backticks remain in their real cells',()=>{
 assert.deepEqual(tableCells('| A\\|B | `x|y` |'),['A\\|B','`x|y`']);assert.equal(wordBlocks('| A | B |\n|---|---|\n| a\\|b | `x|y` |')[0].rows.length,2);
});
const python='C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
async function built(t,args){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v8-word-order-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const r=await buildWord(args),file=path.join(dir,'report.docx');fs.writeFileSync(file,r.bytes);const py="from zipfile import ZipFile\nfrom xml.etree import ElementTree as E\nimport json,sys\nwith ZipFile(sys.argv[1]) as z: root=E.fromstring(z.read('word/document.xml'))\nns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}\ntxt=lambda e:''.join(x.text or '' for x in e.findall('.//w:t',ns))\nbody=root.find('w:body',ns)\nblocks=[{'kind':'paragraph','text':txt(c)} if c.tag.endswith('}p') else {'kind':'table','rows':[[txt(cell) for cell in row.findall('w:tc',ns)] for row in c.findall('w:tr',ns)]} for c in body if c.tag.endswith('}p') or c.tag.endswith('}tbl')]\nprint(json.dumps({'blocks':blocks,'size':body.find('w:sectPr/w:pgSz',ns).attrib},ensure_ascii=False))";
 const out=spawnSync(python,['-X','utf8','-c',py,file],{encoding:'utf8'});assert.equal(out.status,0,out.stderr);return {r,actual:JSON.parse(out.stdout)};}
test('actual DOCX readback proves interleaved table order and no Markdown decoration',async t=>{
 const {r,actual}=await built(t,{title:'对比报告',text:'# 对比报告\n**范围**：文档宣称\n## 版本\n| 项目 | 值 |\n|---|---|\n| `A` | **1** |\n## 许可\n| 项目 | 许可 |\n|---|---|\n| A | MIT |\n结束'});
 assert.deepEqual(actual.blocks,r.expected.blocks);assert.equal(actual.blocks.filter(x=>x.text==='对比报告').length,1);const table=actual.blocks.findIndex(x=>x.kind==='table');assert.equal(actual.blocks[table-1].text,'版本');assert.equal(actual.blocks[table+2].text,'许可');assert.equal(r.expected.tables[0][1][1],'1');assert(!JSON.stringify(actual).includes('**'));
});
test('structured spreadsheet values remain literal and wide page dimensions are landscape',async t=>{
 const headers=Array.from({length:9},(_,i)=>'列'+i),row=['**literal**','`raw`','001','0',...Array(5).fill('未提供')];
 const {r,actual}=await built(t,{title:'数据导出',tables:[{sheet:'原始数据',headers,rows:[row]}]});assert.deepEqual(r.expected.tables[0][1],row);assert.deepEqual(actual.blocks,r.expected.blocks);
 const width=Number(Object.entries(actual.size).find(([k])=>k.endsWith('}w'))[1]),height=Number(Object.entries(actual.size).find(([k])=>k.endsWith('}h'))[1]);assert(width>height);
});
