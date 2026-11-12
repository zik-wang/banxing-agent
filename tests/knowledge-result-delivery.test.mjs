import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {KnowledgeTools} from '../v8-tools/knowledge-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';
import {compactHistory} from '../v8-tools/draft-delivery.mjs';

function fixture(t,text){
 const parent=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'knowledge-result-'));
 t.after(()=>{assert.equal(path.dirname(root),parent);assert(path.basename(root).startsWith('knowledge-result-'));fs.rmSync(root,{recursive:true,force:true});});
 const input=path.join(root,'explicit-synthetic.txt');fs.writeFileSync(input,text);
 const make=(name,inputs=[])=>new DocumentTools({directory:path.join(root,name),inputs,python:process.execPath});
 const original=make('original',[input]),directory=path.join(root,'knowledge');
 const k=new KnowledgeTools(original,new TextTools(original),{knowledgeDirectory:directory});
 k.store({asset_id:[...original.assets.keys()][0],title:'Explicit synthetic fixture'});
 const before=fs.readFileSync(path.join(directory,fs.readdirSync(directory)[0]));
 const docs=make('next-session'),knowledge=new KnowledgeTools(docs,new TextTools(docs),{knowledgeDirectory:directory});
 return {root,docs,knowledge,directory,before,delivery:new DeliveryTools(docs,new DocumentExtras(docs),new TextTools(docs))};
}
test('saved search exports exact original quotes after model history compaction in a new session',async t=>{
 const text='Heading\r\n'+Array.from({length:12},(_,i)=>`Item ${i}: needle & original language — needle.\r\n`).join('');
 const x=fixture(t,text),r=x.knowledge.search({query:'needle',limit:100});
 assert.equal(r.totalMatches,24);assert.equal(r.nextOffset,null);
 const messages=[{role:'tool',content:JSON.stringify({callId:'one',tool:'search_knowledge',status:'ok',data:r})},...['later1','later2'].map(callId=>({role:'tool',content:JSON.stringify({callId,status:'ok',data:{}})}))];
 compactHistory(messages,x.docs.directory);
 const reduced=JSON.parse(messages[0].content);assert(reduced.contextReceipt);assert.equal(reduced.data.resultId,r.resultId);assert.equal(reduced.data.totalMatches,24);assert.equal(reduced.data.query,'needle');
 assert.equal(reduced.data.matches,undefined);
 const output=await x.delivery.export({title:'Literal results',format:'txt',result_ids:[reduced.data.resultId]});
 const body=fs.readFileSync(output.path,'utf8');
 for(const hit of r.matches){assert.equal(text.slice(hit.start,hit.end),hit.quote);assert(body.includes(hit.quote));assert(body.includes(hit.sourceSha256));assert(body.includes(`${hit.start}..${hit.end}`));}
 assert.equal((body.match(/原句：/g)||[]).length,12);assert.equal(body,x.docs.results.get(r.resultId).answer);
 assert.deepEqual(fs.readFileSync(path.join(x.directory,fs.readdirSync(x.directory)[0])),x.before);
 const state=JSON.parse(fs.readFileSync(path.join(x.docs.directory,'state.json')));assert(JSON.stringify(state).includes(r.resultId));
});
test('pagination exports only retrieved scope and long-line clipping remains explicit',async t=>{
 const x=fixture(t,'needle first\nneedle second\n'+('long '.repeat(1000))+'needle last');
 const a=x.knowledge.search({query:'needle',limit:1}),b=x.knowledge.search({query:'needle',offset:1,limit:1});
 assert.notEqual(a.resultId,b.resultId);assert.equal(a.nextOffset,1);assert.equal(b.nextOffset,2);
 const body=x.docs.results.get(b.resultId).answer;assert(body.includes('前部 1 处；尾部 1 处'));assert(body.includes('needle second'));assert(!body.includes('needle first'));
 const c=x.knowledge.search({query:'needle',offset:2,limit:1});assert.equal(c.nextOffset,null);assert(c.matches[0].quoteTruncated);assert(x.docs.results.get(c.resultId).answer.includes('尚未取得整行'));
 const out=await x.delivery.export({title:'All pages',format:'txt',result_ids:[a.resultId,b.resultId,c.resultId]});
 const saved=fs.readFileSync(out.path,'utf8');for(const r of [a,b,c])assert(saved.includes(x.docs.results.get(r.resultId).answer));
});
test('zero hits and repeated queries keep truthful counts and stable saved result identity',t=>{
 const x=fixture(t,'one literal line');const a=x.knowledge.search({query:'missing'}),b=x.knowledge.search({query:'missing'});
 assert.equal(a.resultId,b.resultId);assert.equal(a.totalMatches,0);assert.equal(a.matches.length,0);assert.equal(a.nextOffset,null);assert(x.docs.results.get(a.resultId).answer.includes('字面命中总数：0'));
});
test('artifact readback pages remain available within evidence budget instead of forcing a read loop',t=>{
 const x=fixture(t,'synthetic needle'),messages=Array.from({length:4},(_,i)=>({role:'tool',content:JSON.stringify({callId:'page'+i,tool:'read_artifact',status:'ok',data:{artifactId:'delivery-one',text:`page ${i} `+'original '.repeat(400),totalChars:14000,nextOffset:i===3?null:(i+1)*3500}})}));
 messages.push(...Array.from({length:3},(_,i)=>({role:'tool',content:JSON.stringify({callId:'later'+i,status:'ok',data:{}})})));
 compactHistory(messages,x.docs.directory,{evidenceBudgetChars:20000});
 for(let i=0;i<4;i++){const page=JSON.parse(messages[i].content);assert.equal(page.contextReceipt,undefined);assert(page.data.text.startsWith(`page ${i} `));}
 assert.equal(JSON.parse(messages[3].content).data.nextOffset,null);
});
