// Deliberately narrow queries: local receipts never guess intent or start a workflow.
const normalize=value=>typeof value==='string'?value.trim().replace(/[。！？?!]+$/u,''):'';
const QUERIES=new Map([
 ...['你能做什么','你会什么','帮助','使用帮助','/help'].map(s=>[s,'help']),
 ...['查看任务进度','任务进度','查进度','进度怎么样了','/status'].map(s=>[s,'status']),
 ...['查看交付文件','查看已交付文件','交付文件在哪','找回交付文件','/files'].map(s=>[s,'files']),
]);
const LABELS={queued:'排队中',running:'执行中',completed:'已交付',partial:'已交付，含范围限制',awaiting_approval:'需要补充行动或提醒时间',waiting_input:'需要补充材料',failed:'未完成',cancelled:'已停止',interrupted:'已中断'};
export function localChatReply(store,conversationId,message){
 const query=QUERIES.get(normalize(message));if(!query)return null;
 if(query==='help')return {answer:'你可以在设置 → 任务与材料中连接本机目录，然后说“目录列表”“扫描目录”“目录变化”。扫描本身不调用模型。\n\n你也可以说“项目列表”“项目进展：项目名”“负责人事项：姓名”或“事项详情：事项标识”，查询本对话的承诺和依据；也可以直接问“组织进展”“组织风险”“组织时间线”。上传组织事项JSON清单与原始材料后说“记录组织事项”，断网也能记录明确的结构化事实。普通文档的理解与提取仍需模型。\n\n你也可以直接上传材料并说明目标，例如：\n\n- “比较这两份版本，列出具体差异。”\n- “把这份材料整理成会议纪要和行动项。”\n- “整理这些票据，算清有效报销金额。”\n\n只上传材料时，我会先给建议，等你交办。扫描件、录音需要先识别核对。\n\n暂时不在公司内网也可以说“查看任务进度”或“查看交付文件”，查询本对话已保存的记录；模型分析需要恢复内网连接。本地提醒在服务运行时仍可触发。',jobIds:[]};
 const jobs=(store.state.jobs||[]).filter(j=>j.conversationId===conversationId).filter(j=>query!=='files'||j.artifacts?.some(a=>a.kind!=='audit')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,5);
 if(!jobs.length)return {answer:query==='files'?'这段对话还没有可下载的交付文件。你可以切回原来交办任务的对话再问。':'这段对话还没有后台任务记录。上传材料并交办后，可以在这里查询进度。',jobIds:[]};
 return {answer:`以下是本对话最近${query==='files'?'有文件的任务':'的任务'}，直接读取本机记录，没有调用模型：\n\n`+jobs.map(j=>`- ${j.title}：${LABELS[j.status]||'状态待核对'}${j.error?'；'+j.error:j.summary?'；'+j.summary:''}`).join('\n')+'\n\n'+(query==='files'?'可下载文件列在下面，部分交付请同时查看限制说明。':'进度和已有文件列在下面；查询本身不会重新执行任务。'),jobIds:jobs.map(j=>j.id)};
}
