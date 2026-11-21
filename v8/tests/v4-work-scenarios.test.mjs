import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {Store} from '../core.mjs';
import {Harness} from '../runtime.mjs';
import {Workspace} from '../workspace.mjs';
import {SCENARIOS} from '../scenarios.mjs';
import {WORK_SCENARIOS} from '../work-scenario-catalog.mjs';
import {WORKFLOW_KEYS,ACTION_PHRASES,ConversationActions} from '../conversation-actions.mjs';
import {sampleFiles} from '../samples.mjs';
import {readOriginal} from '../workspace-files.mjs';
import {resolveArtifact} from '../artifacts.mjs';
import {fixtureWorkAnalysis} from './work-scenarios-fixture.mjs';

async function fixture(t,id,analyze=fixtureWorkAnalysis){
 const root=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(root,'v4-work-scenarios-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),root);assert(path.basename(directory).startsWith('v4-work-scenarios-'));fs.rmSync(directory,{recursive:true,force:true});});
 const store=new Store(directory),harness=new Harness(store),workspace=new Workspace(store,harness,{analyze}),files=[];
 for(const input of await sampleFiles(id))files.push(await workspace.upload(input));
 return {store,harness,workspace,files};
}
async function finish(workspace,job){const end=Date.now()+10000;while(workspace.active.has(job.id)){if(Date.now()>end)throw Error('test job timed out');await new Promise(r=>setTimeout(r,10));}return job;}
async function execute(x,id,options={}){return finish(x.workspace,x.workspace.start({scenarioId:id,fileIds:x.files.map(f=>f.id),options}));}

test('八项语义能力与28场景顺序稳定，原20项不改号',()=>{
 assert.equal(SCENARIOS.length,28);assert.equal(WORKFLOW_KEYS.length,28);
 for(const s of WORK_SCENARIOS){assert.equal(SCENARIOS[WORKFLOW_KEYS.indexOf(s.key)].id,s.id);assert.equal(ACTION_PHRASES[s.id],s.say);}
 assert.equal(WORKFLOW_KEYS[7],'compare_versions');assert.equal(WORKFLOW_KEYS[19],'inspect_services');
});
for(const id of ['21','22','24','25','26','27','28'])test('工作场景'+id+'交付来源可核查的真实文件，不自动写入外部记录',async t=>{
 const x=await fixture(t,id),before=x.store.state.tasks.length,job=await execute(x,id);
 assert.notEqual(job.status,'failed',job.error);assert(job.workResult?.items.length);assert(job.artifacts.length>=3);
 for(const f of x.files)assert(readOriginal(x.store,f));
 const file=job.artifacts.find(a=>a.name.endsWith('-结构化结果.json'));
 assert.equal(JSON.parse(resolveArtifact(x.store,job.id,file.id).bytes).scenarioId,id);
 assert(job.checks.every(c=>c.passed));assert.equal(x.store.state.tasks.length,before);
 if(id==='21'){assert.equal(job.status,'waiting_input');assert.equal(job.workResult.items[1].status,'needs_clarification');}
 if(id==='22'){assert.equal(job.workResult.items[1].status,'missing');assert.equal(job.status,'waiting_input');}
 if(id==='25')assert.deepEqual(job.workResult.blockers.find(r=>r.key==='TASK3').roots[0].chain,['TASK3','TASK2','TASK1']);
 if(id==='26')assert.equal(job.status,'waiting_input');
 if(id==='27'){assert.equal(job.workResult.items[0].status,'open');assert.equal(job.workResult.items[1].status,'resolved');}
 if(id==='28'){assert.equal(job.workResult.items[0].status,'needs_confirmation');assert.equal(job.workResult.items[1].status,'available');}
});
test('原始对账按整数分计算0.10+0.20、差额与重复，不接受模型提供合计',async t=>{
 const x=await fixture(t,'23'),job=await execute(x,'23');assert.equal(job.status,'waiting_input',job.error);
 assert.deepEqual(job.workResult.metrics,{leftRows:4,rightRows:3,rowDifference:1,leftUnique:3,rightUnique:3,leftTotal:'5.50',rightTotal:'8.30',amountDifference:'-2.80'});
 assert.equal(job.workResult.duplicates.length,1);assert.equal(job.workResult.differences.length,2);
});
test('对账真实XLSX逐行核算缓存值，同键异状态不误报一致',async t=>{
 const x=await fixture(t,'23',({documents})=>({left:{sourceId:documents[0].id,keyColumns:['编号'],amountColumn:'金额'},right:{sourceId:documents[1].id,keyColumns:['编号'],amountColumn:'金额'}}));x.files=[];
 for(const state of ['已完成','待完成']){const book=new ExcelJS.Workbook(),s=book.addWorksheet('明细');s.addRow(['编号','金额','状态']);s.addRow(['A',0.10,state]);s.addRow(['B',0.20,'已完成']);x.files.push(await x.workspace.upload({name:state+'.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')}));}
 const job=await execute(x,'23');assert.equal(job.workResult.metrics.leftTotal,'0.30');assert.equal(job.workResult.metrics.amountDifference,'0.00');assert.equal(job.workResult.differences[0].type,'field_mismatch');
});
test('一项伪造引用不挡住其余核对，做完后指出跳过项',async t=>{
 const x=await fixture(t,'21',args=>{const r=fixtureWorkAnalysis(args);r.items.push({key:'REQ9',title:'伪造事项',status:'confirmed',basis:[{sourceId:'foreign',quote:'伪造原文'}]});return r;});
 const j=await execute(x,'21');assert.notEqual(j.status,'failed',j.error);assert(j.artifacts.length>=2);assert(j.workResult.items.some(r=>r.key==='REQ1'));assert(!j.workResult.items.some(r=>r.key==='REQ9'));
 assert(j.softNotices.some(n=>n.text.includes('伪造事项')||n.text.includes('伪造原文')));
 const md=resolveArtifact(x.store,j.id,j.artifacts.find(a=>a.name.endsWith('.md')).id).bytes.toString();assert.match(md,/醒目提示/);assert.doesNotMatch(md,/## 伪造事项/);
});
test('空对账键和读不出的金额不中断其余行',async t=>{
 const x=await fixture(t,'23',({documents})=>({left:{sourceId:documents[0].id,keyColumns:['订单编号'],amountColumn:'金额'},right:{sourceId:documents[1].id,keyColumns:['订单编号'],amountColumn:'金额'}}));
 x.files=[await x.workspace.upload({name:'左.csv',base64:Buffer.from('订单编号,金额\nA001,1.00\n,2.00\nA003,不是数字\n').toString('base64')}),await x.workspace.upload({name:'右.csv',base64:Buffer.from('订单编号,金额\nA001,1.00\nA003,3.00\n').toString('base64')})];
 const j=await execute(x,'23');assert.notEqual(j.status,'failed',j.error);assert.equal(j.workResult.metrics.leftTotal,'1.00');assert.equal(j.workResult.metrics.rightTotal,'4.00');
 assert(j.softNotices.some(n=>n.text.includes('对账键是空的')));assert(j.softNotices.some(n=>n.text.includes('不是数字')));
 assert(j.artifacts.some(a=>a.name.endsWith('.md')));
});
test('伪造引用和负责人不能进入交付物，未知筛选不能改对账口径',async t=>{
 const x=await fixture(t,'21',()=>({items:[{key:'REQ1',title:'fake',status:'confirmed',basis:[{sourceId:'foreign',quote:'伪造原文'}]}]}));
 const j=await execute(x,'21');assert.equal(j.status,'failed');assert.equal(j.artifacts.length,0);
 const y=await fixture(t,'23',args=>{const p=fixtureWorkAnalysis(args);p.left.filters=[{column:'状态',equals:'已完成',basis:{sourceId:args.documents[0].id,quote:'A001,0.10,已完成'}}];return p;});
 const bad=await execute(y,'23');assert.notEqual(bad.status,'failed',bad.error);assert(bad.artifacts.length>=2);assert.match((bad.softNotices||[]).map(n=>n.text).join('\n'),/筛选/);assert.equal(bad.workResult.metrics.leftRows,4);assert.equal(bad.workResult.metrics.amountDifference,'-2.80');
});
test('依赖环与缺失节点有回执，不假称清障完成',async t=>{
 const x=await fixture(t,'25',()=>({items:[{key:'TASK1',title:'A',status:'blocked',dependsOn:['TASK2'],basis:[{sourceId:x.files[0].id,quote:'TASK1 依赖TASK2'}]},{key:'TASK2',title:'B',status:'blocked',dependsOn:['TASK1'],basis:[{sourceId:x.files[0].id,quote:'TASK2 依赖TASK1'}]}]}));
 x.files=[await x.workspace.upload({name:'依赖.txt',base64:Buffer.from('TASK1 依赖TASK2\nTASK2 依赖TASK1').toString('base64')})];
 const j=await execute(x,'25');assert.equal(j.status,'waiting_input');assert(j.workResult.blockers[0].roots.some(r=>r.kind==='cycle'));
});
test('补件关联前次结果，遗漏的旧要求标未复查，不凭消失就判已解决',async t=>{
 const x=await fixture(t,'22');const first=await execute(x,'22');
 x.workspace.analyze=args=>{const r=fixtureWorkAnalysis(args);r.items=r.items.slice(0,1);return r;};
 const next=await execute(x,'22',{previousJobId:first.id});assert.equal(next.workResult.lineage.previousJobId,first.id);
 assert.equal(next.workResult.lineage.changes.find(r=>r.key==='DEL2').after,'not_rechecked');
 assert.equal(first.workResult.items.find(r=>r.key==='DEL2').status,'missing');
});
test('关联前次结果不能跨对话，工具模式包含新场景及前次引用参数',async t=>{
 const x=await fixture(t,'21'),first=await execute(x,'21');first.conversationId='another';
 assert.throws(()=>x.workspace.start({scenarioId:'21',fileIds:x.files.map(f=>f.id),options:{previousJobId:first.id}}),/当前对话/);
 const {Type}=await import('typebox'),actions=new ConversationActions(x.store,x.workspace,x.harness),run={id:'r',conversationId:'here',status:'running',sourceFiles:x.files};
 const definition=actions.definitions(run,Type).find(t=>t.name==='run_workflow');assert(definition.parameters.properties.previous_job_id);assert(JSON.stringify(definition.parameters).includes('verify_deliverables'));
});
test('同一事项的负责人可回查原文补定位，未核实字段留空而不阻止有依据的分析',async t=>{
 const x=await fixture(t,'24',args=>{const r=fixtureWorkAnalysis(args);r.items[0].evidence=[];r.items[0].owner='张敏';r.items[1].owner='不存在的人';return r;});
 const j=await execute(x,'24');assert.notEqual(j.status,'failed',j.error);assert.equal(j.workResult.items[0].owner,'张敏');assert.equal(j.workResult.items[1].owner,'');assert(j.warnings.some(w=>w.includes('留空')));
});
test('明确确认补齐后能解除需求待确认状态，而不是被旧模糊描述永久卡住',async t=>{
 const x=await fixture(t,'21'),first=await execute(x,'21');
 const f=await x.workspace.upload({name:'补充确认.txt',base64:Buffer.from('REQ2 确认：页面只显示三个按钮，响应不超过1秒。').toString('base64')});x.files.push(f);
 x.workspace.analyze=args=>{const r=fixtureWorkAnalysis(args);r.items[1].status='confirmed';r.items[1].evidence=[{sourceId:f.id,quote:f.content}];return r;};
 const next=await execute(x,'21',{previousJobId:first.id});assert.equal(next.workResult.needsInput,false);assert.equal(next.workResult.items[1].status,'confirmed');assert.equal(next.workResult.lineage.changes.find(r=>r.key==='REQ2').after,'confirmed');assert.equal(first.workResult.items[1].status,'needs_clarification');
});
test('接手确认可解除交接待办，旧邀请未确认记录不覆盖实际接手回执',async t=>{
 const x=await fixture(t,'26'),first=await execute(x,'26');
 const f=await x.workspace.upload({name:'接手确认.txt',base64:Buffer.from('TASK1 李明确认接手报价事项。\nTASK2 李明确认接手验收资料。').toString('base64')});x.files.push(f);
 x.workspace.analyze=args=>{const r=fixtureWorkAnalysis(args);r.items.forEach(row=>{row.status='accepted';row.evidence=[{sourceId:f.id,quote:f.content.split('\n').find(line=>line.startsWith(row.key))}];});return r;};
 const next=await execute(x,'26',{previousJobId:first.id});assert.equal(next.workResult.needsInput,false);assert(next.workResult.items.every(r=>r.status==='accepted'));assert.notEqual(next.status,'waiting_input');
});
test('明确关联前次问题后，新复测证据可解除旧复现记录，旧回执不被覆盖',async t=>{
 const x=await fixture(t,'27'),first=await execute(x,'27');assert.equal(first.workResult.items[0].status,'open');
 const f=await x.workspace.upload({name:'补充复测.txt',base64:Buffer.from('FB1 新版本复测通过，导出结果不再乱码。').toString('base64')});x.files.push(f);
 x.workspace.analyze=args=>{const r=fixtureWorkAnalysis(args);r.items[0].evidence=[{sourceId:f.id,quote:f.content}];return r;};
 const next=await execute(x,'27',{previousJobId:first.id});assert.equal(next.workResult.items[0].status,'resolved');assert.equal(next.workResult.needsInput,false);assert.equal(first.workResult.items[0].status,'open');
});
