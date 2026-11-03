import {businessStatistics} from './statistics-report.mjs';
// Once a current typed table is selected, these requests need receipt calculation
// and a bounded rendering action, not a new semantic interpretation of its rows.
export async function statisticsPreflight({docs,books,harness,config}){
 const intent=docs.turnIntent;if(intent.requiresExternalAction||!intent.wantsStatistics||!books?.tables.size||config.assistantRouting?.phase==='verify'||intent.requiresReprocessing)return null;
 if(intent.formats.some(f=>f!=='docx'))return null;
 if(!docs.continuity?.currentTableId&&books.tables.size!==1)return null;
 const receipt=await docs.statistics.current();
 if(intent.formats.includes('docx')){
  const result=await harness.execute('export_document',{title:'业务数据统计报告',format:'docx',statistics_ids:[receipt.receiptId]});
  if(result.status==='error')return {failed:true,reason:'statistics_export_failed',message:'统计结果已保存，Word交付未完成：'+result.error.message};
 }
 return {completed:true,message:businessStatistics(receipt).body};
}
