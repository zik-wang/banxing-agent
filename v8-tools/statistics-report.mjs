import {statisticsText} from './table-statistics.mjs';
const identifier=/序号|编号|编码|标识|邮编|电话|(?:^|[\s_-])(?:id|index|code|serial|phone|zip)(?:$|[\s_-])/i;
const nonAdditive=/单价|均价|平均|比例|百分|利率|税率|折扣|unit.?price|average|percent|rate/i;
const additive=/金额|总价|费用|成本|收入|支出|余额|预算|工资|税额|价款|数量|件数|人数|次数|工时|amount|cost|revenue|balance|salary|quantity|count/i;
export const exactDisplay=value=>{const [whole,fraction]=String(value).split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);};
export function businessStatistics(receipt,{draft='',appendix=false}={}){
 const r=receipt,lines=[],corrections=[],summable=r.columns.filter(c=>!identifier.test(c.name)&&!nonAdditive.test(c.name)&&additive.test(c.name)&&c.sumExact!==null);
 const countText=(Array.isArray(r.inputTableRows)&&r.inputTableRows.length?'本次共处理'+r.inputTableRows.join(' + ')+' = '+r.inputTableRows.reduce((a,b)=>a+b,0)+'条输入记录，':'')+'整理后保留'+r.dataRows+'条数据、'+r.columnCount+'个字段。';
 const mixedCurrency=r.currencyGroups?.length>1;
 lines.push('## 结论',countText,...summable.map(c=>mixedCurrency?'“'+c.name+'”按原币种分别合计：'+r.currencyGroups.map(g=>{const v=g.columns.find(x=>x.name===c.name);return g.currency+' '+(v?.sumExact===null?'无可合计数值':exactDisplay(v.sumExact));}).join('；')+'。':'“'+c.name.replace(/[_（(]元[）)]?$/,'')+'”合计为'+exactDisplay(c.sumExact)+(/[_（(]元[）)]?$/.test(c.name)?'元':'（单位以原字段说明为准）')+'。'));
 lines.push('## 处理情况','本次去重'+r.removedRows+'条；按已使用的业务键检查，记录到'+r.conflicts+'处非空值冲突。原字段名称及数值类型按登记表保留。');
 const notes=r.columns.filter(c=>c.nonEmpty<r.dataRows).map(c=>'“'+c.name+'”有'+c.nonEmpty+'条非空记录、'+(r.dataRows-c.nonEmpty)+'条空记录，缺失项需按原材料补查。');
 notes.push(...summable.filter(c=>c.numericCount<c.nonEmpty).map(c=>'“'+c.name+'”仅合计'+c.numericCount+'项数值；其他非空内容未擅自转成金额。'));
 if(r.conflicts)notes.unshift('存在冲突记录，需要人工确认，不据此认定全部业务内容一致。');
 if(mixedCurrency)notes.push('原表含多种币种，未使用汇率折算或将不同币种金额合并为单一付款总额。');
 notes.push(summable.some(c=>/中标|成交/.test(c.name))?'这里的中标或成交金额是材料登记口径，不等于实际付款；本次未作审计确认。':'统计针对本次完整登记表格，不等于原始业务事实或实际付款已经审定。');
 lines.push('## 待核事项',...notes);
 // Preserve useful prose/organization, but numeric claims come from receipt-bound
 // slots. Invalid model text remains in the audit sidecar, never hidden as verified.
 const kept=[];for(const line of String(draft||'').split('\n')){const clean=line.trim();if(!clean||/^#{1,4}\s*(?:结论|处理情况|待核事项)$/.test(clean))continue;if(/^#{1,6}\s|^\||^[一二三四五六七八九十]+[、．.]|上表|下表|表格如下|明细如下|明细见|附表见/u.test(clean)||!/[。！？；.!?;]$/u.test(clean.replace(/\*+$/u,''))||/\d|STAT-|SHA|文件\s*ID|artifact|已(?:支付|付款|完成审计)|审计通过|审核通过|数据完全正确/iu.test(clean)){corrections.push({original:line,reason:'numeric_or_business_claim_requires_receipt_binding'});continue;}kept.push(clean);}
 if(kept.length)lines.push('## 补充说明（需业务复核）',...kept);
 const body=lines.join('\n\n'),audit=appendix?'\n\n## 附录：统计核对依据\n\n本附录用于核对来源版本；索引列合计不作为业务金额。\n\n'+statisticsText(r):'';
 return {text:body+audit,body,receiptId:r.receiptId,source:r.source,corrections,derivedFactsOnly:true};
}
