import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import {readOriginal,digest} from './workspace-files.mjs';
import {writeArtifact} from '../documents/artifacts.mjs';
import {WORK_SCENARIOS} from './work-scenario-catalog.mjs';
import {coveredAnalysis,coverageMarkdown,transitionMarkdown,writeCoverageArtifacts} from '../evidence/source-coverage.mjs';
import {renderReliabilityItems,expectDelivery} from '../recovery/reliability.mjs';
import {locateCitation,validateRelation,validateMissingScope} from '../evidence/issue-review.mjs';
import {documentRequirements} from '../documents/document-integrity.mjs';

const list=(v,n=150)=>Array.isArray(v)?v.slice(0,scaledLimit(n)):[];
const text=(v,n=2000)=>typeof v==='string'?v.trim().slice(0,n):'';
const warning=(ctx,s)=>{if(!ctx.job.warnings.includes(s))ctx.job.warnings.push(s);};
function note(ctx,s){warning(ctx,s);ctx.job.softNotices||=[];if(!ctx.job.softNotices.some(n=>n.text===s))ctx.job.softNotices.push({text:s});}
const positive=s=>!/未(?:能|经|获|被)?确认|尚未|未通过|失败|仍.*复现|未解决|不予|不同意/.test(s);
const INSTRUCTIONS={
 '21':'从需求和有效确认记录逐项提取要求。status=confirmed或needs_clarification。模糊目标不冒充已确认条件。acceptance保存原文中的验收条件；建议验收条件单放suggestions，待确认后再转为事实。',
 '22':'逐项列出全部交付要求，不得遗漏缺件。basis引用要求，evidence引用实际交付正文/验证记录。status=verified/missing/conflict/needs_confirmation。目录或口头已完成不等实际交付。缺少材料要限定为本次所选文件未找到。',
 '24':'提取变更及受影响任务，标明依赖。status=changed/affected/unaffected/needs_confirmation。依据不足不猜受影响工期/成本；建议与已生效调整分开。',
 '25':'逐项提取任务key、status=done/in_progress/blocked/unknown与dependsOn。依赖和负责人必须在同一任务的引文中出现。完整列出作为依赖的任务，程序追踪实际未完成根节点；不能靠猜测分派责任人。',
 '26':'提取交接事项、现状、已有承诺、未完动作与接手记录。status=accepted/pending/needs_confirmation。交接包已生成不等接手人已接收，accepted必须有明确接手确认。',
 '27':'逐条列出反馈或问题，covers列出本项覆盖的原文反馈ID（如FB1）。保留各客户诉求。status=resolved/open/in_progress/needs_confirmation。已回复或已改代码不等解决，resolved必须有实际复测/验收依据。',
 '28':'按岗位要求逐项核对办公条件，区分已有可用、仅申请和缺项。status=available/requested/missing/needs_confirmation。available要有可用验证/实际领取等依据，已受理或已开通不自动代表可用。'
};

