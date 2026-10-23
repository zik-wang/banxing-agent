import {auditComparisonText} from './comparison-audit.mjs';
import {sourceInventory,explicitTransitions} from './source-coverage.mjs';
import {makeWorkbook,writeArtifact,resolveArtifact} from './artifacts.mjs';
import ExcelJS from 'exceljs';
export async function comparisonPreflight(ctx,rows){
 const groups=explicitTransitions(sourceInventory(ctx.files));
 const facts=groups.map(g=>({id:g.id,title:g.title,kind:g.kind,changed:g.hasChange,before:g.removed.map(u=>u.text),after:g.added.map(u=>u.text),sourceId:g.sourceId,unitIds:g.allIds,verification:'program_text_transition',limit:'仅确认明确前后原文；不确认业务影响。'}));
 const expected={edgeAudit:auditComparisonText(ctx.files[0].content,ctx.files[1].content),version:'v7-p2-diff-preflight-2',status:'text_diff_only',files:ctx.files.map(f=>({id:f.id,sha256:f.sha256})),diffCount:rows.length,rows,facts,limit:'模型语义分析尚未完成；更正公告未重复内容不构成业务删除证明。'};
 const json=writeArtifact(ctx.store,ctx.job,'程序文字差异-预检.json',Buffer.from(JSON.stringify(expected,null,2)),'evidence');
 const columns=['类型','旧版行号','新版行号','原文','修改后','关注字段'],values=rows.map(r=>[r.type,r.oldLine??'',r.newLine??'',r.before,r.after,r.focus]);
 const bytes=await makeWorkbook([{name:'完整差异',headers:columns,rows:values},{name:'明确前后文字事实',headers:['ID','条款','旧文字','新文字','边界'],rows:facts.map(f=>[f.id,f.title,f.before.join('\n'),f.after.join('\n'),f.limit])}]);
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.getWorksheet('完整差异');
 if(sheet.rowCount!==values.length+1)throw Error('预检完整差异行数回读失败');
 for(let r=0;r<values.length;r++)for(let c=0;c<values[r].length;c++)if(String(sheet.getCell(r+2,c+1).value??'')!==String(values[r][c]??''))throw Error('预检完整差异字段回读失败');
 if(JSON.stringify(JSON.parse(resolveArtifact(ctx.store,ctx.job.id,json.id).bytes))!==JSON.stringify(expected))throw Error('预检JSON回读失败');
 const excel=writeArtifact(ctx.store,ctx.job,'程序文字差异-预检.xlsx',bytes,'spreadsheet');
 ctx.job.comparisonPreflight={version:expected.version,diffCount:rows.length,explicitFactCount:facts.length,readbackVerified:true,artifactIds:[json.id,excel.id],status:'text_diff_only'};
 ctx.job.checks.push({label:'语义分析前已保存完整文字差异和明确前后事实并回读；业务解释未确认',passed:true});ctx.store.save();
}
