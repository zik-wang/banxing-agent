// Same gate for host/API/CLI; document text is classification data, never authority.
export function assessScope(documents,context){
 const primary=documents.filter(d=>d.role==='contract');
 const result={state:'supported',contractType:context.contract_type,region:context.region,stance:context.stance,materialScope:'unknown',evidence:[],reason:''};
 if(context.contract_type!=='equipment_purchase_cn'||context.region!=='中国大陆'||!['buyer','seller','neutral'].includes(context.stance))return {...result,state:'unsupported',reason:'本专项仅支持中国大陆设备采购，立场由用户或宿主指定。'};
 if(primary.length!==1)return {...result,state:'needs_clarification',reason:'必须明确一份主合同，其余作为附件。'};
 const units=primary[0].units||[],head=units.slice(0,12),text=units.map(u=>u.raw_text).join('\n');
 if(/不是完整|公开节录|公开案例|合同.{0,3}节录|仅.{0,12}节录/.test(text))result.materialScope='excerpt';
 // Strong document titles only. Ancillary guarantee/license/service clauses do not reject a purchase.
 const equipment=head.some(u=>/^(?:\[.*?\]\s*)?.{0,12}(?:设备|仪器|仪表|机电).{0,10}(?:采购|购销|买卖).{0,8}(?:合同|协议)|^(?:采购|购销|买卖).{0,10}(?:设备|仪器).{0,8}合同/.test(u.raw_text.trim()));
 const other=head.find(u=>/^(?:\[.*?\]\s*)?(?:(?:三方|双方|项目|公司)\s*)?(?:债权转让|债务转移|股权收购|股权转让|股权投资|劳动|房屋租赁|借款)(?:合同|协议|意向书|公开节录)|^(?:股权收购|三方债权转让).{0,12}(?:节录|意向书|协议)/.test(u.raw_text.trim()));
 if(other&&!equipment)return {...result,state:'unsupported',evidence:[{unit_id:other.id,text:other.raw_text}],reason:'主合同标题与设备采购专项不匹配；未继续执行采购清单。'};
 if(!equipment)return {...result,state:'needs_clarification',reason:'尚不能从主合同正文确认设备采购类型，不能仅按文件名推断。'};
 result.evidence=head.filter(u=>/设备|仪器|采购|购销/.test(u.raw_text)).map(u=>({unit_id:u.id,text:u.raw_text}));return result;
}
export function scopeMismatchFromSubmission(raw){
 const entries=[...(Array.isArray(raw?.checks)?raw.checks:[]),...(Array.isArray(raw?.findings)?raw.findings:[])];
 return entries.find(x=>/(?:本合同|本材料|主合同|合同类型|当前材料).{0,45}(?:并非|不是|不属于|不适用).{0,20}(?:设备采购|采购合同)|(?:债权转让|股权收购).{0,30}(?:不应|不能).{0,15}(?:套用|适用).{0,10}采购/.test([x.title,x.explanation].filter(Boolean).join(' ')))||null;
}
