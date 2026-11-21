import test from 'node:test';import assert from 'node:assert/strict';
import {plainInline} from '../v8-tools/word-markdown.mjs';
import {buildWord} from '../v8-tools/word-document.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
test('safe Markdown line breaks become newlines, code and unrelated HTML remain literal',()=>{
 assert.equal(plainInline('甲<br>乙<BR />丙'),'甲\n乙\n丙');
 assert.equal(plainInline('`<br>` <b>不执行</b>'),'<br> <b>不执行</b>');
 assert.equal(plainInline('**甲<br>乙**'),'甲\n乙');
 assert.equal(plainInline('<br onclick="x">'),'<br onclick="x">');
});
test('saved Word XML has a real linebreak and no literal br markup in the table',async t=>{
 const r=await buildWord({title:'换行核查',text:'| 字段 | 内容 |\n|---|---|\n| 值 | 甲<br>乙 |'});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'word-break-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'report.docx');fs.writeFileSync(file,r.bytes);
 const script="from zipfile import ZipFile\nfrom xml.etree import ElementTree as E\nimport sys,json\nr=E.fromstring(ZipFile(sys.argv[1]).read('word/document.xml')); n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}\nc=r.findall('.//w:tbl/w:tr',n)[1].findall('w:tc',n)[1]\nprint(json.dumps({'breaks':len(c.findall('.//w:br',n)),'text':''.join(x.text or '' for x in c.findall('.//w:t',n))}))";
 const actual=JSON.parse(execFileSync('C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-c',script,file],{encoding:'utf8',windowsHide:true}));
 assert.equal(r.expected.tables[0][1][1],'甲\n乙');assert.equal(actual.breaks,1);assert.equal(actual.text,'甲乙');
});
