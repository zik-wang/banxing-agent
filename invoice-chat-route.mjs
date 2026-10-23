// Only a direct user request can select this route; names/attachment text cannot.
export function wantsInvoiceExcel(request,files){
 if(typeof request!=='string'||!files?.length||files.some(f=>!['.pdf','.png','.jpg','.jpeg','.xlsx'].includes(f.extension)))return false;
 if(/不要|先别|先不|仅建议|只建议|只分析|只解释|如何|怎么做|能不能|能否|是否|别执行|不执行/.test(request))return false;
 return /发票|票据|报销|invoice/i.test(request)&&/excel|excal|xlsx|表格|明细|报销包/i.test(request)&&/处理|整理|生成|做成|做个|导出|提取|汇总|制作|生成|process|export/i.test(request);
}
export function queueInvoiceDirect(runtime,run,files){
 const workspace=runtime.chatActions?.workspace;if(!workspace?.invoiceRuntimeStatus()?.batchVersion)return false;
 run.kind='invoice-dispatch';run.modelLabel='发票整理';run.turns=0;
 const startedAt=new Date().toISOString();
 try{const template=files.filter(f=>f.extension==='.xlsx');if(template.length>1)throw Error('多份模板需要明确选择');const receipt=runtime.chatActions.queue(run,{scenario_id:'09',file_ids:files.map(f=>f.id),instruction:run.request,output_formats:['xlsx'],...(template.length?{template_file_id:template[0].id}:{})});
  run.answer='已开始逐份整理发票并生成 Excel。可直接读取的电子 PDF 先提取文字，扫描页交给内网 OCR；有冲突的字段会保留待核，部分材料失败也会交付已完成的明细。';run.status='done';run.finishedAt=new Date().toISOString();run.trace.push({type:'dispatch',label:'已交给发票后台流程',detail:'直接程序交办，未调用聊天模型；'+receipt.title,stage:'chat_dispatch',startedAt,finishedAt:run.finishedAt,durationMs:Date.parse(run.finishedAt)-Date.parse(startedAt),success:true});
 }catch(error){run.status='failed';run.error=String(error.message);run.finishedAt=new Date().toISOString();}
 runtime.active.delete(run.id);runtime.store.save();return true;
}
