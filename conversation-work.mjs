import {selectAmountColumn} from './v8-tools/amount-column.mjs';
import {attachmentExclusionRequest} from './attachment-selection.mjs';
import {recipientEvidence} from './office-source-evidence.mjs';
import {applyOfficeEdits,parseOfficeRequest,describeWorkbook,AGGREGATE_METRICS} from './office-edits.mjs';
import {advanceRevision,selectRevision,eligibleRevision} from './work-revisions.mjs';
import ExcelJS from 'exceljs';
import {id,now} from './core.mjs';
import {assertConversationAttachment} from './attachment-context.mjs';
import {readOriginal} from './workspace-files.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {sourceJobContent,requestedFormats,DELIVERY_TABLE_LIMITS} from './file-delivery.mjs';
import {settleDelivery,deliveryArtifacts} from './delivery-settlement.mjs';

const time=x=>Date.parse(x?.finishedAt||x?.createdAt||x?.startedAt||'')||0;
const retrieval=s=>/文件呢|文件在哪|下载在哪|下载链接|下载.*哪里|刚才生成的.*呢|(?:之前|刚才|已有|原来)的?\s*(?:Excel|xlsx|Word|docx|PDF|文件).*(?:给我|下载|发我)/i.test(s);
const retry=s=>/^\s*(?:请)?(?:再试一次|重试|重新试|再试试)[。！!？?\s]*$/.test(s);
const formats=s=>requestedFormats(s).length?requestedFormats(s):/转\s*(?:word|docx)/i.test(s)?['docx']:/转\s*pdf/i.test(s)?['pdf']:[];
const jobs=(store,cid)=>store.state.jobs.filter(j=>j.conversationId===cid).sort((a,b)=>time(b)-time(a));
const outputIds=j=>(j?.artifacts||[]).filter(a=>a.kind!=='presentation'&&a.kind!=='audit').map(a=>a.id);
export function workContext(store,cid){
 const c=store.state.conversations.find(c=>c.id===cid);if(!c)throw Error('对话不存在');
 const refs=store.state.conversationAttachments?.filter(f=>f.conversationId===cid)||[],active=refs.filter(f=>f.status==='active').map(f=>f.fileId),all=jobs(store,cid),selected=(c.attachmentContext?.activeFileIds?.length?c.attachmentContext.activeFileIds:active).filter(id=>active.includes(id)),valid=all.find(j=>j.id===c.workContext?.selectedJobId&&eligibleRevision(store,cid,j)&&j.dataScope?.every(f=>selected.includes(f.id)))||all.find(j=>!['failed','cancelled','queued','running','interrupted'].includes(j.status)&&outputIds(j).length&&j.dataScope?.every(f=>selected.includes(f.id))),failed=all.find(j=>['failed','interrupted'].includes(j.status)&&!all.some(n=>n.retryOfJobId===j.id&&!['failed','queued','running','cancelled'].includes(n.status)));
 c.workContext={...(c.workContext||{}),conversationId:cid,availableSourceFileIds:active,activeSourceFileIds:(c.attachmentContext?.activeFileIds||active).filter(f=>active.includes(f)),currentWorkItemId:valid?.workItemId||valid?.chatRunId,latestTaskId:valid?.id,latestFailedTaskId:failed?.id,latestVerifiedArtifactId:outputIds(valid)[0],activeArtifactIds:outputIds(valid),updatedAt:now()};return c.workContext;
}
export function planOffice(store,cid,request,options={}){
 if(!store.productExperience)return null;
 const positional=/第[一二12](?:个|份)|最新(?:的)?文件/.test(request);
 const ctx=workContext(store,cid),namedSources=(store.state.conversationAttachments||[]).filter(f=>f.conversationId===cid&&f.name&&request.includes(f.name));
 let latest=positional||options.fileIds?.length||namedSources.length?undefined:jobs(store,cid).find(j=>j.id===ctx.latestTaskId);
 const namedOutputs=jobs(store,cid).filter(j=>j.artifacts?.some(a=>request.includes(a.name)));
 if(!options.fileIds?.length&&!namedSources.length&&namedOutputs.length===1)latest=namedOutputs[0];
 if(namedOutputs.length>1)return {operation:'blocked_retry',message:'多个版本使用相同文件名，请在当前成果中选择要修改的版本。'};
 if(latest&&/^(?:撤销上一步|恢复上一版|回到上一版)[。\s]*$/.test(request)){const parent=jobs(store,cid).find(j=>j.id===latest.parentJobId);return parent?{operation:'restore',sourceJob:parent}:{operation:'blocked_retry',message:'当前成果没有可恢复的上一版。'};}
 const conversation=store.state.conversations.find(c=>c.id===cid);if(/下周.*下午.*会/.test(request)||conversation.calendarDraft&&/午休|一小时|半小时|就这个|安排吧/.test(request))return {operation:'schedule'};
 if(retrieval(request)){const wanted=formats(request);const source=wanted.length?jobs(store,cid).find(j=>eligibleRevision(store,cid,j)&&j.dataScope?.every(f=>ctx.activeSourceFileIds.includes(f.id))&&wanted.every(ext=>deliveryArtifacts(store,j).artifacts.some(a=>a.name.toLowerCase().endsWith('.'+ext)))):latest;return {operation:'delivery',sourceJob:source};}
 const lastOperation=store.state.runs.filter(r=>r.conversationId===cid).at(-1);if(/^继续[。\s]*$/.test(request)&&lastOperation?.operation==='selection'&&latest)return {operation:'convert',sourceJob:latest,formats:latest.options?.outputFormats?.length?latest.options.outputFormats:['docx']};
 if(retry(request)||options.retryOperationRunId){
  // Choose the latest eligible failure across operation types before dispatching.
  // Reverse insertion order breaks equal timestamp ties in favour of the newer run.
  const runs=store.state.runs.filter(r=>r.conversationId===cid),failedRun=[...runs].reverse().filter(r=>r.status==='failed'&&(r.officeOperation||!jobs(store,cid).some(j=>j.chatRunId===r.id))&&(!options.retryOperationRunId||r.id===options.retryOperationRunId)&&!runs.some(n=>n.retryOfRunId===r.id&&n.status==='done')).sort((a,b)=>time(b)-time(a))[0];
  const failedJob=jobs(store,cid).find(j=>options.retryOperationRunId?j.chatRunId===options.retryOperationRunId&&['failed','interrupted'].includes(j.status)&&!runs.some(n=>n.retryOfRunId===j.chatRunId&&n.status==='done')&&!jobs(store,cid).some(n=>n.retryOfJobId===j.id&&!['failed','queued','running','cancelled'].includes(n.status)):j.id===ctx.latestFailedTaskId);
  if(failedRun?.officeOperation&&(!options.retryOperationRunId||options.retryOperationRunId===failedRun.id)&&(!failedJob||time(failedRun)>=time(failedJob))){const source=jobs(store,cid).find(j=>j.id===failedRun.officeOperation.sourceJobId);if(source)return {...failedRun.officeOperation,sourceJob:source,retryOfRunId:failedRun.id,requirement:failedRun.officeOperation.requirement};if(!failedRun.officeOperation.sourceJobId)return {operation:'retry_analysis',retryOfRunId:failedRun.id,request:failedRun.officeOperation.requirement||failedRun.request,fileIds:failedRun.resolvedFileIds||[]};}

  const failedAnalysis=failedRun&&!failedRun.officeOperation?failedRun:null;
  if(failedAnalysis&&(!failedJob||time(failedAnalysis)>time(failedJob)))return {operation:'retry_analysis',retryOfRunId:failedAnalysis.id,request:failedAnalysis.request,fileIds:failedAnalysis.resolvedFileIds||failedAnalysis.sourceFiles?.map(f=>f.id)||[]};
  const failed=failedJob;
  if(!failed)return {operation:'no_retry',message:'当前没有尚未解决且可恢复的失败操作。已有文件保留在下方；没有重新处理最初附件。',sourceJob:latest};
  if(failed.scenarioId==='export'&&failed.exportSource)return {operation:'retry',sourceJob:failed,retryOfJobId:failed.id,formats:failed.options.outputFormats,requirement:failed.goal};
  return {operation:'blocked_retry',sourceJob:failed,message:'最近失败的是“'+failed.title+'”。它需要原业务恢复入口，请在该任务卡重试；没有改为重新分析最初附件。'};
 }
 if(attachmentExclusionRequest(request))return {operation:'selection'};
 const parsed=parseOfficeRequest(request);
 if(parsed.complete&&(latest||options.fileIds?.length||namedSources.length)){
  const first=parsed.steps[0]?.type,operation=parsed.steps.length===0?'convert':parsed.steps.length===1?({recipient:'modify',legacy_sum:'modify',legacy_group:'group',legacy_dedupe:'dedupe',report:'report'}[first]||'edit'):'edit';
  return {operation,sourceJob:latest,steps:parsed.steps,formats:parsed.formats.length?parsed.formats:undefined,requestPlan:parsed};
 }
 if(latest&&parsed.unknown.length&&(parsed.steps.length||parsed.conversion))return {operation:'semantic_edit',sourceJob:latest,requestPlan:parsed};
 if(formats(request).length&&(/转|弄成|做成|再给我|再来|横着|横向/.test(request)))return {operation:'convert',sourceJob:latest,formats:formats(request)};
 if(/横着排|横向排/.test(request)&&latest)return {operation:'convert',sourceJob:latest,formats:latest.options?.outputFormats||['docx']};
 if(!latest&&!options.fileIds?.length&&/收件人|收票人|金额.*汇总|合计一下|汇总一下/.test(request))return {operation:'blocked_retry',message:'尚无可继续修改的有效表格。请先恢复上一项失败的导出；原件仍在本对话中，没有根据聊天回复编造表格。'};
 if(latest&&/收件人|收票人|金额.*汇总|合计一下|汇总一下|重复的不要|去重|部门.*统计|领导.*版本|领导.*报告/.test(request))return {operation:/重复的不要|去重/.test(request)?'dedupe':/部门.*统计/.test(request)?'group':/领导/.test(request)?'report':'modify',sourceJob:latest};
 if(/合一下|合并.*表|表.*合并/.test(request))return {operation:'merge'};
 if(latest&&/修改|补|加.*列|改.*[为成]|按.*[排汇统]|筛选|只保留|平均|删.*列/.test(request))return {operation:'semantic_edit',sourceJob:latest,requestPlan:parsed};
 return null;
}
export function recordWork(store,run,plan=null){
 const outputs=jobs(store,run.conversationId).filter(j=>j.chatRunId===run.id);run.workItemId=run.id;run.parentWorkItemId=plan?.sourceJob?.workItemId||plan?.sourceJob?.chatRunId||null;run.operation=plan?.operation||run.operation||'analyze';run.inputArtifactIds=plan?.sourceJob?outputIds(plan.sourceJob):run.inputArtifactIds||[];run.outputArtifactIds=outputs.flatMap(outputIds);run.taskIds=outputs.map(j=>j.id);run.userRequirement=run.request;
 for(const j of outputs){j.workItemId=run.id;j.parentWorkItemId=run.parentWorkItemId;j.inputArtifactIds=run.inputArtifactIds;j.outputArtifactIds=outputIds(j);}
 const c=store.state.conversations.find(c=>c.id===run.conversationId);if(c){const ctx=workContext(store,run.conversationId);ctx.pendingUserRequirement=run.status==='failed'?run.request:undefined;ctx.latestOperationRunId=run.id;if(run.operation==='analyze'&&!/^继续[。\s]*$/.test(run.request))ctx.currentGoal=run.request;}store.save();
}
export function officeRequest(store,run){
 const context=store.state.conversations.find(c=>c.id===run.conversationId)?.workContext;
 const continuation=/^继续[。\s]*$/.test(run.request),ordinal=run.attachmentResolution?.reason==='ordinal_reference';
 let request=continuation?(context?.currentGoal||'继续分析当前保留的材料'):run.request;
 if((ordinal||continuation)&&run.sourceFiles?.length===1)request=request.replace(/第[一二三四五六七八九十\d]+(?:个|份)?文件/g,'当前选定的文件《'+run.sourceFiles[0].name+'》');
 run.resolvedRequest=request;
 return (continuation?'只使用本轮保留的文件，排除的来源及旧结果不可重用。\n':'')+request;
}

