import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {writeArtifact,resolveArtifact} from '../documents/artifacts.mjs';

export const RELIABILITY_VERSION='v7-p0-1';
export const canonical=value=>JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const contentHash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
export function candidateSchemaIssues(raw){const issues=[];if(typeof raw.title!=='string'||!raw.title.trim())issues.push('事项标题缺失或类型不正确');for(const key of ['key','status','owner','dueText','summary','nextAction'])if(raw[key]!==undefined&&typeof raw[key]!=='string')issues.push('字段类型不正确：'+key);for(const key of ['dependsOn','covers'])if(raw[key]!==undefined&&(!Array.isArray(raw[key])||raw[key].some(v=>typeof v!=='string')))issues.push('编号列表类型不正确：'+key);for(const key of ['programComparison','verification','candidateId'])if(raw[key]!==undefined)issues.push('模型不得设置程序核验字段：'+key);return issues;}
export function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);}catch(error){if(fd!==undefined)fs.closeSync(fd);throw error;}}
const managed=job=>['08','24','21'].includes(job.scenarioId);
function folder(store,job){if(!/^[A-Za-z0-9_-]{1,100}$/.test(job.id))throw Error('任务标识不合法');return path.join(store.directory,'reliability',job.id);}
const modelName=harness=>harness?.modelStatus?.()?.modelName||'unknown';
function scopeContent(job,files){return {version:RELIABILITY_VERSION,scenarioId:job.scenarioId,rules:job.rules||'',options:job.options||{},files:files.map(f=>({id:f.id,name:f.name,sha256:f.sha256,textSha256:contentHash(f.content||''),parseStatus:f.parseStatus||'ready',truncated:!!f.truncated}))};}
export function beginVerification(store,job,files,harness){
  if(!managed(job))return;
  if(job.scenarioId==='21'&&!files.some(f=>f.extension==='.pdf'||f.truncated||!f.content||f.content.length>60000))return;
  const snapshot=scopeContent(job,files),scopeHash=contentHash(snapshot);
  const comparisonMode=job.scenarioId==='21'?'not_applicable':job.options?.comparisonMode||(/更正公告|补充公告/.test(job.rules||'')?'amendment':'unknown');
  job.reliability={runtimeBuild:harness?.runtimeBuild||null,version:RELIABILITY_VERSION,scopeHash,comparisonMode,runId:randomUUID(),modelName:modelName(harness),analysisMode:harness?.modelStatus?.()?.analysisMode||'native-tools',cacheNamespace:job.id,
    quality:'not_evaluated',execution:'running',snapshot,analysisSessions:0,providerRequests:0,maxProviderRequests:scaledLimit(80),modelCalls:[],gates:[],issues:[],deliveryExpectation:null};
  atomicJson(path.join(folder(store,job),'scope.json'),{scopeHash,comparisonMode,...snapshot});
  reliabilityEvent(store,job,'scope_frozen',{scopeHash,comparisonMode});
}
export function reliabilityEvent(store,job,type,data={}){if(!job.reliability)return;const record={taskId:job.id,runId:job.reliability.runId,type,at:new Date().toISOString(),...data};const root=folder(store,job);fs.mkdirSync(root,{recursive:true});fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify(record)+'\n');}
export function createAnalysisAudit(store,job,args){
  if(!job.reliability)return undefined;
  const r=job.reliability,id=randomUUID();r.analysisSessions++;
  const documentHash=contentHash(args.documents||[]),record={id,taskId:job.id,runId:r.runId,kind:args.kind,inputHash:documentHash,inputCharacters:(args.documents||[]).reduce((n,d)=>n+String(d.text||'').length,0),promptHash:contentHash({instruction:args.instruction,shape:args.shape}),targetUnitIds:(args.documents||[]).flatMap(d=>d.focusIds||[]),contextUnitIds:(args.documents||[]).flatMap(d=>(d.units||[]).filter(u=>u.contextOnly).map(u=>u.id)),inputTokens:null,outputTokens:null,requests:[],status:'running',startedAt:new Date().toISOString()};
  const root=folder(store,job);atomicJson(path.join(root,'calls',id+'-input.json'),{documents:args.documents,instruction:args.instruction,shape:args.shape});
  const save=()=>atomicJson(path.join(root,'calls',id+'.json'),record);
  r.modelCalls.push({id,kind:args.kind,status:'running'});save();reliabilityEvent(store,job,'analysis_started',{callId:id,kind:args.kind,inputHash:documentHash});
  return {id,configuration(value){record.inference=value;save();},response(value){record.response=value;save();},protocol(value){record.adapterProtocol=value;save();},beforeRequest(){args.recoveryRequest?.();if(r.providerRequests>=r.maxProviderRequests){const e=Error('真实模型请求预算耗尽，尚未完成的检查已保留');e.code='PROVIDER_BUDGET';throw e;}const requestId=randomUUID();r.providerRequests++;record.requests.push({id:requestId,ordinal:r.providerRequests,at:new Date().toISOString()});save();reliabilityEvent(store,job,'provider_request_reserved',{callId:id,requestId,ordinal:r.providerRequests});},
    submitted(raw){atomicJson(path.join(root,'calls',id+'-parsed.json'),raw);record.parsedArtifact=id+'-parsed.json';save();},
    session(receipt){record.harnessSession=receipt;save();},
    finish(error){record.status=error?'failed':'succeeded';record.finishedAt=new Date().toISOString();if(error)record.error={code:error.code||'ANALYSIS_FAILED',message:String(error.message).slice(0,800)};r.modelCalls.find(c=>c.id===id).status=record.status;save();reliabilityEvent(store,job,'analysis_finished',{callId:id,status:record.status,errorCode:record.error?.code||null});}};
}
export function renderReliabilityItems(items){return items.map(item=>{
  const marker=contentHash(String(item.key));
  const transition=item.programComparison;
  const lines=[`<!-- v7-item:${marker}:start -->`,`## ${item.title}`,`事项ID：${item.key}`,`状态：${item.status}`,`核验类型：${item.verification==='program_text_transition'?'程序核对明确前后文字；不等于业务影响已确认':'模型解释，仍需确认'}`,item.summary||''];
  for(const [field,label]of [['owner','负责人'],['dueText','期限'],['acceptance','验收条件'],['limit','限制'],['nextAction','下一步建议']])if(item[field])lines.push(`${label}：${item[field]}`);
  if(item.dependsOn?.length)lines.push('依赖：'+item.dependsOn.join('、'));
  if(item.covers?.length)lines.push('覆盖编号：'+item.covers.join('、'));
  if(transition){lines.push('原文：',...(transition.removed||[]).map(u=>u.text),'调整后：',...(transition.added||[]).map(u=>u.text));}
  for(const ref of [...(item.basis||[]),...(item.evidence||[])])lines.push(`依据：${ref.name} 第${ref.line}行`,ref.quote);
  lines.push(`<!-- v7-item:${marker}:end -->`);return lines.join('\n\n');
}).join('\n\n');}
export function expectDelivery(job,{items,structuredName,markdownName,markdown,sheets=[]},store){if(!job.reliability)return;job.reliability.deliveryExpectation={itemHash:contentHash(items),itemIds:items.map(i=>i.key),structuredName,markdownName,markdownHash:contentHash(markdown),sheets,expectedItemBlocks:items.map(i=>contentHash(String(i.key)))};if(store)atomicJson(path.join(folder(store,job),'delivery-expectation.json'),job.reliability.deliveryExpectation);}
export function evaluateQuality({gates,openIssues=0,usable=false,cancelled=false,fatal=false}){
  if(cancelled)return 'cancelled';if(fatal)return 'failed';
  const required=['scope_integrity','source_disposition','candidate_conservation','claim_boundary','delivery_integrity','requested_formats'];
  const missing=required.some(id=>gates.find(g=>g.id===id)?.outcome!=='pass');
  if(missing)return usable?'partial':'blocked';
  return openIssues?'partial':'complete_verified';
}
export function candidateConservation(ledger,formalKeys){
  if(!ledger||!Array.isArray(ledger.candidates)||!Array.isArray(ledger.candidateDispositions))return false;
  const byId=new Map(ledger.candidates.map(c=>[c.id,c]));if(byId.size!==ledger.candidates.length)return false;
  const dispositions=ledger.candidateDispositions;if(dispositions.length!==byId.size)return false;
  function reaches(id,visited=new Set()){
    if(visited.has(id)||!byId.has(id))return false;visited.add(id);
    const rows=dispositions.filter(d=>d.candidateId===id);if(rows.length!==1)return false;const d=rows[0];
    if(d.disposition==='formal')return formalKeys.includes(d.formalKey);
    if(d.disposition==='duplicate')return reaches(d.duplicateOf,visited);
    if(d.disposition==='repaired')return reaches(d.repairedBy,visited);
    if(d.disposition==='quarantined')return !!byId.get(id).issues?.length&&ledger.unresolved.some(i=>i.candidateId===id);
    return false;
  }
  return [...byId.keys()].every(id=>reaches(id));
}
export async function finishVerification(store,job,files,{error=null,cancelled=false}={}){
  const r=job.reliability;if(!r)return;
  if(job.scenarioId==='21'){
    const inputUnchanged=contentHash(scopeContent(job,files))===r.scopeHash;
    r.quality=cancelled?'cancelled':!inputUnchanged?'failed':job.documentVerification?.quality||'partial';r.execution=cancelled?'cancelled':error?'interrupted':'finished';
    r.gates=[{id:'scope_integrity',outcome:inputUnchanged?'pass':'fail',reason:'输入原件及原始预览保持冻结；分页派生正文独立保存'},{id:'document_completeness',outcome:job.documentVerification?.inputComplete?'pass':'fail',reason:'总页数、页面、OCR核对、附件与截断分别核查'},{id:'unit_disposition',outcome:job.documentVerification?.totalUnits>0&&job.documentVerification.processedUnits===job.documentVerification.totalUnits&&(job.options?.executionRecoveryVersion!=='v7-p2'||job.recovery?.counts.audit===job.documentVerification.totalUnits)?'pass':'fail',reason:'提取目标须有有效处置；P2规定的独立复核也须全部登记，不能只凭输入完整通过'},{id:'delivery_integrity',outcome:job.documentVerification?.deliveryVerified?'pass':'fail',reason:'结构化结果与报告回读'}];
    if(r.quality==='complete_verified'&&r.gates.some(g=>g.outcome!=='pass'))r.quality=job.documentVerification?.deliveryVerified?'partial':'blocked';
    r.issues=[...(job.workResult?.issues||[]),...(error?[{reason:error.message}]:[])];
    const receipt={version:job.options?.executionRecoveryVersion==='v7-p2'?'v7-p2-document-contract-2':'v7-p1-document-contract-1',taskId:job.id,runId:r.runId,quality:r.quality,execution:r.execution,gates:r.gates,issues:r.issues,analysisSessions:r.analysisSessions,providerRequests:r.providerRequests,documentCoverage:job.documentCoverage||[],limit:'页覆盖不证明OCR/图表正确；需求语义尚需独立核验。'};
    atomicJson(path.join(folder(store,job),'verification.json'),receipt);if(!cancelled)writeArtifact(store,job,'V7完成核查.json',Buffer.from(JSON.stringify(receipt,null,2)),'audit');return;
  }
  const gates=[],issues=[],successReasons={scope_integrity:'授权输入、解析文字、规则及选项与冻结快照一致',source_disposition:'已解析片段两遍均有处置记录；不等于语义完整',candidate_conservation:'原始候选均有可追溯的交付、合并、修复或隔离去向',delivery_integrity:'正式JSON、报告与指定Excel字段回读一致',claim_boundary:'程序文字事实匹配回执，模型解释保持待确认',requested_formats:'用户指定格式均在本轮字段级回读范围内'};const gate=(id,pass,reason)=>{gates.push({id,outcome:pass?'pass':'fail',reason:pass?successReasons[id]:reason});if(!pass)issues.push({id,reason,blocking:true});};
  gate('scope_integrity',contentHash(scopeContent(job,files))===r.scopeHash,'授权文件、解析文字、规则或选项在任务期间发生变化');
  const coverage=job.sourceCoverage;
  gate('source_disposition',!!coverage&&coverage.sourceUnits>0&&coverage.extractProcessed===coverage.sourceUnits&&coverage.auditProcessed===coverage.sourceUnits,'至少一遍源片段处置缺失；这项通过也不证明语义完整');
  const a=job.artifacts.find(a=>a.name==='来源覆盖与候选账本.json');let ledger;
  if(a)try{ledger=JSON.parse(resolveArtifact(store,job.id,a.id).bytes);}catch(e){issues.push({id:'ledger_readback',reason:e.message,blocking:true});}
  const expectation=r.deliveryExpectation;let finalItems=[];let deliveryError='未登记预期交付内容';
  gate('candidate_conservation',candidateConservation(ledger,expectation?.itemIds||[]),'原始候选没有可追溯的交付、合并、修复或隔离去向');
  if(expectation)try{
    const find=name=>{const artifact=job.artifacts.find(a=>a.name===name);if(!artifact)throw Error('缺交付物：'+name);return resolveArtifact(store,job.id,artifact.id).bytes;};
    const parsed=JSON.parse(find(expectation.structuredName));finalItems=Array.isArray(parsed)?parsed:parsed.items;
    if(!Array.isArray(finalItems)||contentHash(finalItems)!==expectation.itemHash)throw Error('正式JSON字段或事项集合与预期不一致');
    const markdown=find(expectation.markdownName).toString('utf8');if(contentHash(markdown)!==expectation.markdownHash)throw Error('报告正文回读与预期不一致');
    for(const marker of expectation.expectedItemBlocks)if(markdown.split(`<!-- v7-item:${marker}:start -->`).length!==2||!markdown.includes(`<!-- v7-item:${marker}:end -->`))throw Error('报告事项块缺失或重复');
    for(const sheet of expectation.sheets){const book=new ExcelJS.Workbook();await book.xlsx.load(find(sheet.artifactName));const ws=book.getWorksheet(sheet.name);if(!ws||ws.rowCount!==sheet.rows.length+1)throw Error('Excel差异行数缺失');for(let i=0;i<sheet.rows.length;i++)for(let j=0;j<sheet.rows[i].length;j++)if(String(ws.getCell(i+2,j+1).value??'')!==String(sheet.rows[i][j]??''))throw Error(`Excel字段改变：${sheet.name} ${i+2}/${j+1}`);}
    deliveryError='';
  }catch(e){deliveryError=e.message;}
  gate('delivery_integrity',!deliveryError,deliveryError||'正式JSON、报告及指定Excel字段已回读');
  const checkedFormats=new Set(expectation?[expectation.structuredName,expectation.markdownName,...expectation.sheets.map(s=>s.artifactName)].map(name=>name.split('.').at(-1).toLowerCase()):[]);
  const uncheckedFormats=(job.options?.outputFormats||[]).filter(format=>!checkedFormats.has(format));
  gate('requested_formats',!uncheckedFormats.length,'指定格式尚未接入字段级回读：'+uncheckedFormats.join('、')+'；文件可打开不能代替内容已核查');
  gate('claim_boundary',!!expectation&&!deliveryError&&finalItems.length===expectation.itemIds.length&&finalItems.every(i=>i.verification==='program_text_transition'?(ledger?.programFactProofs||[]).some(p=>p.key===i.key&&p.comparisonHash===contentHash(i.programComparison)):i.status==='needs_confirmation'),'程序事实必须匹配确定性回执；模型解释不得以已确认事实状态交付');
  for(const issue of ledger?.unresolved||[])issues.push({...issue,blocking:true});
  if(error)issues.push({id:'execution_failure',reason:String(error.message),blocking:true});
  if(r.comparisonMode==='unknown')issues.push({id:'comparison_mode',reason:'比较模式未明确；不能据此判断条款删除',blocking:true});
  const fatal=gates.find(g=>g.id==='scope_integrity')?.outcome==='fail'||!!deliveryError&&!!expectation;
  const usable=!!expectation&&!deliveryError;
  r.gates=gates;r.issues=issues;r.execution=cancelled?'cancelled':error?'interrupted':'finished';r.quality=evaluateQuality({gates,openIssues:issues.length,usable,cancelled,fatal});
  r.delivery={itemIds:expectation?.itemIds||[],itemHash:expectation?.itemHash||null,artifacts:job.artifacts.map(a=>({id:a.id,name:a.name,sha256:a.sha256})),verified:usable};
  // Artifact writing itself refuses cancelled jobs. Sidecar receipts remain available.
  const receipt={version:r.version,taskId:job.id,runId:r.runId,scopeHash:r.scopeHash,comparisonMode:r.comparisonMode,quality:r.quality,execution:r.execution,gates,issues,delivery:r.delivery,analysisSessions:r.analysisSessions,providerRequests:r.providerRequests,modelCalls:r.modelCalls,limit:'P0验证只核对来源处置、候选去向与交付字段；不证明语义零遗漏，也未实现P1的Atom/关系/影响验证。'};
  atomicJson(path.join(folder(store,job),'verification.json'),receipt);reliabilityEvent(store,job,'verification_finished',{quality:r.quality,issues:issues.length});
  if(!cancelled){writeArtifact(store,job,'V7完成核查.json',Buffer.from(JSON.stringify(receipt,null,2)),'audit');writeArtifact(store,job,'V7核查结论.md',Buffer.from(`# V7本轮核查\n\n质量状态：${r.quality}\n\n${receipt.limit}\n\n分析会话：${r.analysisSessions}；真实模型请求：${r.providerRequests}\n\n## 必需检查\n\n${gates.map(g=>`- ${g.id}：${g.outcome}；${g.reason}`).join('\n')}\n\n## 尚未核清\n\n${issues.length?issues.map(i=>'- '+(i.reason||i.kind||i.id)).join('\n'):'本轮已登记问题为空；不代表不存在未发现的语义问题。'}`),'audit');
    if(r.quality==='failed')job.status='failed';else if(r.quality==='blocked')job.status='waiting_input';else if(r.quality==='partial'&&job.status==='completed')job.status='partial';
  }
  // Large expectations stay in the immutable sidecar, not repeated in /api/workspace.
  atomicJson(path.join(folder(store,job),'delivery-expectation.json'),expectation);delete r.deliveryExpectation;
}