function requireText(files){
 if(!files.length||files.some(f=>!f.content||f.truncated))throw Error('需要完整、已核对的文字材料');
 if(files.reduce((n,f)=>n+f.content.length,0)>60000)throw Error('本批超过60000字符，请拆分或补充更精确的材料');
}
function refs(raw,files,problems){const out=[];for(const r of (Array.isArray(raw)?raw:[])){
 const file=files.find(f=>f.id===r?.sourceId);let quote=text(r?.quote);
 if(file&&quote.length>=3&&!file.content.includes(quote)){const located=locateCitation({...r,quote},[{id:r.unitId||file.id,sourceId:file.id,start:0,text:file.content}]);if(located.status==='source_supported')quote=located.spans[0].text;}
 if(!file||quote.length<3||!file.content.includes(quote)){problems.push('引用对不上原文，已跳过：「'+(quote||text(r?.sourceId,24)||'空引用').slice(0,24)+'」');continue;}
 const hasPosition=Number.isInteger(r.start)&&Number.isInteger(r.end),at=hasPosition&&file.content.slice(r.start,r.end)===quote?r.start:file.content.indexOf(quote);
 out.push({sourceId:file.id,name:file.name,quote,line:file.content.slice(0,at).split('\n').length+1,...(hasPosition?{start:at,end:at+quote.length,unitId:r.unitId}:{})});
}return out;}
function validateItem(raw,ctx,index){
 const problems=[];const basis=refs(raw.basis,ctx.files,problems),evidence=refs(raw.evidence,ctx.files,problems);
 for(const problem of problems)note(ctx,problem);
 if(!basis.length){note(ctx,'核对项「'+(text(raw.title,40)||text(raw.key,40)||'未命名')+'」没有可用原文依据，已跳过，其余项继续交付');return null;}
 let quotes=[...basis,...evidence].map(r=>r.quote).join('\n');
 const key=text(raw.key,100)||digest(Buffer.from(basis[0].quote)).slice(0,16);
 const row={key,title:text(raw.title,300)||'核对项'+(index+1),status:text(raw.status,80),basis,evidence,
  owner:text(raw.owner,100),dueText:text(raw.dueText,100),summary:text(raw.summary),nextAction:text(raw.nextAction),
  acceptance:text(raw.acceptance),dependsOn:list(raw.dependsOn,30).map(x=>text(x,100)),covers:list(raw.covers,100).map(x=>text(x,100)),...(raw.programComparison?{programComparison:raw.programComparison,verification:raw.verification}:{}),...(raw.sourceKey?{sourceKey:raw.sourceKey}:{}),...(raw.candidateId?{candidateId:raw.candidateId,verification:raw.verification}:{})};
 for(const [field,label]of [['owner','负责人'],['dueText','期限'],['acceptance','验收条件']])if(row[field]&&!quotes.includes(row[field])){
  const source=ctx.files.flatMap(f=>f.content.split('\n')
   .filter(line=>line.includes(row.key)&&line.includes(row[field]))
   .map(line=>({sourceId:f.id,name:f.name,quote:line,line:f.content.slice(0,f.content.indexOf(line)).split('\n').length+1})))[0];
  if(source){basis.push(source);quotes+='\n'+source.quote;}
  else{row[field]='';note(ctx,label+'未核对到对应事项原文，已留空，其他有依据的分析继续交付');}
 }
 const droppedDeps=row.dependsOn.filter(k=>!quotes.includes(k));if(droppedDeps.length){row.dependsOn=row.dependsOn.filter(k=>quotes.includes(k));note(ctx,'有依赖编号对不上原文，已从该项移除：'+droppedDeps.join('、'));}
 const droppedCovers=row.covers.filter(k=>!quotes.includes(k));if(droppedCovers.length){row.covers=row.covers.filter(k=>quotes.includes(k));note(ctx,'有反馈编号对不上原文，已从该项移除：'+droppedCovers.join('、'));}
 const downgrade=reason=>{row.status='needs_confirmation';row.limit=reason;note(ctx,reason);};
 const id=ctx.job.scenarioId;
 row.semanticRelations=[];row.proposedFields={};
 const relationUnits=[...basis,...evidence].map((r,i)=>({id:r.unitId||'ref-'+i,sourceId:r.sourceId,start:r.start||0,text:r.quote}));
 for(const [field,predicate,subject,object]of [['owner','responsible_for',row.owner,row.sourceKey||row.key],['dueText','due_on',row.sourceKey||row.key,row.dueText]])if(row[field]){
  const relation=validateRelation({subject,predicate,object,sourceUnitIds:relationUnits.map(u=>u.id)},relationUnits);row.semanticRelations.push(relation);
  if(relation.validationStatus!=='supported'){row.proposedFields[field]=row[field];row[field]='';note(ctx,(field==='owner'?'负责人':'期限')+'关系未获明确支持，已留空并保留候选：'+relation.reason);}
 }
 if(Object.keys(row.proposedFields).length){row.semanticStatus='needs_semantic_review';if(row.status==='verified')row.status='needs_confirmation';if(row.status==='confirmed')row.status='needs_clarification';}
 const states={21:['confirmed','needs_clarification'],22:['verified','missing','conflict','needs_confirmation'],24:['changed','affected','unaffected','needs_confirmation'],25:['done','in_progress','blocked','unknown'],26:['accepted','pending','needs_confirmation'],27:['resolved','open','in_progress','needs_confirmation'],28:['available','requested','missing','needs_confirmation']};
 if(!states[id].includes(row.status)){row.status=states[id].includes('needs_confirmation')?'needs_confirmation':states[id].includes('needs_clarification')?'needs_clarification':states[id].includes('unknown')?'unknown':states[id].at(-1);note(ctx,'有核对项状态无法识别，已改为待确认，其余内容继续交付');}
 const confirmedText=evidence.filter(r=>positive(r.quote)&&/确认|同意|必须|应当|要求|验收标准/.test(r.quote)).map(r=>r.quote).join('\n')||quotes;
 if(id==='21'&&row.status==='confirmed'&&(!positive(confirmedText)||!/确认|同意|必须|应当|要求|验收标准/.test(confirmedText)||/尽快|简单一点|看情况|各种情况|待商定/.test(confirmedText)))downgrade('存在尚未明确的需求，不视为已确认条件');
 if(id==='22'&&row.status==='verified'){
  const actual=evidence.filter(r=>!basis.some(b=>b.sourceId===r.sourceId&&b.quote===r.quote)&&!/^.*(?:已附|已完成|已提交|已交付)[。；;\s]*$/.test(r.quote)&&!/(?:附件|文件|交付)目录/.test(r.name));
  const formalOpinion=/公示|验收意见|验收结论/.test(ctx.job.rules||'')&&[...basis,...evidence].some(r=>/验收合格/.test(r.quote)&&positive(r.quote)&&!/声称|自称|据说|待|未|不合格/.test(r.quote));
  if(!actual.length&&!formalOpinion)downgrade('交付只有目录或完成声明，未核对到实际材料/验证依据');
  if(formalOpinion)row.validationState='source_supported';
 }
 if(id==='22'&&row.status==='missing'){
  const requirements=basis.filter(r=>r.quote.includes(row.key)&&/要求|必须|应当|需提交/.test(r.quote));
  const unrelated=[...basis,...evidence].some(r=>/不属于|与本项目无关|不适用/.test(r.quote));
  const actualLines=ctx.files.flatMap(f=>f.content.split('\n')).filter(line=>line.includes(row.key)&&!requirements.some(r=>r.quote===line)&&!/目录|登记|已附|要求|必须|尚未|未提交|未提供/.test(line)&&/正文[:：]|验证通过|验收通过|复测通过/.test(line));
  const absence=ctx.files.every(f=>!f.truncated&&f.parseStatus==='ready')&&requirements.length>0&&!actualLines.length;
  const checked=validateMissingScope({status:row.status,requirement:requirements[0]?.quote,inScope:unrelated?false:requirements.length?true:null,required:requirements.length?true:null,inspectionComplete:absence,absenceEvidence:absence?'当前授权完整正文未找到对应实际交付/验证材料':null});
  row.scopeValidation=checked;if(checked.status!=='missing'){row.originalStatus=row.status;row.scopeDisposition=checked.status;downgrade(checked.reason);}
 }
 if(id==='25'&&row.status==='done'&&(!positive(quotes)||!/已完成|验收通过|复测通过|已交付|已解决/.test(quotes)))downgrade('未找到该任务完成依据，依赖不能按已完成解除');
 if(id==='26'&&row.status==='accepted'&&!evidence.some(r=>positive(r.quote)&&/确认接手|已接手|已接收|接收确认|同意接手/.test(r.quote)))downgrade('尚无接手确认，不能把交接资料生成当成已接手');
 if(id==='27'&&row.status==='resolved'){
  if(!evidence.length||!positive(evidence.map(r=>r.quote).join('\n'))||!evidence.some(r=>/复测通过|验证通过|验收通过|确认解决|问题已消除/.test(r.quote)))downgrade('回复或修复声明不足以核销问题，需要整改验证依据');
  const keys=[row.key,...row.covers].filter(k=>quotes.includes(k));
  const previous=ctx.job.options.previousJobId&&ctx.store.state.jobs.find(j=>j.id===ctx.job.options.previousJobId);
  const oldIds=new Set(previous?.dataScope?.map(f=>f.id)||[]);
  const newVerified=evidence.some(r=>!oldIds.has(r.sourceId)&&positive(r.quote)&&/复测通过|验证通过|验收通过|确认解决|问题已消除/.test(r.quote));
  for(const f of ctx.files)for(const line of f.content.split('\n'))if(keys.some(k=>line.includes(k))&&/仍.*复现|再次出现|复测失败|未解决/.test(line)){
   if(previous&&oldIds.has(f.id)&&newVerified)continue;
   row.status='open';row.evidence.push({sourceId:f.id,name:f.name,quote:line,line:f.content.slice(0,f.content.indexOf(line)).split('\n').length+1});row.limit='材料中仍有复现或未解决记录，保留为未关闭';
  }
 }
 if(id==='28'&&row.status==='available'&&(!evidence.length||!evidence.some(r=>positive(r.quote)&&/登录成功|访问测试通过|可正常登录|已领取|可使用|培训考核通过|已完成培训/.test(r.quote))))downgrade('已申请/受理/开通不等于可用，需要可用性或实际交付依据');
 return row;
}
function lineage(ctx,items){
 const previous=ctx.job.options.previousJobId&&ctx.store.state.jobs.find(j=>j.id===ctx.job.options.previousJobId);
 if(!previous)return null;
 const old=previous.workResult?.items||[],byKey=new Map(items.map(r=>[r.key,r]));
 return {previousJobId:previous.id,changes:old.map(r=>({key:r.key,before:r.status,after:byKey.get(r.key)?.status||'not_rechecked'})),added:items.filter(r=>!old.some(o=>o.key===r.key)).map(r=>r.key)};
}
function blockers(items){
 const byKey=new Map(items.map(r=>[r.key,r])),rows=[];
 function visit(key,path,seen){
  if(path.includes(key))return [{kind:'cycle',chain:[...path,key]}];
  if(seen.has(key))return [];seen.add(key);
  const row=byKey.get(key);if(!row)return [{kind:'missing_node',chain:[...path,key]}];
  if(row.status==='done')return [];
  const pending=row.dependsOn.filter(k=>byKey.get(k)?.status!=='done');
  return pending.length?pending.flatMap(k=>visit(k,[...path,key],seen)):[{kind:'pending',key,owner:row.owner,chain:[...path,key],nextAction:row.nextAction}];
 }
 for(const row of items)if(row.status!=='done')rows.push({key:row.key,roots:visit(row.key,[],new Set())});
 return rows;
}
async function deliver(ctx,result){
 if(ctx.signal?.aborted&&!(ctx.job.scenarioId==='24'&&ctx.signal.reason?.code==='WORKSPACE_TIMEOUT'))throw Error('任务已取消');
 if((ctx.job.softNotices||[]).length&&!String(result.summary||'').includes('醒目提示'))result.summary+=' 有'+ctx.job.softNotices.length+'处对不上，已在醒目提示标出。';
 const scene=WORK_SCENARIOS.find(s=>s.id===ctx.job.scenarioId);
 ctx.job.workResult={...result,lineage:lineage(ctx,result.items)};
 const detail=ctx.job.scenarioId==='24'?renderReliabilityItems(result.items):result.items.map(r=>['## '+r.title+' ['+r.status+']',r.summary,transitionMarkdown(r),r.owner?'负责人：'+r.owner:'',r.dueText?'期限：'+r.dueText:'',r.acceptance?'已确认验收条件：'+r.acceptance:'',r.limit||'',r.nextAction?'下一步建议：'+r.nextAction:'',...[...r.basis,...r.evidence].map(x=>'依据：'+x.name+' 第'+x.line+'行\n> '+x.quote)].filter(Boolean).join('\n\n')).join('\n\n');
 const pointed=ctx.job.softNotices||[];const md='# '+scene.title+'\n\n'+result.summary+'\n\n'+detail+'\n\n## 建议（未执行）\n\n'+result.suggestions.map(s=>'- '+s).join('\n')+'\n\n## 本轮范围\n\n'+scene.scope+'\n\n仅使用本次选中材料；没有发送、提交或改写外部业务记录。\n'+(pointed.length?'\n## 醒目提示\n\n结果已按能核对的内容生成。下面这些地方对不上，请核对：\n\n'+pointed.map(n=>'- '+n.text).join('\n')+'\n':'');
 if(ctx.job.scenarioId==='24')expectDelivery(ctx.job,{items:result.items,structuredName:scene.title+'-结构化结果.json',markdownName:scene.title+'.md',markdown:md},ctx.store);
 writeArtifact(ctx.store,ctx.job,scene.title+'.md',Buffer.from(md),'document');
 writeArtifact(ctx.store,ctx.job,scene.title+'-结构化结果.json',Buffer.from(JSON.stringify(ctx.job.workResult,null,2)),'evidence');
 ctx.job.status=result.needsInput?'waiting_input':ctx.job.warnings.length?'partial':'completed';
 ctx.job.summary=result.summary;ctx.job.nextTrigger=result.needsInput?'补充确认或材料后，可引用本次任务重新核对':'本轮材料核对完成';
 ctx.job.checks.push({label:'所有事实引用均来自本轮授权材料，建议与已执行动作分开',passed:true});
}
export async function businessReview(ctx){
 if(ctx.job.scenarioId==='21'&&ctx.files.some(f=>f.extension==='.pdf'||f.truncated||!f.content||f.content.length>60000))return documentRequirements(ctx);
 requireText(ctx.files);const scene=WORK_SCENARIOS.find(s=>s.id===ctx.job.scenarioId);
 const previous=ctx.job.options.previousJobId&&ctx.store.state.jobs.find(j=>j.id===ctx.job.options.previousJobId);
 const complete=ctx.job.scenarioId==='24'?await coveredAnalysis(ctx,{kind:'work-24',instruction:INSTRUCTIONS['24']}):null;
 const raw=complete?complete.raw:await ctx.analyze({kind:'work-'+ctx.job.scenarioId,documents:ctx.files.map(f=>({id:f.id,name:f.name,text:f.content})),
  instruction:INSTRUCTIONS[ctx.job.scenarioId]+'\n用户目标：'+ctx.job.rules+'\n按原文明确编号填写稳定key，无编号可留空。逐份核对，不遗漏未交和未解决项。basis和evidence都提供sourceId与逐字quote。owner、dueText和acceptance只填对应引文原文，否则留空。nextAction和suggestions为建议，不能声称已执行。'+(previous?'\n前轮结果仅供变化对照，不能取代本轮原文：'+JSON.stringify(previous.workResult).slice(0,10000):''),
  shape:'{"items":[{"key":"原文事项编号或空","title":"具体事项","status":"按本场景约定","basis":[{"sourceId":"文件id","quote":"逐字原文"}],"evidence":[{"sourceId":"文件id","quote":"逐字原文"}],"owner":"原文负责人或空","dueText":"原文期限或空","acceptance":"原文验收条件或空","dependsOn":["原文依赖编号"],"covers":["原文反馈编号"],"summary":"核对说明","nextAction":"下一步建议"}],"suggestions":["未执行建议"]}'});
 if(!complete&&Array.isArray(raw.items)&&raw.items.length>150)throw Error('事项超过150项，需要拆分处理，不能静默遗漏');
 const parsed=(complete?raw.items:list(raw.items)).map((r,i)=>validateItem(r,ctx,i)).filter(Boolean);
 if(!parsed.length){if(!complete)throw Error('没有可交付的核对项：引用都对不上原文');writeCoverageArtifacts(ctx,complete);writeArtifact(ctx.store,ctx.job,'变更待核对报告.md',Buffer.from('# 变更待核对报告\n\n本轮尚未形成可确认事项，不能推断为没有变化。\n\n'+coverageMarkdown(complete)),'document');ctx.job.status='waiting_input';ctx.job.summary='处理记录已交付，尚未形成可确认的变更事项，请查看待处理清单。';return;}
 if(!complete)writeArtifact(ctx.store,ctx.job,'候选与关系核验.json',Buffer.from(JSON.stringify({version:'v7-p1-relations-1',raw,validated:parsed,limit:'未通过引用的原始候选仍保留；字段关系只证明局部支持，不证明整条判断。'},null,2)),'evidence');
 const seenKeys=new Map(),items=[];for(const row of parsed){const identity=digest(Buffer.from(JSON.stringify({title:row.title,status:row.status,basis:row.basis,evidence:row.evidence})));if(seenKeys.has(row.key)){if(seenKeys.get(row.key)===identity)continue;const original=row.key;row.sourceKey=original;row.key=original+'::'+identity.slice(0,12);note(ctx,'同编号的不同子事项已分别保留：'+original);}seenKeys.set(row.key,identity);items.push(row);}
 const covered=new Set(items.flatMap(r=>[...r.basis,...r.evidence].map(x=>x.sourceId)));
 for(const file of ctx.files)if(!covered.has(file.id))warning(ctx,'文件未形成具体核对依据，不能视为已核验：'+file.name);
 const knownIds=[...new Set(ctx.files.flatMap(f=>[...f.content.matchAll(/(?<![A-Za-z0-9])(?:REQ|FB|TASK|COND|DEL)-?\d+(?![A-Za-z0-9])/g)].map(x=>x[0])))];
 const mentioned=items.flatMap(r=>[r.key,r.sourceKey||'',...r.covers,...r.dependsOn]);
 const omitted=knownIds.filter(k=>!mentioned.includes(k));
 if(omitted.length)warning(ctx,'原文事项编号未被逐项覆盖：'+omitted.join('、'));
 const open=items.filter(r=>['needs_clarification','needs_confirmation','missing','conflict','pending','requested','open','unknown','blocked'].includes(r.status));
 const graph=ctx.job.scenarioId==='25'?blockers(items):undefined;
 if(graph?.some(r=>r.roots.some(x=>x.kind!=='pending')))warning(ctx,'依赖存在缺少节点或环，已单列，不能猜测责任人');
 const needsInput=open.length>0||omitted.length>0||!!complete?.coverage.unresolved||!!graph?.some(r=>r.roots.some(x=>x.kind!=='pending'));
 if(complete)writeArtifact(ctx.store,ctx.job,'全文处理范围与待处理项.md',Buffer.from(coverageMarkdown(complete)),'document');
 await deliver(ctx,{scenarioId:scene.id,items,fileCoverage:ctx.files.map(f=>({id:f.id,name:f.name,status:covered.has(f.id)?'cited':'not_cited'})),suggestions:list(raw.suggestions,30).map(x=>text(x)),...(graph?{blockers:graph}:{}),needsInput,
  summary:'已核对'+ctx.files.length+'份材料、'+items.length+'项；'+(needsInput?'有'+(open.length+omitted.length+(complete?.coverage.sourceUnresolved||0))+'项待补充或处理，具体问题和建议已交付。':'本轮已有依据的核对已完成，结果与来源已交付。')});
 if(complete)writeCoverageArtifacts(ctx,complete);
}