async function workbook(bytes){
 const b=new ExcelJS.Workbook();await b.xlsx.load(bytes);let cells=0;
 return b.worksheets.map(s=>{
  if(s.columnCount>DELIVERY_TABLE_LIMITS.columns||s.rowCount>DELIVERY_TABLE_LIMITS.rows+1)throw Error('表格超过'+DELIVERY_TABLE_LIMITS.columns+'列或'+DELIVERY_TABLE_LIMITS.rows+'行，已保留原件；需明确拆分范围');
  cells+=s.columnCount*s.rowCount;if(cells>DELIVERY_TABLE_LIMITS.cells)throw Error('表格超过'+DELIVERY_TABLE_LIMITS.cells+'格，已保留原件；需明确拆分范围');
  const rows=[];for(let r=1;r<=s.rowCount;r++){const row=[];for(let c=1;c<=s.columnCount;c++){const cell=s.getCell(r,c);if(cell.formula&&cell.result===undefined)throw Error('原表公式没有缓存结果，不能宣称计算或数据无损');const v=cell.result??cell.value;row.push(v===undefined?null:v instanceof Date?v.toISOString():v!==null&&typeof v==='object'?cell.text:v);}rows.push(row);}
  return {name:s.name,headers:(rows.shift()||[]).map((v,i)=>String(v??'列'+(i+1))),rows};
 });
}
async function inputFor(h,run,plan,files){
 const input=await rawInputFor(h,run,plan,files);
 const records=recipientEvidence(h.store,run.conversationId,plan.sourceJob?.dataScope||files);
 input.recipientRecords=[...(input.recipientRecords||[]).filter(r=>!records.some(n=>n.fileName===r.fileName)),...records];return input;
}
async function rawInputFor(h,run,plan,files){
 if(plan.sourceJob?.officeSnapshot){const j=plan.sourceJob;for(const f of j.dataScope||[])assertConversationAttachment(h.store,run.conversationId,f.id);if(j.conversationId!==run.conversationId||deliveryArtifacts(h.store,j).issues.length)throw Error('当前成果不可访问或已变化');return structuredClone(j.officeSnapshot);}
 if(plan.sourceJob){const j=plan.sourceJob;if(j.conversationId!==run.conversationId)throw Error('禁止跨对话使用成果');for(const f of j.dataScope||[])assertConversationAttachment(h.store,run.conversationId,f.id);const verified=deliveryArtifacts(h.store,j);if(plan.operation!=='retry'&&verified.issues.length)throw Error('上一成果文件已缺失或变化，请明确恢复；未擅自替换输入');if(!j.exportSource&&plan.operation!=='retry'){
 const excel=j.artifacts.filter(a=>a.name.endsWith('.xlsx'));if(excel.length){const sheets=[];for(const a of excel)sheets.push(...await workbook(resolveArtifact(h.store,j.id,a.id).bytes));let recipientRecords=[];const ledgerArtifact=j.artifacts.find(a=>a.name==='票据证据与字段账本.json');if(ledgerArtifact){const ledger=JSON.parse(resolveArtifact(h.store,j.id,ledgerArtifact.id).bytes.toString('utf8'));recipientRecords=(ledger.documents||[]).filter(d=>d.fields?.buyer?.businessRoles?.includes('invoice_recipient')&&d.fields.buyer.value&&d.fields.buyer.choices?.length===1).map(d=>({fileName:d.fileName,value:d.fields.buyer.value,sourceId:d.fields.buyer.relationIds?.join(',')||'',status:d.fields.buyer.status}));}return {recipientRecords,title:j.title,content:'依据已交付表格继续处理。原表的全部工作表、待核状态和证据列保留。\n'+(j.summary||''),sheets};}
 }return structuredClone(await sourceJobContent(h.store,{...j,status:plan.operation==='retry'?'partial':j.status}));}
 const sheets=[];for(const f of files){if(f.extension!=='.xlsx')throw Error('此操作需要已选 Excel 文件；没有重新解析其他材料');sheets.push(...(await workbook(readOriginal(h.store,f))).map(s=>({...s,sourceFileName:f.name})));}if(!sheets.length)throw Error('没有可转换的当前表格，请明确选择已有成果或文件');return {title:files.map(f=>f.name.replace(/\.xlsx$/i,'')).join('与').slice(0,80),content:'',sheets};
}
function merge(input,files){
 const detail=[],supplemental=[];
 for(const [index,s]of input.sheets.entries()){
  const report=/^报告正文(?:附)*$/.test(s.name)&&s.headers.length===1&&s.headers[0]==='内容';
  const keyValueSummary=/汇总|小计|summary|total/i.test(s.name)&&s.headers.length===2&&/^(项目|指标|item|metric)$/i.test(s.headers[0])&&/^(数值|值|value)$/i.test(s.headers[1]);
  const hasDetail=s.sourceFileName&&input.sheets.some(other=>other!==s&&other.sourceFileName===s.sourceFileName&&other.headers.length>s.headers.length);
  (report||keyValueSummary&&hasDetail?supplemental:detail).push({sheet:s,index});
 }
 const headers=[...new Set(detail.flatMap(({sheet:s})=>s.headers))],sourceHeaders=['来源文件','来源工作表','来源行号'];
 if(headers.length+sourceHeaders.length>DELIVERY_TABLE_LIMITS.columns)throw Error('合并后含来源字段共'+(headers.length+sourceHeaders.length)+'列，超过当前'+DELIVERY_TABLE_LIMITS.columns+'列上限，请明确拆分范围');
 const withSource=(s,index,r,n)=>[s.sourceFileName||files[index]?.name||s.name,s.name,n+2];
 const rows=detail.flatMap(({sheet:s,index})=>s.rows.map((r,n)=>[...headers.map(h=>s.headers.includes(h)?r[s.headers.indexOf(h)]??null:null),...withSource(s,index,r,n)]));
 const supplements=supplemental.map(({sheet:s,index},i)=>({name:'原表'+(i+1)+'_'+s.name,headers:[...s.headers,...sourceHeaders],rows:s.rows.map((r,n)=>[...r,...withSource(s,index,r,n)])}));
 return {...input,title:'合并报表',content:'原始明细按同名字段合并；不同字段保留空位，没有猜测业务等价字段。来源文件、工作表与原始行号保留。'+(supplements.length?'原表的键值汇总和报告正文单独保留，未当作明细记录合并。':''),sheets:[...(detail.length?[{name:'合并明细',headers:[...headers,...sourceHeaders],rows}]:[]),...supplements]};
}
function dedupe(input){let removed=0;return {...input,content:input.content+'\n仅移除所有业务列完全相同的记录；语义相似但不同的记录保留；重复来源另表保留。',sheets:input.sheets.flatMap(s=>{const indices=s.headers.map((h,i)=>/^来源/.test(h)?-1:i).filter(i=>i>=0),seen=new Set(),duplicates=[],rows=s.rows.filter(r=>{const key=JSON.stringify(indices.map(i=>r[i]));if(seen.has(key)){duplicates.push(r);removed++;return false;}seen.add(key);return true;});return [{...s,rows},...(duplicates.length?[{name:s.name+'重复来源',headers:s.headers,rows:duplicates}]:[])];}),dedupeRemoved:removed};}
function group(input){const s=input.sheets.find(s=>s.headers.some(h=>/^部门(?:名称)?$/.test(h)));if(!s)throw Error('当前报表没有明确的部门列，请指定分组字段；原报表保留，没有猜测部门');const groupCol=s.headers.findIndex(h=>/^部门(?:名称)?$/.test(h)),numeric=s.headers.map((h,i)=>({h,i})).filter(x=>/金额|费用|成本|数量|支出|收入|价税合计/.test(x.h)&&!/来源|序号|编号|代码|比例|百分|单价|率$|%/.test(x.h)&&s.rows.some(r=>typeof r[x.i]==='number')&&s.rows.every(r=>r[x.i]===null||r[x.i]===''||typeof r[x.i]==='number')),groups=new Map();for(const r of s.rows){const key=String(r[groupCol]??'未填写'),values=groups.get(key)||[0,...numeric.map(()=>0)];values[0]++;numeric.forEach((x,i)=>{const n=r[x.i]||0;if(!Number.isSafeInteger(Math.round(n*100)))throw Error('数值超过可精确汇总范围');values[i+1]+=Math.round(n*100);});groups.set(key,values);}return {...input,sheets:[...input.sheets,{name:'部门统计',headers:['部门','记录数',...numeric.map(x=>x.h+'合计')],rows:[...groups].map(([k,v])=>[k,v[0],...v.slice(1).map(n=>n/100)])}],content:input.content+'\n部门统计只汇总有明确数值的列，保留全部明细。'};}
function modify(input,request){
 if(/收件人|收票人/.test(request)){const s=input.sheets.find(s=>s.headers.some(h=>/账单编号|票据号码|发票号码|收票人|金额|价税合计/.test(h)));if(!s)throw Error('当前成果没有可对应的发票明细，请明确表格');if(!s.headers.some(h=>/收票人|收件人/.test(h))){const fileCol=s.headers.findIndex(h=>h==='原始文件'||h==='来源文件');s.headers.push('收票人（原标签）','收票人依据');s.rows.forEach(r=>{const records=(input.recipientRecords||[]).filter(x=>fileCol>=0&&x.fileName===r[fileCol]);r.push(records.length===1?records[0].value:null,records.length===1?'已有原文角色关联：'+records[0].sourceId+'；'+records[0].status:'待补：没有可核实收票人依据');});input.content+='\n收票人只复用已有原文标签及角色关联，不将购买方或物流收件人混同；缺失留空，未重复OCR。';}else input.content+='\n保留现有收票人或购买方及地址、邮箱；这些角色不能擅自等同物流收件人，新增要求仍待核对。';}
 if(/金额.*汇总|合计一下|汇总一下/.test(request)){const s=input.sheets.find(s=>s.rows.length&&s.headers.some(h=>/^(?:金额(?:\(|（|$)|价税合计$|应付金额$)/.test(h)));if(!s)throw Error('当前成果没有明确金额列，请指定汇总列');const selection=selectAmountColumn(s.headers,request),i=selection.index,currency=s.headers.findIndex(h=>h==='币种'),groups=new Map();for(const r of s.rows){if(/合计|汇总|total/i.test(String(r[0]??'')))continue;if(typeof r[i]!=='number')throw Error('金额列包含非数值，未给出不完整合计');const k=currency>=0?String(r[currency]||'未注明币种'):s.headers[i],cents=Math.round(r[i]*100);if(!Number.isSafeInteger(cents))throw Error('金额超出精度范围');groups.set(k,(groups.get(k)||0)+cents);}input.sheets=input.sheets.filter(s=>s.name!=='金额汇总');input.sheets.push({name:'金额汇总',headers:['币种或金额列','合计'],rows:[...groups].map(([k,v])=>[k,v/100])});}
 return input;
}
async function schedule(h,run){
 const service=h.chatActions.calendarService;if(!service)throw Error('尚未连接日历，未创建事件');const c=h.store.state.conversations.find(c=>c.id===run.conversationId),draft=c.calendarDraft||{durationMinutes:30,timezone:'Asia/Shanghai',title:'会议'};if(/一小时/.test(run.request))draft.durationMinutes=60;if(/半小时/.test(run.request))draft.durationMinutes=30;
 const prior=service.operations(run.conversationId).at(-1);if(/就这个|安排吧/.test(run.request)&&prior){run.calendarOperationIds=[prior.id];run.answer=prior.status==='verified'?'日程已创建并回读，事件ID：'+prior.providerEventId:'提议保持不变，请在下方核对时间并点击“确认创建”。当前尚未写入事件。';return;}
 const calendars=await service.client.call('calendar_list_calendars');if(calendars.calendars.length!==1)throw Error('请明确选择一个有权限的日历');const calendarId=calendars.calendars[0].id;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const date=new Date(today+'T00:00:00+08:00'),day=new Date(date.getTime()+8*3600000).getUTCDay(),days=(8-day)%7||7;const monday=new Date(date.getTime()+days*86400000);let slot;
 for(let i=0;i<5&&!slot;i++){const d=new Date(monday.getTime()+i*86400000+8*3600000).toISOString().slice(0,10),r=await service.client.call('calendar_find_free_slots',{calendarId,start:d+'T14:00:00+08:00',end:d+'T18:00:00+08:00',durationMinutes:draft.durationMinutes});if(!r.complete)throw Error('日历查询不完整，不能假设空闲');slot=r.slots[0];}
 if(!slot)throw Error('下周工作日下午没有符合条件的空档，尚未安排');if(prior?.status==='pending')await service.decide(run.conversationId,prior.id,false);const op=await service.prepare(run.conversationId,{calendarId,title:draft.title,start:slot.start,end:slot.end,timezone:draft.timezone},run.id);c.calendarDraft=draft;run.calendarOperationIds=[op.id];run.answer='已查询当前授权日历，建议 '+new Date(slot.start).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'，时长'+draft.durationMinutes+'分钟；避开午休和已有冲突。主题暂为“会议”，参会人未填写。请在下方确认后创建。'+(service.status().provider==='isolated'?'当前是独立验证日历，真实外部日历尚未接入。':'');
}
export function startOffice(h,run,plan,files){
 const store=h.store;run.officeOperation={operation:plan.operation,sourceJobId:plan.sourceJob?.id||null,formats:plan.formats||null,requirement:plan.requirement||run.request,steps:plan.steps||null,requestPlan:plan.requestPlan||null};run.retryOfRunId=plan.retryOfRunId||null;run.kind='office-operation';run.operation=plan.operation;run.turns=0;run.modelProvider='program';run.modelLabel='当前成果处理';store.state.runs.push(run);const controller=new AbortController();h.active.set(run.id,controller);store.save();
 void(async()=>{try{
  if(plan.operation==='restore'){selectRevision(store,run.conversationId,plan.sourceJob.id);run.localJobIds=[plan.sourceJob.id];run.answer='已将上一版设为当前成果。后续修改将以它为基础，所有版本仍保留。';run.status='done';return;}
  if(plan.operation==='schedule'){await schedule(h,run);run.status='done';return;}
  if(['delivery','no_retry','blocked_retry','selection'].includes(plan.operation)){
   const j=plan.sourceJob;run.localJobIds=j&&deliveryArtifacts(store,j).artifacts.length?[j.id]:[];run.answer=plan.message||(plan.operation==='selection'?'已更新文件范围，后续只使用当前保留的材料。历史交付仍可访问。':j?'最近已经验证的文件列在下方，直接下载即可；没有重新调用模型。':'本对话还没有可下载的已验证成果。');run.status=plan.operation==='blocked_retry'?'failed':'done';if(run.status==='failed')run.error=run.answer;return;
  }
  await executeOfficeDelivery(h,run,plan,files);
 }catch(e){if(run.status==='cancelled')return;run.status='failed';run.error=e.message;run.answer='这一步没有完成：'+e.message+'。先前已交付的文件和原始材料仍然保留。';}finally{run.finishedAt=now();recordWork(store,run,plan);h.active.delete(run.id);store.save();}})();return run;
}

export async function executeOfficeDelivery(h,run,plan,files=[]){
 const store=h.store;let input=await inputFor(h,run,plan,files);const originalTitle=input.title||'当前成果',scope=plan.sourceJob?.dataScope||files;run.operation=plan.operation;
 run.requirementResults=[];run.userCorrections=[];
 const steps=plan.steps?.length?plan.steps:({modify:[{type:/收件人|收票人/.test(plan.requirement||run.request)?'recipient':'legacy_sum'}],dedupe:[{type:'legacy_dedupe'}],group:[{type:'legacy_group'}],report:[{type:'report'}]}[plan.operation]||[]);
 if(plan.operation==='merge'){input=merge(input,files);run.requirementResults.push({id:'merge',type:'merge',state:'applied',detail:'按同名字段合并；所有来源保留'});}
 for(const step of steps){
  if(step.type.startsWith('legacy_')){input=step.type==='legacy_sum'?modify(input,'金额汇总'):step.type==='legacy_group'?group(input):dedupe(input);run.requirementResults.push({id:'requirement-'+(run.requirementResults.length+1),type:step.type,state:'applied',detail:step.type==='legacy_sum'?'按币种汇总明确金额列':step.type==='legacy_group'?'按部门统计明确可加总字段':'去除完全重复的业务记录，重复来源另表保留'});}
  else{const result=applyOfficeEdits(input,[step],plan.requirement||run.request);input=result.input;run.requirementResults.push(...result.results.map(r=>({...r,id:'requirement-'+(run.requirementResults.length+1)})));run.userCorrections.push(...result.changes);}
 }
 if(!steps.length&&plan.operation==='convert')run.requirementResults.push({id:'format',type:'convert',state:'applied',detail:'按指定格式生成；回读核对现有内容，未重新识别原件'});
 input.title=originalTitle.slice(0,65)+(plan.operation==='report'?'领导报告':steps.length?'修订':'');
 run.resolvedFileIds=scope.map(f=>f.id);run.sourceFiles=scope;run.inputArtifactIds=plan.sourceJob?outputIds(plan.sourceJob):[];run.parentWorkItemId=plan.sourceJob?.workItemId||plan.sourceJob?.chatRunId||null;
 const targetFormats=plan.formats?.length?plan.formats:plan.operation==='report'?['docx']:['xlsx'];run.requestedOfficeFormats=targetFormats;
 const receipt=await h.chatActions.exportFile(run,{title:input.title,content:input.content,sheets:input.sheets,formats:targetFormats});
 const job=store.state.jobs.find(j=>j.id===receipt.job_id);if(!job)throw Error('导出没有登记实际任务');
 job.inputArtifactIds=run.inputArtifactIds;job.workItemId=run.id;job.retryOfJobId=plan.retryOfJobId||null;job.officeSnapshot=structuredClone(input);job.userCorrections=run.userCorrections;job.requirementResults=run.requirementResults;
 const result=await settleDelivery(store,run);if(run.status==='cancelled')return receipt;
 run.answer=result.answer+'\n'+run.requirementResults.map(x=>x.detail).join('；');run.status=result.delivery.state==='failed'?'failed':'done';if(run.status==='failed')run.error=job.error||'请求格式未交付';else advanceRevision(store,run,job,plan.sourceJob);recordWork(store,run,plan);store.save();return {...receipt,requirements:run.requirementResults};
}

export function officeEditStepSchema(Type){
 const str=Type.String(),column=Type.String({description:'要统计的列名或字段ID，来自 describe_current_work；例如 金额 或 c3'});
 const aggregate={type:Type.Literal('aggregate'),sheet:Type.Optional(str),groupBy:Type.Optional(Type.Array(str,{description:'分组列名或字段ID；币种由程序自动隔离'})),outputName:Type.Optional(str)};
 return {oneOf:[
  Type.Object({...aggregate,column,metric:Type.String({enum:AGGREGATE_METRICS.filter(m=>m!=='count'),description:'统计运算：sum求和、mean平均、min最小、max最大。列名填column，不使用operator。'})},{additionalProperties:false}),
  Type.Object({...aggregate,metric:Type.Literal('count',{description:'统计记录数，无需数值列'}),column:Type.Optional(column)},{additionalProperties:false}),
  Type.Object({type:Type.String({enum:['add_column','set_cell','rename_column','sort','filter','recipient','report']}),sheet:Type.Optional(str),column:Type.Optional(str),name:Type.Optional(str),row:Type.Optional(str),value:Type.Optional(Type.Union([str,Type.Number(),Type.Boolean(),Type.Null()])),direction:Type.Optional(Type.Union([Type.Literal('asc'),Type.Literal('desc')])),operator:Type.Optional(str),groupBy:Type.Optional(Type.Array(str)),metric:Type.Optional(str),outputName:Type.Optional(str)},{additionalProperties:false})
 ]};
}
export function currentOfficeTools(h,run,Type){
 if(!h.store.productExperience)return [];const context=workContext(h.store,run.conversationId),job=jobs(h.store,run.conversationId).find(j=>j.id===(run.officeTargetJobId||context.latestTaskId));
 if(!job||!job.dataScope?.every(f=>run.resolvedFileIds?.includes(f.id)))return [];
 let described=false,applied=false;const plan={operation:'edit',sourceJob:job};
 const str=Type.String(),step=officeEditStepSchema(Type);
 return [{name:'describe_current_work',label:'读取本对话当前成果的工作表、稳定字段编号和前5行；修改成果前必须调用；无需重跑原件OCR',parameters:Type.Object({},{additionalProperties:false}),action:async()=>{const input=await inputFor(h,run,plan,[]);described=true;return {jobId:job.id,title:job.title,sheets:describeWorkbook(input),request:run.request};}},
 {name:'edit_current_work',label:'一次提交用户本轮全部修改与格式，程序应用、回读并主动交付。所有行号为数据行（不含表头）。无依据不填值；不支持的要求必须列入unhandled，不能重导出伪装完成。仅接受用户明确给出的更正值。',parameters:Type.Object({steps:Type.Array(step,{minItems:1,maxItems:12}),formats:Type.Array(Type.Union(['xlsx','docx','pdf'].map(Type.Literal)),{minItems:1,maxItems:3}),unhandled:Type.Array(str,{maxItems:12})},{additionalProperties:false}),action:async args=>{if(!described)throw Error('先读取当前成果字段');if(applied)throw Error('本轮已有交付，请返回已有下载');if(args.unhandled.length)throw Error('本轮尚未明确的要求：'+args.unhandled.join('；'));const result=await executeOfficeDelivery(h,run,{...plan,steps:args.steps,formats:args.formats},[]);applied=true;return result;}}];
}
