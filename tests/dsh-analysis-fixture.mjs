// Synthetic, source-derived outputs for transport/integration tests, not a model
// quality score. The DSH loop and all downstream processing still execute.
export function fixtureAnalysis(prompt,documents){
  const kind=prompt.match(/任务类型：([^。]+)。/)?.[1];
  if(kind==='compare')return {summary:'按程序差异表核对金额、交付日期与职责变化。'};
  if(kind==='organize')return {files:documents.map(d=>({sourceId:d.id,project:d.text.includes('星河项目')?'星河项目':'',month:d.text.match(/2026-\d{2}/)?.[0]||'',quote:d.text.split('\n').slice(0,2).join('\n')}))};
  if(kind==='meeting'){const d=documents[0];return {title:'演示准备会',decisions:[{text:'先完成本地版本',sourceId:d.id,quote:'确认先完成本地版本，云端以后再讨论。'}],actions:[{title:'提交演示稿',owner:'陈晨',dueText:'2026年10月20日18:00',sourceId:d.id,quote:'陈晨：我负责在2026年10月20日18:00前提交演示稿。'}],unresolved:['下一次评审时间待确认']};}
  if(kind==='invoice')return {invoices:documents.map(d=>{const lines=d.text.split('\n'),line=prefix=>lines.find(l=>l.startsWith(prefix))||'';return {sourceId:d.id,invoiceNumber:line('发票号码：').split('：')[1]||'',numberQuote:line('发票号码：'),dateText:line('开票日期：').split('：')[1]||'',dateQuote:line('开票日期：'),vendor:line('销售方：').split('：')[1]||'',vendorQuote:line('销售方：'),amountText:line('价税合计').split('￥')[1]||'',amountQuote:line('价税合计')};})};
  if(kind==='ledger')return {records:documents.map(d=>({sourceId:d.id,values:{'项目名称':'星河项目','审查阶段':'终审','审查意见':'资料齐全，同意按既定程序推进。','审查日期':'2026年10月15日'},citations:{'项目名称':'项目名称：星河项目','审查阶段':'审查阶段：终审','审查意见':'审查意见：资料齐全，同意按既定程序推进。','审查日期':'审查日期：2026年10月15日'}}))};
  if(kind==='限定上传代码修复副本')return {changes:documents.map(d=>({sourceId:d.id,before:'return values.reduce((a, b) => a + b, 0) / values.length;',after:'return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;',reason:'空数组返回0'})),tests:['人工检查空数组返回0']};
  if(kind?.startsWith('scenario-'))return {facts:documents.filter(d=>d.text.trim()!=='[]').map(d=>{const times=d.text.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+08:00/g)||[];return {sourceId:d.id,quote:d.text,text:d.text.split('\n')[0],category:'记录',value:'',startAt:['scenario-02','scenario-16'].includes(kind)?times[0]||'':'',endAt:['scenario-02','scenario-16'].includes(kind)?times[1]||'':'',dueAt:kind==='scenario-15'?times[0]||'':'',recipient:kind==='scenario-05'?'client@example.invalid':'',project:kind==='scenario-12'?'ExampleEngine':'',version:kind==='scenario-12'?'v1.1.0':'',trackingId:kind==='scenario-17'?'DEMO0001':''};}),suggestions:['仅基于已授权材料'],questions:[]};
  throw Error('没有该类型模拟输出：'+kind);
}
export function extractionReply(body){
  const results=body.messages.filter(m=>m.role==='tool');
  if(!results.length)return {calls:[{name:'read_task_inputs',arguments:{}}]};
  if(results.length===1)return {calls:[{name:'submit_result',arguments:{json:JSON.stringify(fixtureAnalysis(body.messages.find(m=>m.role==='system').content,JSON.parse(results[0].content)))}}]};
  return {text:'结构化结果已提交，等待程序核验。'};
}