function centsOrNull(raw){
 const s=String(raw??'').trim().replace(/[,，￥¥元\s]/g,'');if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))return null;
 const negative=s.startsWith('-'),[a,b='']=s.replace('-','').split('.');return (BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(negative?-1n:1n);
}
const amount=v=>(v<0n?'-':'')+(v<0n?-v:v)/100n+'.'+String((v<0n?-v:v)%100n).padStart(2,'0');
async function table(file,store,sheetName){
 let records;const gaps=[];
 if(file.extension==='.xlsx'){
  const book=new ExcelJS.Workbook();await book.xlsx.load(readOriginal(store,file));const sheet=sheetName?book.getWorksheet(sheetName):book.worksheets[0];if(!sheet)throw Error('需要指定存在的工作表');
  const cell=c=>{if(c.formula&&c.result===undefined){gaps.push(c.address||'');return '';}return c.result??(typeof c.value==='object'&&c.value?.richText?c.value.richText.map(x=>x.text).join(''):c.value)??'';};
  const headers=sheet.getRow(1).values.slice(1).map(String);if(new Set(headers).size!==headers.length||headers.some(h=>!h))throw Error('表头为空或重复，请补充唯一列名');
  records=[];sheet.eachRow((row,n)=>{if(n>1)records.push(Object.fromEntries(headers.map((h,i)=>[h,cell(row.getCell(i+1))])));});
 }else if(file.extension==='.json'){
  const v=JSON.parse(file.content);records=Array.isArray(v)?v:v.records;if(!Array.isArray(records))throw Error('JSON对账需要记录数组或records数组');
 }else if(file.extension==='.csv'){
  const rows=parse(file.content,{bom:true,skip_empty_lines:true}),headers=(rows.shift()||[]).map(h=>String(h).trim());
  if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw Error('需要唯一且非空的CSV表头，不能覆盖同名列');
  records=rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])));
 }
 else throw Error('对账目前支持CSV、JSON记录和XLSX；需要原始明细，不能只用总结数字');
 if(records.length>10000||records.some(r=>!r||Array.isArray(r)||typeof r!=='object'))throw Error('需要每份不超过10000条的有效记录');
 const columns=[...new Set(records.flatMap(r=>Object.keys(r)))];if(!columns.length)throw Error('需要有表头和明细的数据');return {records,columns,gaps};
}
export async function reconcile(ctx){
 requireText(ctx.files);
 const files=ctx.files.filter(f=>['.csv','.json','.xlsx'].includes(f.extension));if(files.length!==2)throw Error('请选择两份CSV、JSON记录或XLSX明细作为对账输入');
 const tables=await Promise.all(files.map(f=>table(f,ctx.store)));tables.forEach((t,i)=>{if(t.gaps.length)note(ctx,files[i].name+' 有公式没有缓存结果，这些格子按空值继续对账');});
 const raw=await ctx.analyze({kind:'work-23',documents:ctx.files.map(f=>({id:f.id,name:f.name,text:f.content})),instruction:'确定两份明细的对应关系。用户目标：'+ctx.job.rules+'。只选择真实表头，keyColumns按相同语义顺序排列。不要计算结果，程序会遍历原始记录。amountColumn可空。filters只在明确要求中出现时使用，basis提供包含列和值的逐字依据。可用列：'+JSON.stringify(tables.map((t,i)=>({sourceId:files[i].id,columns:t.columns}))),shape:'{"left":{"sourceId":"文件id","keyColumns":["原表头"],"amountColumn":"原金额表头或空","filters":[{"column":"原表头","equals":"原文值","basis":{"sourceId":"规则文件id","quote":"同时包含列和值的明确筛选要求"}}]},"right":{"sourceId":"另一个文件id","keyColumns":["对应原表头"],"amountColumn":"金额列或空","filters":[]}}'});
 const plans=[raw.left,raw.right];if(plans.some(p=>!p)||new Set(plans.map(p=>p.sourceId)).size!==2||plans.some(p=>!files.some(f=>f.id===p.sourceId)))throw Error('对账映射必须对应这两份授权明细');
 const prepared=plans.map(p=>{
  const i=files.findIndex(f=>f.id===p.sourceId),t=tables[i],keys=list(p.keyColumns,8);
  if(!keys.length||new Set(keys).size!==keys.length||keys.some(k=>!t.columns.includes(k))||p.amountColumn&&!t.columns.includes(p.amountColumn))throw Error('对账键或金额列不是原始表头');
  const accepted=[];for(const f of list(p.filters,10)){const problems=[],r=refs(f?.basis?[f.basis]:[],ctx.files,problems)[0];if(problems.length||!r||!t.columns.includes(f.column)||!r.quote.includes(f.column)||!r.quote.includes(String(f.equals))){note(ctx,'筛选「'+text(f?.column,40)+'='+text(String(f?.equals??''),40)+'」对不上原文或表头，未按它缩小范围，仍按全量明细对账');continue;}accepted.push(f);}
  const filtered=t.records.filter(r=>accepted.every(f=>String(r[f.column])===String(f.equals))),groups=new Map();let total=0n;const records=[],blankKeys=[],badAmounts=[];
  for(const r of filtered){if(keys.some(k=>r[k]===undefined||r[k]===null||typeof r[k]==='object'||String(r[k]).trim()==='')){blankKeys.push(r);continue;}records.push(r);const key=JSON.stringify(keys.map(k=>String(r[k]).trim()));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);if(p.amountColumn){const cents=centsOrNull(r[p.amountColumn]);if(cents===null)badAmounts.push(String(r[p.amountColumn]??'').slice(0,20));else total+=cents;}}
  if(blankKeys.length)note(ctx,files[i].name+' 有'+blankKeys.length+'行对账键是空的，已跳过这些行，其余行继续对账');
  if(badAmounts.length)note(ctx,files[i].name+' 有金额读不出来，未计入合计：'+[...new Set(badAmounts)].slice(0,5).join('、'));
  return {file:files[i],plan:p,columns:t.columns,records,groups,total:p.amountColumn?amount(total):null};
 });
 if(prepared[0].plan.keyColumns.length!==prepared[1].plan.keyColumns.length)throw Error('两侧对账键数量不一致');
 if(Boolean(prepared[0].plan.amountColumn)!==Boolean(prepared[1].plan.amountColumn))throw Error('金额对账需要两侧均指定金额列，或均不指定');
 const currencies=new Set(prepared.flatMap(p=>p.records.flatMap(r=>p.columns.filter(c=>/^(?:币种|currency)$/i.test(c)).map(c=>String(r[c]||'').trim()).filter(Boolean))));
 if(prepared[0].plan.amountColumn&&currencies.size>1){note(ctx,'明细里有多种币种，没有合并成一个合计，请按币种分别看');for(const side of prepared)side.total=null;}
 const [left,right]=prepared,differences=[],duplicates=[];
 for(const side of prepared)for(const [key,rows]of side.groups)if(rows.length>1)duplicates.push({sourceId:side.file.id,key,rows});
 for(const key of new Set([...left.groups.keys(),...right.groups.keys()])){
  const a=left.groups.get(key)||[],b=right.groups.get(key)||[];
  if(!a.length||!b.length)differences.push({key,type:a.length?'left_only':'right_only',left:a,right:b});
  else if(a.length===1&&b.length===1){
   const fields=left.columns.filter(c=>right.columns.includes(c)&&!left.plan.keyColumns.includes(c)&&!right.plan.keyColumns.includes(c)&&c!==left.plan.amountColumn&&c!==right.plan.amountColumn).filter(c=>String(a[0][c]??'')!==String(b[0][c]??''));
   const leftCents=centsOrNull(a[0][left.plan.amountColumn]),rightCents=centsOrNull(b[0][right.plan.amountColumn]);const money=!!left.plan.amountColumn&&(leftCents===null||rightCents===null||leftCents!==rightCents);
   if(money||fields.length)differences.push({key,type:money?'amount_mismatch':'field_mismatch',fields,left:a,right:b});
  }
 }
 const metrics={leftRows:left.records.length,rightRows:right.records.length,rowDifference:left.records.length-right.records.length,leftUnique:left.groups.size,rightUnique:right.groups.size,leftTotal:left.total,rightTotal:right.total,amountDifference:left.total!==null&&right.total!==null?amount(centsOrNull(left.total)-centsOrNull(right.total)):null};
 const quote=f=>({sourceId:f.id,name:f.name,quote:f.content.slice(0,1500),line:1});
 const items=differences.map((d,i)=>({key:'difference-'+i,title:d.key,status:'difference',summary:d.type,basis:[quote(left.file)],evidence:[quote(right.file)],owner:'',dueText:'',nextAction:'核对上述原始记录及统计口径；尚未覆盖任一原始数据'}));
 if(!items.length)items.push({key:'reconciliation',title:'原始明细核对',status:duplicates.length?'duplicates':'matched',summary:duplicates.length?'发现重复键，不能视为唯一记录已对齐':'两侧键与选定金额逐条匹配',basis:[quote(left.file)],evidence:[quote(right.file)],owner:'',dueText:'',nextAction:''});
 const summary='已按原始明细计算：左侧'+metrics.leftRows+'条、右侧'+metrics.rightRows+'条；'+differences.length+'项键/金额差异，'+duplicates.length+'组重复键。'+(metrics.leftTotal!==null?'金额合计'+metrics.leftTotal+' / '+metrics.rightTotal+'，差额'+metrics.amountDifference+'。':'');
 await deliver(ctx,{scenarioId:'23',items,metrics,differences,duplicates,mapping:plans,suggestions:[],needsInput:differences.length>0||duplicates.length>0,summary});
 ctx.job.checks.push({label:'记录数、重复、差额与金额按原始行和整数分计算，不采用模型计算数值',passed:true});
}
export const WORK_PROCESSORS=Object.fromEntries(WORK_SCENARIOS.map(s=>[s.id,s.id==='23'?reconcile:businessReview]));
