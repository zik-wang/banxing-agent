import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {WebWorkspace} from '../v8-web/server.mjs';import {revisionBinding} from '../v8-web/revision-binding.mjs';import {applyReportEdits,readRevisionBase} from '../v8-tools/report-revision.mjs';import {digest} from '../v8-tools/resource-space.mjs';import {reportPreflight} from '../v8-tools/report-preflight.mjs';
import {executionIntent} from '../v8-tools/execution-intent.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'revision-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const w=new WebWorkspace({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.1:9/v1',model:'offline-test'}}),v=w.newConversation(),c=w.conversation(v.id);w.upload(c.id,'A.txt',Buffer.from('Synthetic A'));w.upload(c.id,'B.txt',Buffer.from('Synthetic B'));const ref=w.space.put({projectId:c.workspaceId,workItemId:c.workItemId,kind:'result',bytes:Buffer.from('{"schemaVersion":1,"artifacts":[]}'),parents:c.files.map(f=>f.ref),metadata:{bundle:true}});w.space.select(c.workspaceId,c.workItemId,ref,0);c.turns.push({id:'old',status:'completed',request:'生成报告',answer:'已交付，请下载。',resultRef:ref,artifacts:[{artifactId:'old-artifact',path:path.join(root,'report.md'),sha256:digest('synthetic report'),kind:'text'}]});return {w,c,ref,root};}
test('same selected source files retain current result in the actual spawned revision profile',async t=>{const {w,c,ref,root}=setup(t);let profile;w.spawnRun=(_bin,args)=>{profile=JSON.parse(fs.readFileSync(args[1]));const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdout.end();child.stderr.end();return child;};await w.start(c.id,{message:'请只局部修改刚才报告的状态，其他内容保留，另存Markdown',fileIds:c.files.map(f=>f.id),useConversationFiles:false});assert.deepEqual(profile.continuity.selectedResult,ref);assert.equal(profile.continuity.resultSelectionReason,'revision_with_unchanged_sources');assert.deepEqual(profile.revisionArtifactIds,['old-artifact']);assert.deepEqual(profile.continuity.selectedInputs,c.files.map(f=>f.ref));await new Promise(r=>setTimeout(r,80));});
test('new sources, exclusions, fresh tasks and foreign conversation results do not inherit the old report',t=>{const {w,c,ref}=setup(t),ids=c.files.map(f=>f.id);const modify='只修改报告状态';assert.equal(revisionBinding(w,c,modify,ids.slice(1)).current,null);assert.equal(revisionBinding(w,c,modify,ids,{scopeChanged:true}).current,null);assert.equal(revisionBinding(w,c,modify,ids,{clarification:true}).current,null);assert.equal(revisionBinding(w,c,'重新审核附件',ids).current,null);w.upload(c.id,'C.txt',Buffer.from('Synthetic C'));assert.equal(revisionBinding(w,c,modify,c.files.map(f=>f.id)).current,null);c.turns=[];assert.equal(revisionBinding(w,c,modify,ids).current,null);assert.deepEqual(w.space.work(c.workspaceId,c.workItemId).current,ref);});
test('save-copy keeps the current authorized result but does not override exclusions or fresh review',t=>{
 const {w,c,ref}=setup(t),ids=c.files.map(f=>f.id);
 for(const request of ['把刚才的报告另存一份，正文不改，给我Markdown。','把刚才文件另存一份发我','保存一份副本']){
  assert.equal(executionIntent(request).operation,'convert',request);
  assert.deepEqual(revisionBinding(w,c,request,ids).current,ref);
  assert.equal(revisionBinding(w,c,request,ids.slice(1)).current,null);
 }
 assert.notEqual(executionIntent('不要另存一份，只回答问题。').operation,'convert');
 assert.notEqual(executionIntent('正文不要另存，只回答问题。').operation,'convert');
 assert.equal(executionIntent('重新审核附件并另存一份Word').operation,'review');
});
test('local patches preserve all other lines, table columns and CRLF byte-for-byte',()=>{const body='# 表\r\n\r\n|序号|状态|金额|\r\n|1|进行中|12.50|\r\n|2|未知|99|\r\n';const r=applyReportEdits(body,JSON.stringify({edits:[{before:'|1|进行中|12.50|',after:'|1|计划|12.50|',reason:'合成原文为将开展'}]}));assert.equal(r.body,body.replace('|1|进行中|12.50|','|1|计划|12.50|'));assert.equal(r.receipt.unchangedSpansPreserved,true);assert.equal(r.receipt.semanticVerified,false);});
test('ambiguous, duplicate, multiline anchors and full-report substitutions are rejected',()=>{for(const edits of [[{before:'重复',after:'新值',reason:'x'}],[{before:'唯一\n其他',after:'新值',reason:'x'}],[{before:'不存在',after:'a',reason:'x'}],[{before:'唯一',after:'a',reason:'x'},{before:'唯一',after:'b',reason:'x'}]])assert.throws(()=>applyReportEdits('重复\n重复\n唯一',JSON.stringify({edits})),/修改|位置/);assert.throws(()=>applyReportEdits('原报告','# 重写整篇'));});
function baseFixture(text){const a={artifactId:'a',kind:'text',path:'report.md',sha256:digest(text)},ref={resourceId:'r',revisionId:'v'};return{docs:{continuity:{result:ref,projectId:'p',allowed:()=>{},space:{read:()=>Buffer.from(JSON.stringify({artifacts:[{record:a}]}))}}},config:{revisionArtifactIds:['a']},a};}
for(const recovered of [true,false])test('empty local edit is rechecked once, never exported as a successful revision: '+recovered,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'revision-empty-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const body='# 报告\n状态：进行中\n',x=baseFixture(body);let models=0,saves=0;
 Object.assign(x.docs,{directory:root,assets:new Map([['s',{id:'s',sourceId:'s',name:'synthetic.txt',kind:'text',sha256:'s'}]]),turnIntent:{operation:'modify',formats:['md']}});x.config.documentComposition=true;
 const result=await reportPreflight({...x,request:'只修改状态，其他内容保留',harness:{execute:async(name,args)=>{if(name==='save_draft'){saves++;assert.equal(args.content,'# 报告\n状态：计划\n');}return{status:'ok',data:name==='read_artifact'?{text:body,totalChars:body.length,nextOffset:null}:name==='read_text_range'?{text:'将开展工作',nextOffset:null}:{artifactId:'new',saveReadbackPassed:true}};}},next:async()=>({content:JSON.stringify({edits:++models===2&&recovered?[{before:'状态：进行中',after:'状态：计划',reason:'合成来源为将开展'}]:[]})})});
 assert.equal(models,2);assert.equal(saves,recovered?1:0);assert.equal(recovered?result.completed:result.needsInput,true);if(!recovered)assert.equal(result.completed,undefined);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'report-revision-recovery.json'))).finalEdits,recovered?1:0);
});
test('read base consumes every page and binds original artifact SHA, not the chat receipt',async()=>{const text='真实的合成原稿'.repeat(1000),x=baseFixture(text),offsets=[];const r=await readRevisionBase(x.docs,x.config,async(name,args)=>{assert.equal(name,'read_artifact');offsets.push(args.offset);return{text:text.slice(args.offset,args.offset+3000),totalChars:text.length,nextOffset:args.offset+3000<text.length?args.offset+3000:null};});assert.equal(r.text,text);assert.ok(offsets.length>1);assert.equal(r.sha256,digest(text));await assert.rejects(readRevisionBase(x.docs,x.config,async()=>({text:'wrong',totalChars:5,nextOffset:null})),/SHA256/);});
test('host compilation revises the actual report with source evidence; unrelated table content survives',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'revision-compose-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const original='# 合成报告\n\n|事项|状态|金额|\n|条目A|进行中|12.50|\n|条目B|未明确|66|\n',x=baseFixture(original),calls=[];Object.assign(x.docs,{directory:root,assets:new Map([['s',{id:'s',sourceId:'s',kind:'text',name:'synthetic.txt',sha256:'s'}]]),turnIntent:{operation:'modify',formats:['md']}});Object.assign(x.config,{documentComposition:true,previousWorkProduct:{previousStatus:'completed',previousAnswer:'已导出，点击下载'}});const r=await reportPreflight({...x,request:'只局部修改状态，其他内容保留',harness:{execute:async(name,args)=>{calls.push({name,args});return{status:'ok',data:name==='read_artifact'?{text:original,totalChars:original.length,nextOffset:null}:name==='read_text_range'?{text:'条目A将开展。',nextOffset:null}:{artifactId:'new',saveReadbackPassed:true,draft_ref:'draft:new'}};}},next:async messages=>{assert.doesNotMatch(messages[0].content,/输出实际Markdown正文/);assert.match(messages[0].content,/JSON编辑协议/);const input=JSON.parse(messages[1].content);assert.equal(input.priorDraft,original);assert.equal(input.priorArtifact.sha256,digest(original));assert.equal(input.authorizedSources[0].text,'条目A将开展。');return{content:JSON.stringify({edits:[{before:'|条目A|进行中|12.50|',after:'|条目A|计划|12.50|',reason:'原文将开展'}]})};}});assert.equal(r.completed,true);assert.deepEqual(calls.map(c=>c.name),['read_artifact','read_text_range','save_draft']);assert.equal(calls.at(-1).args.content,original.replace('|条目A|进行中|12.50|','|条目A|计划|12.50|'));const receipt=JSON.parse(fs.readFileSync(path.join(root,'report-composition.json')));assert.equal(receipt.revisionReceipt.edits.length,1);assert.equal(receipt.revisionBase.artifactId,'a');});

function wordFixture(){
 const body='事项：保留\n5. 原条件\n',x=baseFixture('synthetic-docx-bytes'),sourceRefs=[{id:'s',sha256:'source-v1'}],version=digest(JSON.stringify({sha256:digest(body),sources:sourceRefs}));
 const draft={resultId:'draft:'+version,method:'submitted_draft',title:'当前报告',answer:body,sha256:digest(body),version,sourceRefs};
 Object.assign(x.a,{kind:'docx',path:'current.docx',title:draft.title,draftRef:draft.resultId,draftVersion:version,wordSource:{text:body,tables:[]}});
 x.docs.results=new Map([[draft.resultId,draft]]);x.docs.asset=id=>{assert.equal(id,'s');return{sha256:'source-v1'}};x.draft=draft;
 return x;
}

function historicalWordFixture(){
 const x=wordFixture(),c=x.docs.continuity,read=c.space.read,parent={resourceId:'checkpoint',revisionId:'immutable'},checkpoint={schemaVersion:1,artifacts:[{record:x.a}],results:[x.draft]},accessed=[];
 x.docs.results.clear();c.allowed=ref=>{accessed.push(ref);if(ref===c.result)return{parents:[parent]};assert.deepEqual(ref,parent);return{metadata:{bundle:true}}};
 c.space.read=(_project,ref)=>ref===parent?Buffer.from(JSON.stringify(checkpoint)):read();
 return{...x,parent,checkpoint,accessed};
}
test('historical selected Word restores its draft from its authorized checkpoint, without reading unrelated history',async()=>{
 const x=historicalWordFixture(),r=await readRevisionBase(x.docs,x.config,async()=>({artifactId:'a',sha256:x.a.sha256,exportIntegrityPassed:true}));
 assert.equal(r.text,'# 当前报告\n\n'+x.draft.answer);assert.deepEqual(x.docs.results.get(x.draft.resultId),x.draft);assert.ok(x.accessed.includes(x.parent));
});
for(const mode of ['missing','tampered','different-artifact','revoked'])test('historical Word does not substitute '+mode+' checkpoint evidence',async()=>{
 const x=historicalWordFixture();if(mode==='missing')x.checkpoint.results=[];if(mode==='tampered')x.draft.answer='changed';if(mode==='different-artifact')x.checkpoint.artifacts=[{record:{...x.a,artifactId:'other'}}];if(mode==='revoked'){const allowed=x.docs.continuity.allowed;x.docs.continuity.allowed=ref=>{if(ref===x.parent)throw Error('RESOURCE_REVOKED');return allowed(ref)}}
 await assert.rejects(readRevisionBase(x.docs,x.config,async()=>{throw Error('should not validate or export')}),/草稿|RESOURCE_REVOKED/);assert.equal(x.docs.results.size,0);
});
test('selected Word revision uses its validated source draft, never an older imported output',async()=>{
 const x=wordFixture(),originalRead=x.docs.continuity.space.read;x.docs.continuity.space.read=()=>{const b=JSON.parse(originalRead());b.artifacts.unshift({record:{...x.a,artifactId:'older',title:'旧报告'}});return Buffer.from(JSON.stringify(b))};
 const calls=[],r=await readRevisionBase(x.docs,x.config,async(name,args)=>{calls.push({name,args});return{artifactId:'a',sha256:x.a.sha256,exportIntegrityPassed:true}});
 assert.deepEqual(calls,[{name:'validate_artifact',args:{artifact_id:'a'}}]);assert.equal(r.text,'# 当前报告\n\n'+x.draft.answer);assert.equal(r.bodySha256,digest(r.text));assert.equal(r.sha256,x.a.sha256);assert.equal(r.representation,'validated_word_source_draft');
});
for(const mode of ['bad-file-hash','failed-readback','wrong-draft','changed-source'])test('Word local revision rejects '+mode,async()=>{
 const x=wordFixture();if(mode==='wrong-draft')x.a.wordSource.text='其他版本';if(mode==='changed-source')x.docs.asset=()=>({sha256:'changed'});
 await assert.rejects(readRevisionBase(x.docs,x.config,async()=>({artifactId:'a',sha256:mode==='bad-file-hash'?'bad':x.a.sha256,exportIntegrityPassed:mode!=='failed-readback'})),/Word|来源版本/);
});
test('imported Word or separately attached workbook tables do not become partial prose revisions',async()=>{
 for(const mode of ['no-draft','separate-tables','ambiguous']){const x=wordFixture();if(mode==='no-draft')delete x.a.draftRef;if(mode==='separate-tables')x.a.wordSource.tables=[{rows:[['retained']]}];if(mode==='ambiguous'){const read=x.docs.continuity.space.read;x.docs.continuity.space.read=()=>{const b=JSON.parse(read());b.artifacts.push({record:{...x.a,artifactId:'b'}});return Buffer.from(JSON.stringify(b))};x.config.revisionArtifactIds.push('b');}
 assert.equal(await readRevisionBase(x.docs,x.config,async()=>{throw Error('must not call tools')}),null);}
});

test('one prose anchor may expand into readable paragraphs without changing neighboring content',()=>{const before='# 合成报告\r\n5. 原条件\r\n6. 保留99.50\r\n';const r=applyReportEdits(before,JSON.stringify({edits:[{before:'5. 原条件',after:'5. 路径说明\n   - 方式甲：配置示例\n   - 方式乙：未提供',reason:'合成需求要求分路径说明'}]}));assert.equal(r.body,'# 合成报告\r\n5. 路径说明\n   - 方式甲：配置示例\n   - 方式乙：未提供\r\n6. 保留99.50\r\n');assert.equal(r.receipt.unchangedSpansPreserved,true);assert.throws(()=>applyReportEdits('|A|10|',JSON.stringify({edits:[{before:'|A|10|',after:'|A|10|\n|B|20|',reason:'不能拆记录'}]})),/表格/);});

test('Word retrieval-only checkpoint recovers exact draft through selected artifact lineage',async()=>{
 const x=historicalWordFixture(),c=x.docs.continuity,origin={resourceId:'origin',revisionId:'v1'},oldAllowed=c.allowed,oldRead=c.space.read;
 const snapshot=structuredClone(x.checkpoint);x.checkpoint.results=[];
 c.allowed=ref=>{if(ref===origin)return{metadata:{bundle:true},parents:[]};const v=oldAllowed(ref);return ref===x.parent?{...v,parents:[origin]}:v;};
 c.space.read=(p,ref)=>ref===origin?Buffer.from(JSON.stringify(snapshot)):oldRead(p,ref);
 const r=await readRevisionBase(x.docs,x.config,async()=>({artifactId:'a',sha256:x.a.sha256,exportIntegrityPassed:true}));assert.equal(r.text,'# 当前报告\n\n'+x.draft.answer);
});
for(const mode of ['different-artifact','revoked','cycle','conflicting'])test('retrieval lineage preserves '+mode+' boundary',async()=>{
 const x=historicalWordFixture(),c=x.docs.continuity,origin={resourceId:'origin',revisionId:'v1'},second={resourceId:'second',revisionId:'v2'},oldAllowed=c.allowed,oldRead=c.space.read,snapshot=structuredClone(x.checkpoint);x.checkpoint.results=[];
 if(mode==='different-artifact')snapshot.artifacts[0].record.artifactId='foreign';
 c.allowed=ref=>{if(ref===origin){if(mode==='revoked')throw Error('RESOURCE_REVOKED');return{metadata:{bundle:true},parents:[]}}if(ref===second)return{metadata:{bundle:true},parents:[]};const v=oldAllowed(ref);return ref===x.parent?{...v,parents:mode==='cycle'?[x.parent]:mode==='conflicting'?[origin,second]:[origin]}:v;};
 c.space.read=(p,ref)=>ref===origin?Buffer.from(JSON.stringify(snapshot)):ref===second?Buffer.from(JSON.stringify({...snapshot,results:[{...x.draft,title:'Conflicting title'}]})):oldRead(p,ref);
 await assert.rejects(readRevisionBase(x.docs,x.config,async()=>{throw Error('must not validate foreign or ambiguous draft')}),/草稿|RESOURCE_REVOKED/);assert.equal(x.docs.results.size,0);
});
