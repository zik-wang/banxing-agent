import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeQuote} from '../v8-tools/knowledge-tools.mjs';
import {lineIndex} from '../v8-tools/text-tools.mjs';
import {uniqueKnowledgeSpans} from '../v8-tools/office-preflight.mjs';

test('ordinary long source line stays intact and repeated keywords share one source span',()=>{
 const text='heading\n'+('original words '.repeat(30))+'onboarding '+('more text '.repeat(30))+'onboarding.\nend';
 const starts=lineIndex(text),a=knowledgeQuote(text,starts,1,text.indexOf('onboarding'),10),b=knowledgeQuote(text,starts,1,text.lastIndexOf('onboarding'),10);
 assert.equal(a.quote,text.slice(starts[1],starts[2]));
 assert.deepEqual(a,b);assert.equal(a.quoteTruncated,false);
 assert.equal(uniqueKnowledgeSpans([a,b]).length,1);
});
test('oversized source lines retain exact bounded text and disclose unreturned scope',()=>{
 const text='begin '+('word '.repeat(1500))+'needle '+('word '.repeat(1000));
 const hit=text.indexOf('needle'),s=knowledgeQuote(text,lineIndex(text),0,hit,6);
 assert.equal(s.quote,text.slice(s.start,s.end));assert.equal(s.quoteTruncated,true);
 assert.equal(s.quote.length,2000);assert(s.start<=hit&&s.end>=hit+6);
 assert.equal(s.lineStart,0);assert.equal(s.lineEnd,text.length);
});
test('CRLF and final lines retain precise offsets without normalizing originals',()=>{
 const text='first\r\n合同 发票\r\nlast 发票',starts=lineIndex(text);
 const one=knowledgeQuote(text,starts,1,text.indexOf('发票'),2),last=knowledgeQuote(text,starts,2,text.lastIndexOf('发票'),2);
 assert.equal(one.quote,'合同 发票\r\n');assert.equal(last.quote,'last 发票');
 assert.equal(text.slice(last.start,last.end),last.quote);
});
