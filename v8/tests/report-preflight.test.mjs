import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{reportPreflight}from'../v8-tools/report-preflight.mjs';
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'report-host-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const calls=[];const docs={directory:dir,assets:new Map([['a',{id:'a',sourceId:'a',kind:'text',name:'real.txt',sha256:'source-hash'}]]),turnIntent:{operation:'convert',formats:['docx']}};let modelCalls=0;return{docs,calls,config:{documentComposition:true},request:'整理成Word',harness:{execute:async(name,args)=>{calls.push({name,args});return{status:'ok',data:name==='read_text_range'?{text:'确切原文',nextOffset:null}:{artifactId:'actual',saveReadbackPassed:true,draft_ref:'draft:saved'}};}},next:async(messages,tools)=>{modelCalls++;assert.deepEqual(tools,[]);assert.match(messages[1].content,/确切原文/);return{content:'# 报告\n正文，未知待确认。'};},modelCount:()=>modelCalls};}
test('host reads actual tool text then persists actual prose, never assumes model exported',async t=>{const x=setup(t);const r=await reportPreflight(x);assert.equal(r.completed,true);assert.equal(x.modelCount(),1);assert.deepEqual(x.calls.map(x=>x.name),['read_text_range','save_draft']);assert.equal(x.calls[1].args.content,'正文，未知待确认。');});
test('conversion of successful authorized previous answer uses no new inference',async t=>{const x=setup(t);x.config.interactionContext={previousStatus:'answered',previousAnswer:'已有实际回复',previousTurnId:'t'};const r=await reportPreflight(x);assert.equal(x.modelCount(),0);assert.equal(x.calls[0].args.content,'已有实际回复');assert.match(r.message,/仅转换/);});

test('retrieving an existing Word never enters the prose compiler even with a previous answer',async t=>{
 const x=setup(t);x.docs.turnIntent={operation:'retrieve',kind:'existing_file',formats:['docx']};x.config.interactionContext={previousStatus:'completed',previousAnswer:'已有文稿'};
 assert.equal(await reportPreflight(x),null);assert.equal(x.calls.length,0);assert.equal(x.modelCount(),0);
});
test('failed previous answer cannot become a successful cached report',async t=>{const x=setup(t);x.config.interactionContext={previousStatus:'failed',previousAnswer:'错误提示'};await reportPreflight(x);assert.equal(x.modelCount(),1);assert.notEqual(x.calls.at(-1).args.content,'错误提示');});
test('audio, source code, knowledge and no-output turns do not enter report compiler',async t=>{for(const alter of [x=>x.docs.assets.get('a').kind='audio',x=>x.docs.assets.get('a').name='file.py',x=>x.request='知识库整理成Word',x=>x.docs.turnIntent.noNewFiles=true]){const x=setup(t);alter(x);assert.equal(await reportPreflight(x),null);assert.equal(x.calls.length,0);}});
test('PDF report requires every actual page and records text-only scope',async t=>{const x=setup(t);x.docs.assets.get('a').kind='pdf';x.docs.results=new Map();x.harness.execute=async(name,args)=>{x.calls.push({name,args});if(name==='inspect_material')return{status:'ok',data:{pages:2}};if(name==='extract_pdf_text')return{status:'ok',data:{text:'确切原文 第'+args.page+'页'}};return{status:'ok',data:{artifactId:'actual',saveReadbackPassed:true,draft_ref:'draft:actual'}};};await reportPreflight(x);assert.deepEqual(x.calls.filter(c=>c.name==='extract_pdf_text').map(c=>c.args.page),[1,2]);});
test('empty scanned PDF page never becomes a completed report',async t=>{const x=setup(t);x.docs.assets.get('a').kind='pdf';x.docs.results=new Map();x.harness.execute=async name=>({status:'ok',data:name==='inspect_material'?{pages:1}:{text:''}});const r=await reportPreflight(x);assert.equal(r.needsInput,true);assert.equal(x.modelCount(),0);});
test('content revision uses original evidence plus full prior draft rather than converting an old answer unchanged',async t=>{const x=setup(t);x.docs.turnIntent.requiresReprocessing=true;x.config.previousWorkProduct={previousStatus:'completed',previousAnswer:'旧稿'+'.'.repeat(12000),previousTurnId:'t'};x.next=async messages=>{const user=JSON.parse(messages[1].content);assert.equal(user.priorDraft.length,12002);assert.equal(user.authorizedSources[0].text,'确切原文');return{content:'# 修订报告\n修订后的实际正文'};};await reportPreflight(x);assert.equal(x.calls.at(-1).args.content,'修订后的实际正文');});

