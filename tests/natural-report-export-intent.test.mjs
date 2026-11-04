import test from 'node:test';import assert from 'node:assert/strict';import{executionIntent}from'../v8-tools/execution-intent.mjs';
test('natural document creation outranks a prior-result mention and download wording',()=>{for(const text of ['请基于本对话材料和刚才的结果，整理成中文Word报告并直接交付下载。没有依据的结论留作待确认。','把刚才的结论写成Word给我下载','把已有分析制作成Word报告']){const i=executionIntent(text);assert.notEqual(i.operation,'retrieve',text);assert.deepEqual(i.formats,['docx'],text);}});
test('actual requests for an existing file still retrieve without regeneration',()=>{for(const text of ['之前的Word发我','把刚才的Excel给我','文件呢'])assert.equal(executionIntent(text).operation,'retrieve');});

test('negative no-regeneration constraints do not turn an existing-file request into new work',()=>{
 for(const text of ['把刚才的Word文件给我，不要重新生成。','之前那个Excel给我，不要修改或导出新文件。','不要重新审核，只把之前的Word发我。']){
  const intent=executionIntent(text);assert.equal(intent.operation,'retrieve',text);assert.equal(intent.kind,'existing_file',text);assert.equal(intent.requiresReprocessing,false,text);
 }
});

test('positive conversion or modification remains work while explicit answer-only requests remain text',()=>{
 assert.equal(executionIntent('把已有Word转成PDF，不要修改正文').operation,'convert');
 assert.equal(executionIntent('把之前Word里的日期更正后给我，不要改其他字段').requiresReprocessing,true);
 assert.equal(executionIntent('只告诉我是否已有Word，不要生成文件。').kind,'answer_only');
});
