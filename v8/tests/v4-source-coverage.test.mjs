import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sourceInventory,scheduleSource,explicitTransitions,coveredAnalysis,writeCoverageArtifacts} from '../src/evidence/source-coverage.mjs';
import {Store} from '../src/runtime/core.mjs';
import {resolveArtifact} from '../src/documents/artifacts.mjs';

const file=(id,content)=>({id,name:id+'.txt',content,sha256:createHash('sha256').update(content).digest('hex')});
function fixture(t,files,analyze){
  const base=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'v6-coverage-'));
  t.after(()=>{assert.equal(path.dirname(dir),base);assert(path.basename(dir).startsWith('v6-coverage-'));fs.rmSync(dir,{recursive:true,force:true});});
  const store=new Store(dir),job={id:'coverage-test',rules:'按原文找变化',artifacts:[],warnings:[],checks:[],status:'running'};store.state.jobs||=[];store.state.jobs.push(job);
  return {store,job,files,analyze,log:()=>{},harness:{modelStatus:()=>({modelName:'fixture'})},signal:new AbortController().signal};
}
const contextOnly=({documents})=>({items:[],dispositions:[{unitIds:documents.flatMap(d=>d.focusIds),status:'context',reason:'已知测试上下文'}]});

test('源单元偏移保留原文，文件顺序变化不会改变单元和条款身份',()=>{
  const a=file('a','  一、要求\n\n不得删除；金额≥0.10元。\n尾部要求。'),b=file('b','另一个文件');
  const one=sourceInventory([a,b]),two=sourceInventory([b,a]);
  for(const u of one.units){const f=[a,b].find(f=>f.id===u.sourceId);assert.equal(f.content.slice(u.start,u.end),u.text);assert(two.units.some(v=>v.id===u.id&&v.regionId===u.regionId));}
  assert.equal(new Set(scheduleSource(one).flatMap(c=>c.map(u=>u.id))).size,one.units.length);
});

test('两个同项目子条款分别保留，否定与单位不因规范化消失',()=>{
  const source=file('same','一、项目P指标1，由：\n不得少于64MB\n调整为：\n不得少于32MB\n二、项目P指标2，由：\n不少于16TB 10K\n调整为：\n不少于16TB');
  const groups=explicitTransitions(sourceInventory([source]));assert.equal(groups.length,2);assert.notEqual(groups[0].id,groups[1].id);assert.equal(groups[0].removed[0].text,'不得少于64MB');assert.equal(groups[0].added[0].text,'不得少于32MB');
});

test('超过80个片段仍处理末尾，账本和最终事项均可回读',async t=>{
  const f=file('long',Array.from({length:95},(_,i)=>'记录'+i+'：'+(i===94?'最后一项必须保留':'背景说明')).join('\n'));
  const ctx=fixture(t,[f],args=>{const units=args.documents.flatMap(d=>d.units),last=units.find(u=>u.text.includes('最后一项'));return {items:last?[{title:'末尾要求',status:'needs_confirmation',basis:[{sourceId:'long',unitIds:[last.id]}]}]:[],dispositions:[{unitIds:args.documents.flatMap(d=>d.focusIds).filter(id=>id!==last?.id),status:'context',reason:'已知测试背景'}]};});
  const result=await coveredAnalysis(ctx,{kind:'compare',instruction:'保留末尾',useCache:false});assert.equal(result.coverage.sourceUnits,95);assert.equal(result.coverage.extractProcessed,95);assert.equal(result.coverage.auditProcessed,95);assert(result.raw.items.some(i=>i.title==='末尾要求'));writeCoverageArtifacts(ctx,result);const a=ctx.job.artifacts.find(a=>a.name==='来源覆盖与候选账本.json');assert.equal(JSON.parse(resolveArtifact(ctx.store,ctx.job.id,a.id).bytes).inventory.units.length,95);
});

test('未处置区域触发补读，伪造来源保留在候选账本而不冒充事实',async t=>{
  let primary=0;const ctx=fixture(t,[file('a','必须保留的事项')],args=>{
    const id=args.documents[0].focusIds[0];if(args.coverage.pass==='extract'&&primary++===0)return {items:[{title:'有效事项',status:'changed',basis:[{sourceId:'a',unitIds:['foreign']}]}],dispositions:[]};
    return {items:[{title:'有效事项',status:'changed',basis:[{sourceId:'a',unitIds:[id]}]}],dispositions:[]};
  });
  const r=await coveredAnalysis(ctx,{kind:'compare',instruction:'核对',useCache:false});assert(r.ledger.receipts.some(x=>x.repair));assert(r.ledger.candidates.some(c=>c.issues.length&&c.raw.basis[0].unitIds[0]==='foreign'));assert.equal(r.coverage.sourceUnresolved,0);assert(r.raw.items.every(i=>i.basis.every(b=>b.unitId!=='foreign')));
});

