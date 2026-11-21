import test from 'node:test';import assert from 'node:assert/strict';
import {structureTranscript} from '../src/media/transcript-post.mjs';

test('问句和回答分成两个说话人，不编造姓名',()=>{
  const raw='我们用了五折交叉验证，还问过李老师。你只用了两百个样本吗？对，只用了这些，我是项目陈述人。';
  const text=structureTranscript(raw);
  assert.match(text,/说话人1/);assert.match(text,/说话人2/);
  assert.match(text,/李老师/);assert.match(text,/没有确认是谁在开口/);assert.doesNotMatch(text,/个李老师|一下老师/);
  assert.match(text,/我是项目陈述人/);
  assert.doesNotMatch(text,/张三|李四|说话人3/);
  const named=structureTranscript('我们问了医院老师和李老师。');
  assert.match(named,/开口：李老师/);assert.doesNotMatch(named,/开口：.*院老师/);
  assert.match(text,/不是声纹/);
});

test('已有时间分段保留，短句不拆散',()=>{
  const text=structureTranscript('[00:00–00:13] 测试转写');
  assert.match(text,/\[00:00–00:13\]/);assert.match(text,/测试转写/);assert.match(text,/说话人1/);
});
