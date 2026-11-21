import vm from 'node:vm';
import {createPatch} from 'diff';
import {SCENARIOS,LOCAL_SCOPES} from './scenarios.mjs';
import {readOriginal,safeName,digest} from './workspace-files.mjs';
import {makeZip,writeArtifact} from './artifacts.mjs';
import {splitWav} from './wav.mjs';
import {indexFiles,searchKnowledge} from './knowledge.mjs';
const array=(v,max=100)=>Array.isArray(v)?v.slice(0,max):[];
const str=(v,max=1500)=>typeof v==='string'?v.slice(0,max):'';
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const escaped=v=>str(v).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=v=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function calendarBytes(events){return Buffer.from(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Companion Local//CN','CALSCALE:GREGORIAN','METHOD:PUBLISH',...events.flatMap(e=>['BEGIN:VEVENT','UID:'+crypto.randomUUID()+'@companion.local','DTSTAMP:'+stamp(new Date()),'DTSTART:'+stamp(e.startAt),'DTEND:'+stamp(e.endAt),'SUMMARY:'+escaped(e.title),'DESCRIPTION:'+escaped('本地导出；尚未同步日历、未发送邀请。\n'+(e.quote||'')),'END:VEVENT']),'END:VCALENDAR',''].join('\r\n'));}
export function verifiedFacts(raw,files,notices){const incoming=array(raw.facts),out=[],bag=Array.isArray(notices)?notices:null;for(const f of incoming){const source=files.find(s=>s.id===f.sourceId);if(!source||typeof f.quote!=='string'||f.quote.trim().length<3||f.quote.length>2000||!source.content.includes(f.quote)){if(bag)bag.push('有一条事实对不上原文，已跳过，其余内容继续交付');continue;}const result={sourceId:source.id,name:source.name,quote:f.quote,text:str(f.text),category:str(f.category,80),value:str(f.value,300)},dropped=[];for(const k of ['startAt','endAt','dueAt','recipient','version','trackingId','project']){const rawValue=typeof f[k]==='string'?f[k]:'',ok=!!rawValue&&f.quote.includes(rawValue);result[k]=ok?str(rawValue,180):'';if(rawValue&&!ok)dropped.push(k);}if(dropped.length&&bag)bag.push('有字段不在原文里，已留空：'+dropped.join('、'));out.push(result);}if(incoming.length&&!out.length)throw Error('提取事实缺少可核查的逐字原文');return out;}
function requireText(files){if(files.some(f=>!f.content||f.truncated)||files.reduce((n,f)=>n+f.content.length,0)>60000)throw Error('需要已核对、未截断且总计不超过60000字的完整正文');}
const OUTPUTS={'01':'每日事项简报','02':'会议协调方案','03':'会前资料简报','05':'邮件跟进检查','06':'最终版本核查','11':'个人周报','12':'发布快照比较','13':'技术资料对照','15':'到期与提醒清单','16':'出差行程单','17':'物流快照比较'};
const INSTRUCTIONS={
 '01':'按上传日程及本机待办列出今日三件重点、截止和冲突；日期不明确留空。',
 '02':'从上传的明确空闲记录提取候选会议。只有双方明确同意的相同时间才可作为已确认候选；没有对方意见时列待确认。startAt/endAt必须在引文出现的带时区ISO字符串，不能猜测。',
 '03':'梳理上次结论、未完成承诺和会前需要确认的问题，事实逐条引用。',
 '05':'对照邮件线程，区分等待回复与已有回复。生成礼貌催办建议，但不得说已经发信；recipient必须为引文里的明确完整邮箱。',
 '06':'最终版认定必须有明确确认记录与附件内容/名称对应，不能仅凭文件名。逐条说明候选与缺失证据。',
 '11':'按已完成/进行中/阻塞/下周计划分类，讨论过不等于完成，计划不能写成成果。',
 '12':'分析导入的发布快照，只推荐明确正式版（排除alpha/beta/rc/dev预发布），说明与用户配置的关联；不宣称现场性能实测。project/version必须是引文逐字字段。',
 '13':'比较上传技术资料，分别列版本/许可/功能/部署条件；没有运行证据仅能写文档宣称，未验证项明确列出。',
 '15':'仅提取明确到期日，付款日不是到期日；dueAt只接受引文中的带时区ISO到期时间，其他格式提示用户补充，不自行猜。',
 '16':'提取已确认订单/会议的起止时间，startAt/endAt只接受引文中带时区ISO。留空缺失项，不猜交通耗时或时区。',
 '17':'比较物流导出快照，区分状态更新时间和查询时间；没有明确承诺日期不认定逾期，不能声称实时查询过。trackingId/value均来自引文。',
};
export async function localReport(ctx){
 const id=ctx.job.scenarioId;let files=ctx.files;
 if(['01','11'].includes(id)){const snapshot=JSON.stringify(ctx.store.state.tasks.map(t=>({id:t.id,title:t.title,done:t.done,dueAt:t.dueAt,details:t.details})),null,2);files=[...files,{id:'local:tasks',name:'本机待办快照.json',content:snapshot}];writeArtifact(ctx.store,ctx.job,'本机待办输入快照.json',Buffer.from(snapshot),'evidence');}
 if(['01','11'].includes(id)&&!ctx.files.length&&!ctx.store.state.tasks.length){writeArtifact(ctx.store,ctx.job,OUTPUTS[id]+'.md',Buffer.from('# '+OUTPUTS[id]+'\n\n本机暂无待办，也未选择其他材料；没有推断任何工作成果或日程。'),'document');ctx.job.status='completed';ctx.job.summary='本机没有待办或上传材料，已交付空事项说明。';ctx.job.checks.push({label:'已读取真实空待办列表，不生成虚构事项',passed:true});return;}
 requireText(files);
 const raw=await ctx.analyze({kind:'scenario-'+id,instruction:INSTRUCTIONS[id]+'\n用户规则：'+ctx.job.rules+'\n本地范围：'+LOCAL_SCOPES[id]+'\n事实至少一条，空材料则明确未发现。所有时间/邮箱/版本/单号/项目字段必须包含在对应引文中，不符合留空。',documents:files.map(f=>({id:f.id,name:f.name,text:f.content})),shape:'{"facts":[{"sourceId":"文件id","quote":"逐字原文","text":"事实解释","category":"状态或类别","value":"原文短值","startAt":"原文带时区ISO或空","endAt":"原文带时区ISO或空","dueAt":"原文带时区ISO或空","recipient":"原文邮箱或空","project":"原文项目名或空","version":"原文版本或空","trackingId":"原文单号或空"}],"suggestions":["建议，不得写成已经执行"],"questions":["缺失内容"]}'});
 const notices=[];const facts=verifiedFacts(raw,files,notices);if(!facts.length)throw Error('需要包含明确事项的材料，未发现可核对事实');const pointed=[...new Set(notices)];
 const warnings=[LOCAL_SCOPES[id]],extra=[];
 if(['02','16'].includes(id)){
  const events=facts.filter(f=>iso(f.startAt)&&iso(f.endAt)&&Date.parse(f.endAt)>Date.parse(f.startAt)).map(f=>({...f,title:f.text||f.category||'待核对日程'}));
  if(events.length){writeArtifact(ctx.store,ctx.job,'待核对导入日历.ics',calendarBytes(events),'calendar');for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++)if(Date.parse(events[i].startAt)<Date.parse(events[j].endAt)&&Date.parse(events[j].startAt)<Date.parse(events[i].endAt))extra.push('时间重叠：'+events[i].title+' / '+events[j].title);extra.push('已导出'+events.length+'个日程候选；请核对再手动导入，尚未在任何日历创建事件。');}else extra.push('缺少带时区的明确起止时间，未生成日历；请补充YYYY-MM-DDTHH:mm:ss+08:00字段。');
 }
 if(id==='05'){
  const recipient=facts.map(f=>f.recipient).find(v=>/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v));
  if(recipient){const body='您好，想跟进此前邮件中尚未确认的事项，请方便时回复。\r\n\r\n这是本地生成的待审核草稿，请核对上下文后再发送。';const subject='=?UTF-8?B?'+Buffer.from('待审核：事项跟进').toString('base64')+'?=';writeArtifact(ctx.store,ctx.job,'待审核催办邮件.eml',Buffer.from('To: '+recipient+'\r\nSubject: '+subject+'\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(body).toString('base64')+'\r\n'),'draft');extra.push('EML草稿已生成；未连接邮箱，未发送，也未建立外部线程监控。');}else extra.push('缺少明确收件邮箱，未生成可发送EML。');
 }
 if(id==='06'){const entries=ctx.files.map(f=>[f.id.slice(0,8)+'_'+safeName(f.name),readOriginal(ctx.store,f)]);entries.push(['版本判定依据.json',Buffer.from(JSON.stringify(facts,null,2))]);writeArtifact(ctx.store,ctx.job,'候选原件与确认依据.zip',await makeZip(entries),'archive');extra.push('包内保留全部候选；最终认定必须人工核对确认记录，未按文件名自动定版。');}
 if(['12','17'].includes(id)){
  ctx.store.state.snapshotHistory||=[];const kind=id==='12'?'release':'logistics';const before=ctx.store.state.snapshotHistory.filter(h=>h.kind===kind).at(-1);const records=facts.map(f=>({key:id==='12'?(f.project+':'+f.version):f.trackingId,text:f.text,value:f.value,quote:f.quote,sourceId:f.sourceId}));
  const current={kind,jobId:ctx.job.id,checkedAt:new Date().toISOString(),records:id==='12'?records.filter(r=>!/(?:alpha|beta|rc\d*|dev|preview)/i.test(r.key)):records};ctx.store.state.snapshotHistory.push(current);ctx.store.state.snapshotHistory=ctx.store.state.snapshotHistory.slice(-200);ctx.store.save();writeArtifact(ctx.store,ctx.job,'导入快照与上次记录.json',Buffer.from(JSON.stringify({previous:before||null,current},null,2)),'evidence');extra.push('已保存本次导入快照；没有实时外部接口，不能监控尚未导入的新变化。');
 }
 if(id==='15'){
  ctx.job.actions=[];for(const f of facts.filter(f=>iso(f.dueAt)))for(const days of [30,7]){const dueAt=new Date(Date.parse(f.dueAt)-days*86400000).toISOString();if(Date.parse(dueAt)<=Date.now()){extra.push(f.text+'：提前'+days+'天的提醒时间已过去，未补造提醒');continue;}ctx.job.actions.push({id:crypto.randomUUID(),title:(f.text||'到期事项').slice(0,100)+' · 提前'+days+'天',owner:'本人',dueText:'到期'+f.dueAt+'，提前'+days+'天',dueAt,quote:f.quote,sourceId:f.sourceId,location:f.name,status:'pending'});}
  if(ctx.job.actions.length)extra.push('已计算'+ctx.job.actions.length+'个提醒时间；时间完整有效时按默认授权创建本机提醒。');else extra.push('未发现可创建的未来ISO到期时间；未创建提醒。');
 }
 const highlight=pointed.length?'\n\n## 醒目提示\n\n结果已按能核对的内容生成。下面这些地方对不上，请核对：\n\n'+pointed.map(x=>'- '+x).join('\n'):'';
 const report='# '+OUTPUTS[id]+'\n\n处理时间：'+new Date().toISOString()+'\n\n## 可核对事实\n\n'+facts.map((f,i)=>`${i+1}. [${f.category||'事实'}] ${f.text}\n   来源：${f.name}\n   原文：${f.quote}`).join('\n\n')+'\n\n## 建议（尚未执行）\n\n'+array(raw.suggestions,20).map(x=>'- '+str(x)).join('\n')+'\n\n## 待确认\n\n'+array(raw.questions,20).map(x=>'- '+str(x)).join('\n')+'\n\n## 范围与实际结果\n\n'+[...warnings,...extra].map(x=>'- '+x).join('\n')+highlight;
 writeArtifact(ctx.store,ctx.job,OUTPUTS[id]+'.md',Buffer.from(report),'document');writeArtifact(ctx.store,ctx.job,'事实与来源.json',Buffer.from(JSON.stringify({facts,scope:LOCAL_SCOPES[id],extra,softNotices:pointed},null,2)),'evidence');ctx.job.checks.push({label:'全部事实引文匹配所选原文，未虚构外部操作回执',passed:true});
 const external=['02','05','12','16','17'];ctx.job.softNotices=pointed.map(text=>({text}));for(const text of pointed)if(!ctx.job.warnings.includes(text))ctx.job.warnings.push(text);ctx.job.warnings.push(LOCAL_SCOPES[id]);
 let status=id==='15'&&ctx.job.actions.length?'awaiting_approval':external.includes(id)||array(raw.questions).length?'partial':'completed';if(pointed.length&&status==='completed')status='partial';ctx.job.status=status;ctx.job.summary='已完成本地'+OUTPUTS[id]+'，核验'+facts.length+'条事实。'+(external.includes(id)?'外部同步/发送/实时监控未执行。':'')+(pointed.length?'有'+pointed.length+'处对不上，已在醒目提示标出。':'');
}
export async function knowledgeTask(ctx){requireText(ctx.files);const indexed=await indexFiles(ctx.store,ctx.harness,ctx.files,ctx.signal);const query=ctx.job.rules||ctx.files[0].content.slice(0,80);const result=await searchKnowledge(ctx.store,ctx.harness,query,ctx.signal);writeArtifact(ctx.store,ctx.job,'知识入库与检索回执.json',Buffer.from(JSON.stringify({indexed,query,...result},null,2)),'receipt');if(!result.items.length){const text='入库已完成，但检索没有回读到片段，请换一个更贴近原文的问题';ctx.job.softNotices=[{text}];ctx.job.warnings.push(text);ctx.job.checks.push({label:'已写入索引；这次检索没有回读到片段',passed:false});ctx.job.status='partial';ctx.job.summary='已新增'+indexed.added+'个知识片段；检索没有回读到内容，回执已交付。';return;}ctx.job.checks.push({label:'已写入持久化索引并通过真实内网检索返回来源',passed:true});ctx.job.status='completed';ctx.job.summary='已新增'+indexed.added+'个知识片段，检索回读'+result.items.length+'条。';}
export function clipPcmWav(bytes,start,end){const parts=splitWav(bytes,500),full=parts[0];if(!full||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>full.end)throw Error('需要在原WAV范围内的有效起止秒数');const rate=full.bytes.readUInt32LE(28),align=full.bytes.readUInt16LE(32),a=Math.floor(start*rate/align)*align,b=Math.floor(end*rate/align)*align,data=full.bytes.subarray(44+a,44+b);if(!data.length)throw Error('片段为空');const header=Buffer.from(full.bytes.subarray(0,44));header.writeUInt32LE(36+data.length,4);header.writeUInt32LE(data.length,40);return Buffer.concat([header,data]);}
export async function mediaClips(ctx){
 if(ctx.files.length!==1||ctx.files[0].extension!=='.wav'||!ctx.files[0].recognition?.confirmedAt)throw Error('需要单个已回听核对的16位PCM WAV，最长500秒');const f=ctx.files[0],ranges=ctx.job.options.clipRanges;if(!Array.isArray(ranges)||!ranges.length||ranges.length>12)throw Error('请填写1至12个起止片段，例如0-5,5-10');const original=readOriginal(ctx.store,f),index=[],failed=[];
 for(const [i,r] of ranges.entries()){try{const audio=clipPcmWav(original,r.start,r.end),name=String(i+1).padStart(2,'0')+'_'+r.start+'-'+r.end+'秒.wav';writeArtifact(ctx.store,ctx.job,name,audio,'audio');index.push({...r,name,sourceId:f.id,sha256:digest(audio)});}catch(error){failed.push(r.start+'-'+r.end+'秒没有导出：'+error.message);}}
 if(!index.length)throw Error(failed[0]||'没有能导出的有效片段');writeArtifact(ctx.store,ctx.job,'时间线与已核对转写.txt',Buffer.from(f.content),'transcript');writeArtifact(ctx.store,ctx.job,'实际片段索引.json',Buffer.from(JSON.stringify({index,failed},null,2)),'evidence');
 ctx.job.softNotices=failed.map(text=>({text}));for(const text of failed)ctx.job.warnings.push(text);ctx.job.status=failed.length?'partial':'completed';ctx.job.summary='实际导出'+index.length+'段WAV'+(failed.length?'，另有'+failed.length+'段范围无效，已在醒目提示标出':'')+'，保留来源秒数与核对稿；范围需回听验证。';ctx.job.warnings.push('仅支持≤500秒WAV，暂不支持视频或两小时媒体；片段范围由用户明确选择，转写时间不是逐字对齐。');ctx.job.checks.push({label:'按PCM采样边界实际裁剪并回读WAV参数',passed:true});
}
export async function codePatch(ctx){
 requireText(ctx.files);if(ctx.files.length>5)throw Error('代码修复每次最多5个源码文件');const raw=await ctx.analyze({kind:'限定上传代码修复副本',instruction:ctx.job.rules+'。只修所述问题，不运行任何代码；每个修改的before必须在原文唯一出现，after为修正代码。',documents:ctx.files.map(f=>({id:f.id,name:f.name,text:f.content})),shape:'{"changes":[{"sourceId":"原件ID","before":"唯一原文片段","after":"替换片段","reason":"修改原因"}],"tests":["待人工运行的测试建议"]}'});const entries=[],changes=[];
 const skipped=[];for(const f of ctx.files){let content=f.content;const modifications=array(raw.changes,20).filter(c=>c.sourceId===f.id);let applied=0;for(const c of modifications){if(typeof c.before!=='string'||!c.before||typeof c.after!=='string'||c.after.length>30000||content.split(c.before).length!==2){skipped.push(f.name+'：「'+str(c.before,40)+'」对不上唯一原文，已跳过');continue;}content=content.replace(c.before,()=>c.after);changes.push({sourceId:f.id,reason:str(c.reason),before:c.before,after:c.after});applied++;}if(!applied)continue;
  let check='未执行代码，未运行测试';try{if(['.js','.cjs'].includes(f.extension)){new vm.Script(content);check='JS语法解析通过，未运行代码或测试';}else if(f.extension==='.json'){JSON.parse(content);check='JSON解析通过，未运行业务测试';}}catch{for(let i=changes.length-1;i>=0;i--)if(changes[i].sourceId===f.id)changes.splice(i,1);skipped.push(f.name+'：修改后无法解析，已跳过这份副本');continue;}
  entries.push(['修复副本/'+safeName(f.name),Buffer.from(content)],['补丁/'+safeName(f.name)+'.patch',Buffer.from(createPatch(f.name,f.content,content))]);ctx.job.checks.push({label:f.name+'：'+check,passed:true});}
 if(!changes.length)throw Error(skipped[0]||'模型没有提交可核验的代码修改');ctx.job.softNotices=skipped.map(text=>({text}));for(const text of skipped)ctx.job.warnings.push(text);entries.push(['修改与验证范围.json',Buffer.from(JSON.stringify({changes,skipped,tests:array(raw.tests,20),executedTests:false,createdPr:false},null,2))]);writeArtifact(ctx.store,ctx.job,'修复副本与补丁.zip',await makeZip(entries),'archive');ctx.job.status='partial';ctx.job.summary='已生成'+changes.length+'处修改的副本与补丁'+(skipped.length?'，另有'+skipped.length+'处对不上，已跳过并标出':'')+'；未运行上传代码或测试，未创建PR。';ctx.job.warnings.push(LOCAL_SCOPES['19']);
}
export async function inspectServices(ctx){await ctx.harness.directory.refresh();await ctx.harness.directory.discoverMore();const info=ctx.harness.directory.status(),checks=[...Object.values(info.services),...info.capabilities];writeArtifact(ctx.store,ctx.job,'内网接口巡检记录.json',Buffer.from(JSON.stringify({checkedAt:new Date().toISOString(),...info,gpuMetrics:null,diskMetrics:null},null,2)),'evidence');ctx.job.checks.push({label:'对固定目录服务执行实际HTTP探测并记录结果',passed:true});ctx.job.status=checks.every(c=>c.ready)?'completed':'partial';ctx.job.summary='实际检查'+checks.length+'个内网接口，'+checks.filter(c=>!c.ready).length+'个未就绪。';ctx.job.warnings.push('GPU/磁盘监控接口未接入，未探测这些指标，不自动重启任何服务。');}
export const LOCAL_PROCESSORS=Object.fromEntries(Object.keys(OUTPUTS).map(id=>[id,localReport]));Object.assign(LOCAL_PROCESSORS,{'14':knowledgeTask,'18':mediaClips,'19':codePatch,'20':inspectServices});