test('模型把相同SSD规格说成变化，程序保留原始候选并登记纠正',async t=>{
  const f=file('a','一、设备指标，由：\n机械盘16TB 10K\n固态盘960GB\n调整为：\n机械盘16TB\n固态盘960GB');
  const ctx=fixture(t,[f],args=>{const ssd=args.documents.flatMap(d=>d.units).filter(u=>u.text==='固态盘960GB');return {items:[{title:'固态盘变化',status:'changed',basis:[{sourceId:'a',unitIds:ssd.map(u=>u.id)}]}],dispositions:[{unitIds:args.documents.flatMap(d=>d.focusIds).filter(id=>!ssd.some(u=>u.id===id)),status:'context',reason:'其余测试上下文'}]};});
  const r=await coveredAnalysis(ctx,{kind:'compare',instruction:'比较',useCache:false});assert.equal(r.groups.length,1);assert(r.raw.items.length>=2);assert.match(r.raw.items[0].programComparison.removed[0].text,/10K/);assert(r.ledger.corrections.length>=1);assert(r.raw.items.filter(i=>i.candidateId).every(i=>i.status==='needs_confirmation'));assert(r.ledger.candidateDispositions.every(d=>['formal','duplicate'].includes(d.disposition)));assert(r.ledger.candidates.some(c=>c.raw.title==='固态盘变化'));
});

test('调用预算耗尽与截断输入不可能被记为全文覆盖',async t=>{
  const f={...file('a','正文\n末尾'),truncated:true};const ctx=fixture(t,[f],contextOnly);
  const r=await coveredAnalysis(ctx,{kind:'compare',instruction:'核对',maxCalls:0,useCache:false});assert.equal(r.coverage.extractProcessed,0);assert.equal(r.coverage.auditProcessed,0);assert(r.ledger.unresolved.some(x=>x.kind==='source'));assert(r.ledger.unresolved.some(x=>x.kind==='unprocessed'));assert(ctx.job.warnings.length);
});

test('同一材料与规则复用缓存，规则变化必须重新读',async t=>{
  let calls=0;const ctx=fixture(t,[file('a','正文')],args=>{calls++;return contextOnly(args);});
  await coveredAnalysis(ctx,{kind:'compare',instruction:'核对'});const before=calls;
  const reused=await coveredAnalysis(ctx,{kind:'compare',instruction:'核对'});assert.equal(calls,before);assert(reused.coverage.cacheHits>=2);
  ctx.job.rules='改为查遗漏';await coveredAnalysis(ctx,{kind:'compare',instruction:'核对'});assert(calls>before);
});

test('分段比较仍提供另一版上下文，不把只读对照当作目标已遍历',async t=>{
  let sawCounterpart=false;
  const a=file('a',Array.from({length:225},(_,i)=>'旧版内容'+i).join('\n')),b=file('b','新版：2026-10-20');
  const ctx=fixture(t,[a,b],args=>{if(args.documents.some(d=>d.id==='a'&&d.focusIds.length)&&args.documents.some(d=>d.id==='b'&&d.units.every(u=>u.contextOnly)))sawCounterpart=true;return contextOnly(args);});
  const r=await coveredAnalysis(ctx,{kind:'compare',instruction:'比较两版',useCache:false});assert(sawCounterpart);assert.equal(r.coverage.sourceUnits,226);assert.equal(r.coverage.extractProcessed,226);assert.equal(r.coverage.auditProcessed,226);
});

test('短编号范围回执可展开到精确原文，未知范围不能冒充覆盖',async t=>{
  const ctx=fixture(t,[file('a','第一行\n第二行\n第三行')],args=>({items:[],dispositions:[{ranges:[[args.documents[0].focusIds[0],args.documents[0].focusIds.at(-1)]],status:'context',reason:'已知上下文'},{ranges:[['U999','U9999']],status:'context',reason:'无效范围'}]}));
  const r=await coveredAnalysis(ctx,{kind:'compare',instruction:'核对',useCache:false});assert.equal(r.coverage.extractProcessed,3);assert.equal(r.coverage.auditProcessed,3);assert.equal(r.coverage.unresolved,0);assert(r.ledger.dispositions.every(d=>r.ledger.inventory.units.some(u=>u.id===d.unitId)));
});
