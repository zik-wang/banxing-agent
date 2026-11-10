import test from'node:test';import assert from'node:assert/strict';import{executionIntent,outputFormats}from'../v8-tools/execution-intent.mjs';
test('customer handover and repeat-give phrases preserve requested Word instead of silently exporting Markdown',()=>{for(const text of ['请修订报告，不要猜日期，重新交付Word。','各版本逐项核对，重新给Word。','重新给我Word','交付Word'])assert.deepEqual(outputFormats(text),['docx'],text);assert.equal(executionIntent('只回答，不要交付Word').noNewFiles,true);});
test('input Word and negative output mentions remain distinct from delivery',()=>{assert.deepEqual(outputFormats('读取Word作为来源，整理成PDF'),['pdf']);for(const text of ['不要生成Word，只回答','不要交付Word','无需重新给Word'])assert.deepEqual(outputFormats(text),[],text);});
test('ordinary revision wording retains document format, including negative boundaries',()=>{for(const text of ['请修订成800字以内的Word摘要','请修订Word报告','更新为Word'])assert.deepEqual(outputFormats(text),['docx'],text);assert.deepEqual(outputFormats('不要修订Word，只回答'),[]);assert.deepEqual(executionIntent('请修订成800字以内的Word摘要').formats,['docx']);});
test('negative statements about source format do not require a new output artifact',()=>{
 for(const text of ['不能写成整份PDF都没有，交付最终Markdown','不可说成全部Word均已检查，给我TXT','禁止生成额外的PDF，提供Word'])assert.deepEqual(outputFormats(text),text.includes('Markdown')?['md']:text.includes('TXT')?['txt']:['docx'],text);
 assert.deepEqual(outputFormats('不能生成PDF但给我Word'),['docx']);
 assert.deepEqual(outputFormats('不要只交付PDF'),['pdf']);
 assert.deepEqual(outputFormats('交付Word和PDF'),['docx','pdf']);
});
