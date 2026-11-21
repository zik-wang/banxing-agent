import ExcelJS from 'exceljs';
import {localSampleFiles} from './local-samples.mjs';
import {workSampleFiles} from './work-scenario-samples.mjs';
export async function sampleFiles(scenarioId){
  if(Number(scenarioId)>=21&&Number(scenarioId)<=28)return workSampleFiles(scenarioId);
  const file=(name,content)=>({name,base64:Buffer.from(content).toString('base64')});
  if(scenarioId==='04')return [file('示例_会议文字稿.txt','[00:00] 主持人：今天讨论个人助手演示。\n[00:18] 陈晨：我负责在2026年10月20日18:00前提交演示稿。\n[00:42] 主持人：确认先完成本地版本，云端以后再讨论。\n[01:05] 李明：我负责核对资料，截止日期还没确定。\n[01:30] 主持人：下一次评审时间待确认。')];
  if(scenarioId==='07')return [file('星河项目_2026-10_会议.txt','项目：星河项目\n月份：2026-10\n内容：先完成演示。'),file('星河项目_2026-10_会议_副本.txt','项目：星河项目\n月份：2026-10\n内容：先完成演示。'),file('星河项目_2026-09_计划.md','项目：星河项目\n月份：2026-09\n内容：确认开发计划。'),file('暂未归属的笔记.txt','尚未确定项目，也没有日期。')];
  if(scenarioId==='08')return [file('方案_旧版.txt','第一条 项目金额为10000.00元。\n第二条 交付日期为2026年11月1日。\n第三条 甲方负责验收。\n第四条 提供培训服务。'),file('方案_新版.txt','第一条 项目金额为12000.00元。\n第二条 交付日期为2026年11月15日。\n第三条 乙方负责验收材料。\n第五条 新增交付操作手册。')];
  if(scenarioId==='09')return [file('票据A.txt','发票号码：100000000001\n开票日期：2026年10月10日\n销售方：星河文具有限公司\n商品名称：办公用品\n价税合计（小写）：￥128.50'),file('票据B.txt','发票号码：100000000002\n开票日期：2026年10月11日\n销售方：远行服务有限公司\n商品名称：交通费\n价税合计（小写）：￥71.25'),file('票据A_重复.txt','发票号码：100000000001\n开票日期：2026年10月10日\n销售方：星河文具有限公司\n商品名称：办公用品\n价税合计（小写）：￥128.50'),file('金额缺失的票据.txt','发票号码：100000000003\n开票日期：2026年10月12日\n销售方：示例供应商\n金额无法识别，待人工确认。')];
  if(scenarioId==='10'){
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('审查台账');sheet.addRow(['项目名称','审查阶段','审查意见','审查日期']);sheet.addRow(['历史项目','终审','历史记录保持不变','2026年9月30日']);sheet.getRow(1).font={bold:true};sheet.getCell('C2').font={color:{argb:'FF333333'}};
    return [{name:'示例_原始台账.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')},file('星河项目_审查意见.txt','项目名称：星河项目\n初审意见：请补充预算依据。\n终审意见\n项目名称：星河项目\n审查阶段：终审\n审查意见：资料齐全，同意按既定程序推进。\n审查日期：2026年10月15日')];
  }return localSampleFiles(scenarioId);
}
