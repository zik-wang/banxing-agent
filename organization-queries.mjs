import {organizationView} from './organization.mjs';
const LABELS={open:'待推进',in_progress:'进行中',blocked:'受阻',done:'已完成'};
const recordedTime=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':'入库时间未记录';
const guard=(v,name)=>{if(v!==undefined&&(typeof v!=='string'||!v.trim()||v.length>160))throw Error(name+'须为1至160字');return v?.trim();};
const summary=i=>({key:i.key,project:i.project,title:i.title,owner:i.owner,dueDate:i.dueDate,status:i.status,risks:i.risks,conflicts:i.conflicts,revision:i.revision,commitmentSource:i.history[0].source,latestSource:i.history.at(-1).source});
export function queryOrganization(store,conversationId,options={}){
 const project=guard(options.project,'项目'),owner=guard(options.owner,'责任人'),item=guard(options.item,'事项');
 const offset=options.offset??0,limit=options.limit??10;
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)throw Error('查询分页须为非负偏移、每页1至20条');
 let items=organizationView(store,conversationId,options.date||new Date());
 if(project)items=items.filter(i=>i.project===project);if(owner)items=items.filter(i=>i.owner===owner);if(options.risksOnly)items=items.filter(i=>i.risks.length);
 if(item){const byKey=items.filter(i=>i.key===item);items=byKey.length?byKey:items.filter(i=>i.title===item);
  if(items.length>1)return {ambiguous:true,choices:items.map(i=>({key:i.key,project:i.project,title:i.title})),total:items.length,items:[],scope:'当前对话'};
  const record=items[0];if(!record)return {total:0,items:[],scope:'当前对话',item:true};
  const events=[...record.history].reverse();return {total:1,items:[summary(record)],history:events.slice(offset,offset+limit),historyTotal:events.length,offset,nextOffset:offset+limit<events.length?offset+limit:null,scope:'当前对话'};
 }
 return {total:items.length,items:items.slice(offset,offset+limit).map(summary),offset,nextOffset:offset+limit<items.length?offset+limit:null,scope:'当前对话'};
}
export function organizationProjects(store,conversationId,date=new Date()){
 const projects=new Map();for(const i of organizationView(store,conversationId,date)){let row=projects.get(i.project);if(!row){row={project:i.project,total:0,done:0,attention:0,owners:[]};projects.set(i.project,row);}row.total++;if(i.status==='done')row.done++;if(i.risks.length)row.attention++;if(i.owner&&!row.owners.includes(i.owner))row.owners.push(i.owner);}
 return [...projects.values()].sort((a,b)=>a.project.localeCompare(b.project,'zh-CN'));
}
const cite=s=>`${s.name} 第${s.line}行：“${s.quote.slice(0,500)}”${s.quote.length>500?'（引文仅展示前500字）':''}`;
export function formatOrganizationQuery(result){
 if(result.ambiguous)return '有多项同名事项，请使用明确的事项标识查询：\n\n'+result.choices.map(i=>`- ${i.project} / ${i.title}：事项详情：${i.key}`).join('\n');
 if(!result.total)return '当前对话中没有符合条件的组织事项。可以说“项目列表”查看已记录的项目；不会自动查询其他对话。';
 if(!result.items.length)return `当前筛选共${result.total}项，这一页已超出范围，请查看前面的页码。`;
 let answer=`当前对话匹配${result.total}项，以下为本机记录：\n\n`+result.items.map(i=>`- ${i.project} / ${i.title}（事项标识：${i.key}）\n  ${LABELS[i.status]||'状态待核对'}；负责人：${i.owner||'待明确'}；期限：${i.dueDate||'待明确'}；关注：${i.risks.join('、')||'暂无规则风险'}\n  承诺依据：${cite(i.commitmentSource)}${i.revision>1?'\n  最新记录：'+cite(i.latestSource):''}${i.conflicts.length?'\n  冲突说明：'+[...new Set(i.conflicts.map(c=>c.reason))].join('；'):''}`).join('\n\n');
 if(result.history){answer+=`\n\n事件记录：共${result.historyTotal}条，本页${result.history.length}条（最近入库在前，不代表实际发生顺序）。\n\n`+result.history.map(e=>`- ${recordedTime(e.recordedAt)} · ${e.kind==='commitment'?'记录承诺':LABELS[e.status]}\n  ${cite(e.source)}`).join('\n\n');}
 if(result.nextOffset!==null&&result.nextOffset!==undefined)answer+='\n\n还有记录。'+(result.history?`可说“事项详情：${result.items[0].key} 第${Math.floor(result.nextOffset/10)+1}页”。`:'可说“组织进展 第'+(Math.floor(result.nextOffset/10)+1)+'页”，或按项目、责任人缩小范围。');
 return answer+'\n\n来源是已提供的材料，尚未向责任人独立核实。';
}
export function organizationReadChat(store,conversationId,message,files=[]){
 if(files.length)return null;const query=message.trim().replace(/[。！？?!]+$/u,'');
 if(['项目列表','组织项目'].includes(query)){const rows=organizationProjects(store,conversationId);return {answer:rows.length?'当前对话的项目：\n\n'+rows.map(r=>`- ${r.project}：${r.total}项，已完成${r.done}项，需关注${r.attention}项；责任人：${r.owners.join('、')||'待明确'}`).join('\n')+'\n\n可以说“项目进展：项目名”“负责人事项：姓名”或“事项详情：事项标识”。':'当前对话尚无组织项目。上传组织事项清单和原文后，可以说“记录组织事项”。',jobIds:[]};}
 if(query==='组织时间线'){const events=(store.state.organizationEvents||[]).filter(e=>e.conversationId===conversationId).slice(-20).reverse();return {answer:'本对话最近20条事件（按入库顺序倒序，不代表实际发生顺序）：\n\n'+(events.length?events.map(e=>`- ${recordedTime(e.recordedAt)} · ${e.key} · ${e.kind==='commitment'?'记录承诺':LABELS[e.status]}\n  ${cite(e.source)}`).join('\n\n'):'尚无记录。'),jobIds:[]};}
 const paged=query.match(/^(.*?)(?:\s+第([1-9]\d*)页)?$/u),body=paged[1],page=Number(paged[2]||1);if(!Number.isSafeInteger(page)||page>500)return null;
 let options={offset:(page-1)*10};
 if(['组织进展','查看组织进展','组织风险','查看组织风险'].includes(body))options.risksOnly=body.includes('风险');
 else{const match=body.match(/^(项目进展|项目风险|负责人事项|事项详情)[：:]\s*(.+)$/u);if(!match)return null;options[{项目进展:'project',项目风险:'project',负责人事项:'owner',事项详情:'item'}[match[1]]]=match[2];options.risksOnly=match[1]==='项目风险';}
 const result=queryOrganization(store,conversationId,options);let answer=formatOrganizationQuery(result);
 // Preserve the filters when suggesting the next page.
 if(result.nextOffset!==null&&result.nextOffset!==undefined)answer=answer.replace(/可说“组织进展 第\d+页”/,`可说“${body} 第${page+1}页”`);
 return {answer,jobIds:[]};
}
