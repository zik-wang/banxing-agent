import test from 'node:test';import assert from 'node:assert/strict';import {turnIntent} from '../v8-tools/turn-intent.mjs';
test('negated export is answer-only, conversion is not retrieval, and colloquial merging needs material',()=>{assert.equal(turnIntent('你好，简单打个招呼，不生成文件。').kind,'answer_only');assert.equal(turnIntent('把刚才结果导出PPTX文件').kind,'create_file');assert.deepEqual(turnIntent('把刚才结果导出PPTX文件').formats,['pptx']);assert(turnIntent('把这两份报表合起来，给我Excel。').materialTask);assert.equal(turnIntent('把刚才文件再发我').kind,'existing_file');});

test('ordinary update requests modify a deliverable instead of returning the old file',()=>{
 for(const request of ['更新Word给我','数量对不上，更新一下这份报告，给我Word','把Excel重新更新','更新PDF，保留原件']){const i=turnIntent(request);assert.equal(i.operation,'modify');assert.equal(i.requiresReprocessing,true);assert.notEqual(i.kind,'existing_file');}
 for(const request of ['不用更新Word，把之前的Word给我','查看项目更新日志，给我Word','更新日期是什么，直接告诉我'])assert.notEqual(turnIntent(request).operation,'modify');
});
test('shortening, restructuring and rechecking are work, not same-format retrieval',()=>{
 for(const request of ['太长了，整理成一页会前速览，三份材料各讲清时间和重点，再列几个会上可以讨论的问题。不要把不同时间的数据混成一个截止时间，日期再核对一下。给我Word。','精简一下，给我Word','整理成摘要，给我Word','重新核对日期，给我Word','压缩成两页，Word给我']){const i=turnIntent(request);assert.equal(i.operation,'modify');assert.equal(i.requiresReprocessing,true);}
 for(const request of ['不用精简，把原来的Word给我','不要重新核对，把之前的Word给我','查看摘要文件','把这个转成Word'])assert.notEqual(turnIntent(request).operation,'modify');
});
