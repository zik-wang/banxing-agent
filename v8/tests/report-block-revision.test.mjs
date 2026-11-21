import test from 'node:test';
import assert from 'node:assert/strict';
import {applyReportEdits} from '../v8-tools/report-revision.mjs';
const apply=(body,edits)=>applyReportEdits(body,JSON.stringify({edits}));
const edit=(before,after)=>({before,after,reason:'Synthetic authorized revision'});
test('unique prose block supports nested bullets while preserving surrounding bytes and CRLF',()=>{
 const body='# Synthetic\r\nKeep 123.45\r\n5. Status\r\n  - planned\r\n  - unknown\r\n6. Keep\r\n';
 const before='5. Status\n  - planned\n  - unknown',after='5. Updated\n  - planned at source date\n  - personal progress unknown';
 const r=apply(body,[edit(before,after)]);
 assert.equal(r.body,'# Synthetic\r\nKeep 123.45\r\n'+after+'\r\n6. Keep\r\n');
 assert.equal(body.slice(r.receipt.edits[0].start,r.receipt.edits[0].end),before.replaceAll('\n','\r\n'));
 assert.equal(r.receipt.semanticVerified,false);
});
test('complete paragraph block may include a blank separator',()=>{
 const body='A\nFirst\n\nSecond\nZ';assert.equal(apply(body,[edit('First\n\nSecond','Revised\n\nSecond')]).body,'A\nRevised\n\nSecond\nZ');
});
test('partial-line and non-contiguous blocks are rejected',()=>{
 for(const before of ['Status\n  - old','5. Status\nMissing','  - old\n6.'])assert.throws(()=>apply('5. Status\n  - old\n6. Keep',[edit(before,'new')]),/位置/);
});
test('duplicated prose blocks remain ambiguous',()=>assert.throws(()=>apply('A\nB\nC\nA\nB',[edit('A\nB','new')]),/唯一/));
test('overlapping block and line patches reject either order',()=>{
 const edits=[edit('A\nB','X\nY'),edit('B','Z')];for(const es of [edits,[...edits].reverse()])assert.throws(()=>apply('A\nB\nC',es),/重叠/);
});
test('adjacent block edits use immutable original positions',()=>assert.equal(apply('A\nB\nC\nD\nZ',[edit('A\nB','first'),edit('C\nD','second')]).body,'first\nsecond\nZ'));
test('table records cannot hide inside a multi-line block',()=>{
 for(const before of ['Intro\n|A|10|','|A|10|\n|B|20|'])assert.throws(()=>apply('Intro\n|A|10|\n|B|20|',[edit(before,'short')]),/表格/);
});
test('empty replacement, metadata injection and unmatched anchors remain invalid',()=>{
 assert.throws(()=>apply('A\nB',[edit('A\nB','  ')]),/非空/);
 assert.throws(()=>apply('A\nB',[{...edit('A\nB','C'),path:'other'}]),/说明/);
 assert.throws(()=>apply('A\nB',[edit('X\nY','C')]),/位置/);
});
test('a multi-line whole-report replacement is not a local revision',()=>assert.throws(()=>apply('A\nB\n',[edit('A\nB','new report')]),/整篇/));
