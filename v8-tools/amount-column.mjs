// Business basis is selected before arithmetic, never by the physical order of columns.
export function selectAmountColumn(headers,request=''){
 const clean=s=>String(s).replace(/[\s_（）()]/g,'');
 const positive=String(request).replace(/(?:而非|而不是|不要|不含(?!税)|不计|排除|不汇总|不用|别用|不是)[^，,。；;\n]*/g,''),net=/税前|不含税|未税/.test(positive),paid=/实付/.test(positive),payable=/应付/.test(positive),explicitGross=!net&&/含税|价税|报销|总金额|总额/.test(positive);
 const pick=re=>headers.map((h,i)=>({h:clean(h),i})).filter(x=>re.test(x.h)).map(x=>x.i);
 let found=paid?pick(/^实付金额$/):payable?pick(/^应付金额$/):net?pick(/^(?:金额不含税|不含税金额|税前金额|未税金额)$/):pick(/^(?:价税合计|含税金额|金额含税|含税总额|含税总价|报销金额)$/);
 if((paid||payable)&&found.length!==1)throw Error('用户指定的实付/应付金额列不能唯一确认；没有改用含税总额');
 if(!found.length&&!net)found=pick(/^(?:应付金额|实付金额)$/);
 if(!found.length&&!net&&!explicitGross)found=pick(/^金额(?:USD|CNY|EUR|元|万元|亿元)?$/i);
 if(!found.length&&!net&&explicitGross)found=pick(/^金额(?:USD|CNY|EUR|元|万元|亿元)?$/i);
 if(found.length!==1)throw Error(found.length?'存在多个适用金额列，请明确汇总口径；原表保留':'缺少可唯一确认的金额列，请指定含税、税前或实付口径；原表保留');
 return {index:found[0],header:headers[found[0]],basis:net?'tax_exclusive':/价税|含税|报销/.test(headers[found[0]])?'gross_or_reimbursement':'explicit_amount',reason:'以用户口径及列名选择，未按列顺序选第一个金额字段'};
}
