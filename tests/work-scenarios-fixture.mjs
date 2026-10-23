import {withCoverageFixture} from './source-coverage-fixture.mjs';
export function fixtureWorkAnalysis(args){
  if(args.coverage){const raw=legacyWorkAnalysis({...args,kind:'work-24'});return withCoverageFixture(args,raw);}
  return legacyWorkAnalysis(args);
}
function legacyWorkAnalysis({kind,documents}){
 const ref=(needle)=>{const d=documents.find(d=>d.text.includes(needle));if(!d)throw Error('fixture needle missing: '+needle);return {sourceId:d.id,quote:d.text.split('\n').find(s=>s.includes(needle))};};
 const item=(key,title,status,basis,evidence=[],extra={})=>({key,title,status,basis:basis.map(ref),evidence:evidence.map(ref),summary:title,nextAction:'按明确缺口继续处理',...extra});
 if(kind==='work-21')return {items:[item('REQ1','按订单编号查询','confirmed',['REQ1 已确认'],['REQ1 李明确认']),item('REQ2','布局与响应时间','needs_clarification',['REQ2 客户原话'],['REQ2 布局'])],suggestions:['建议向客户确认具体响应时间；尚未确认。']};
 if(kind==='work-22')return {items:[item('DEL1','操作手册','verified',['DEL1 要求'],['DEL1 操作手册正文']),item('DEL2','接口文档','missing',['DEL2 要求'])],suggestions:[]};
 if(kind==='work-23')return {left:{sourceId:documents.find(d=>d.name==='销售明细.csv').id,keyColumns:['订单编号'],amountColumn:'金额'},right:{sourceId:documents.find(d=>d.name==='周报明细.csv').id,keyColumns:['订单编号'],amountColumn:'金额'}};
 if(kind==='work-24')return {items:[item('TASK1','接口交付变更','changed',['TASK1 客户确认'],['TASK1 接口交付']),item('TASK2','联调受上游影响','affected',['TASK2 联调依赖'],[],{dependsOn:['TASK1'],owner:'李明'}),item('TASK3','独立培训','unaffected',['TASK3 培训材料'],[],{owner:'陈晨'})],suggestions:['建议确认联调新日期，不自行修改原计划。']};
 if(kind==='work-25')return {items:[item('TASK1','等待客户原始明细','blocked',['TASK1 张敏'],[],{owner:'张敏'}),item('TASK2','接口联调','in_progress',['TASK2 李明'],[],{owner:'李明',dependsOn:['TASK1']}),item('TASK3','演示','in_progress',['TASK3 陈晨'],[],{owner:'陈晨',dependsOn:['TASK2']})],suggestions:[]};
 if(kind==='work-26')return {items:[item('TASK1','报价交接','pending',['TASK1 陈晨'],['李明收到交接邀请'],{owner:'陈晨'}),item('TASK2','验收资料交接','pending',['TASK2 陈晨'],[],{owner:'陈晨'})],suggestions:['待李明确认接手后记录接手状态。']};
 if(kind==='work-27')return {items:[item('FB1','导出乱码','resolved',['FB1 客户甲'],['FB1 已回复'],{covers:['FB1']}),item('FB2','缺少状态列','resolved',['FB2 客户乙'],['FB2 状态列补充'],{covers:['FB2']})],suggestions:[]};
 if(kind==='work-28')return {items:[item('COND1','业务账号','available',['COND1 要求'],['COND1 工单已受理']),item('COND2','工作电脑','available',['COND2 要求'],['COND2 工作电脑已领取']),item('COND3','岗前培训','missing',['COND3 要求'],['COND3 培训尚未完成'])],suggestions:[]};
 throw Error('unexpected fixture kind: '+kind);
}