test('an oversized report gets one source-bound rewrite and exports the actual revised draft',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:30};let drafts=0,models=0;
 x.next=async messages=>{models++;if(models===1)return{content:'# 过长草稿\n'+ '正文'.repeat(40)};const input=JSON.parse(messages[1].content);assert.equal(input.maxChars,30);assert.ok(input.observedChars>30);assert.ok(input.targetChars<30);assert.equal(input.authorizedSources[0].text,'确切原文');return{content:'# 短报告\n确切原文，未明确内容待确认。'};};
 x.harness.execute=async(name,args)=>{x.calls.push({name,args});if(name==='read_text_range')return{status:'ok',data:{text:'确切原文',nextOffset:null}};drafts++;return{status:'ok',data:drafts===1?{draft_ref:'draft:long',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',message:'超限'}}:{artifactId:'actual-short',draft_ref:'draft:short',saveReadbackPassed:true}};};
 const r=await reportPreflight(x);assert.equal(r.completed,true);assert.equal(models,2);assert.equal(drafts,2);assert.equal(x.calls.at(-1).args.content,'确切原文，未明确内容待确认。');
 assert.equal(JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json'))).lengthRecovery.accepted,true);
});

test('a second oversized draft stays failed with both drafts preserved; no infinite rewrite',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:10};let models=0,saves=0;
 x.next=async()=>{models++;return{content:'# 仍超限\n'+ '过长'.repeat(30)};};
 x.harness.execute=async(name)=>({status:'ok',data:name==='read_text_range'?{text:'确切原文',nextOffset:null}:{draft_ref:'draft:'+(++saves),renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',message:'未满足篇幅'}}});
 const r=await reportPreflight(x);assert.equal(r.failed,true);assert.equal(r.completed,undefined);assert.equal(models,2);assert.equal(saves,2);assert.equal(r.draftRef,'draft:2');
});

test('compact length recovery renders actual paragraphs rather than exporting protocol JSON',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:800};let models=0,saves=0;
 x.next=async messages=>{models++;if(models===1)return{content:'# 长稿\n'+'原文'.repeat(500)};const input=JSON.parse(messages[1].content);assert.ok(input.paragraphTargetChars>0&&input.paragraphTargetChars<100);return{content:JSON.stringify({title:'核对说明',paragraphs:['确切原文。','未明确内容待确认。']})};};
 x.harness.execute=async(name,args)=>{x.calls.push({name,args});if(name==='read_text_range')return{status:'ok',data:{text:'确切原文',nextOffset:null}};return{status:'ok',data:++saves===1?{draft_ref:'draft:long',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',details:{actualChars:1002}}}:{artifactId:'short',saveReadbackPassed:true,draft_ref:'draft:short'}};};
 const result=await reportPreflight(x);assert.equal(result.completed,true);assert.equal(models,2);assert.equal(x.calls.at(-1).args.title,'核对说明');assert.equal(x.calls.at(-1).args.content,'确切原文。\n\n未明确内容待确认。');
});

test('malformed compact output preserves saved draft and bounded failure rather than exporting JSON debris',async t=>{
 for(const output of ['{"title":"断开","paragraphs":[','{"title":"错误","paragraphs":[{"text":"不合法"}]}']){
  const x=setup(t);x.docs.turnIntent.length={maxChars:10};let models=0,saves=0;
  x.next=async()=>({content:++models===1?'# 长稿\n'+ '原文'.repeat(30):output});
  x.harness.execute=async name=>({status:'ok',data:name==='read_text_range'?{text:'确切原文',nextOffset:null}:{draft_ref:'draft:retained',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',details:{actualChars:62}}}});
  const result=await reportPreflight(x);assert.equal(result.failed,true);assert.equal(models,2);assert.equal(result.draftRef,'draft:retained');assert.ok(JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json'))).lengthRecovery.error);
 }
});

test('length recovery keeps source-backed full company labels and rejects shortened replacements',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:100};let models=0,saves=0;
 x.next=async messages=>{if(++models===1)return{content:'# 说明\n供应商：示例设备股份有限公司。'+ '冗长原文。'.repeat(30)};const input=JSON.parse(messages[1].content);assert.deepEqual(input.requiredVerbatim,['示例设备股份有限公司']);return{content:JSON.stringify({title:'说明',paragraphs:['供应商：示例设备。']})};};
 x.harness.execute=async(name)=>({status:'ok',data:name==='read_text_range'?{text:'供应商：示例设备股份有限公司\n另有：其他软件有限公司',nextOffset:null}:(saves++,{draft_ref:'draft:retained',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',details:{actualChars:200}}})});
 const result=await reportPreflight(x);assert.equal(result.failed,true);assert.equal(models,2);assert.equal(saves,1);assert.equal(JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json'))).lengthRecovery.error.code,'SOURCE_LABELS_CHANGED');
});

test('adjacent source company labels stay separate names rather than a fabricated compound identity',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:200};let models=0,saves=0;
 x.next=async messages=>{if(++models===1)return{content:'# 说明\n甲设备有限公司乙软件有限责任公司。'+ '重复说明。'.repeat(50)};const input=JSON.parse(messages[1].content);assert.deepEqual(input.requiredVerbatim,['甲设备有限公司','乙软件有限责任公司']);return{content:JSON.stringify({title:'说明',paragraphs:['采购方包括甲设备有限公司、乙软件有限责任公司。']})};};
 x.harness.execute=async(name)=>({status:'ok',data:name==='read_text_range'?{text:'采购方：甲设备有限公司乙软件有限责任公司',nextOffset:null}:++saves===1?{draft_ref:'draft:long',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',details:{actualChars:300}}}:{artifactId:'short',saveReadbackPassed:true,draft_ref:'draft:short'}});
 assert.equal((await reportPreflight(x)).completed,true);assert.equal(models,2);
});

test('omitted ancillary company is recorded separately from a shortened company replacement',async t=>{
 const x=setup(t);x.docs.turnIntent.length={maxChars:100};let models=0,saves=0;
 x.next=async()=>({content:++models===1?'# 说明\n供应商：示例设备股份有限公司。代理方：其他服务有限公司。'+ '冗长说明。'.repeat(30):JSON.stringify({title:'说明',paragraphs:['供应商：示例设备股份有限公司。']})});
 x.harness.execute=async(name)=>({status:'ok',data:name==='read_text_range'?{text:'供应商：示例设备股份有限公司\n代理方：其他服务有限公司',nextOffset:null}:++saves===1?{draft_ref:'draft:long',renderFailure:{code:'DOCUMENT_LENGTH_LIMIT',details:{actualChars:200}}}:{artifactId:'short',saveReadbackPassed:true,draft_ref:'draft:short'}});
 assert.equal((await reportPreflight(x)).completed,true);assert.equal(models,2);const audit=JSON.parse(fs.readFileSync(path.join(x.docs.directory,'report-composition.json')));assert.deepEqual(audit.lengthRecovery.unrepeatedSourceLabels,['其他服务有限公司']);assert.equal(audit.semanticVerified,false);
});
