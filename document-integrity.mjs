import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readOriginal} from './workspace-files.mjs';
import {writeArtifact,resolveArtifact} from './artifacts.mjs';
import {recognizePdfPages} from './intranet-media.mjs';
import {ANALYSIS_VERSION,checkpointHash,analysisIdentity,restoreAnalysis} from './document-continuation.mjs';
import {RecoverySession,validateTaskResume} from './task-recovery.mjs';
import {contentHash} from './reliability.mjs';
import {modelConfigFingerprint} from './inference-config.mjs';
import {documentContext} from './document-context.mjs';
import {recoveryBatches} from './recovery-batches.mjs';
import {runBoundedBatches} from './recovery-queue.mjs';
export const DOCUMENT_VERSION='v7-p1-pages-3';
const digest=v=>createHash('sha256').update(v).digest('hex');
const save=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2));fs.renameSync(temporary,file);};
const allPages=n=>Array.from({length:n},(_,i)=>i+1);
export function coverageState(c){
 if(!Number.isInteger(c.totalPages)||c.totalPages<1)return 'unknown';
 if(c.processedPages.length===0)return 'blocked';
 const pages=new Set(c.processedPages);const missing=allPages(c.totalPages).some(n=>!pages.has(n));
 return missing||c.failedPages.length||c.unprocessedPages.length||c.truncated||c.ocrRequiredPages.some(p=>!c.ocrCompletedPages.includes(p))||c.ocrUnreviewedPages?.length||c.attachments?.length?'partial':'complete';
}
export async function inspectDocument(store,file,{signal,log=()=>{},onCoverage=()=>{},ocr,maxPages=scaledLimit(500),maxCharacters=scaledLimit(2000000),maxOcrRequests=scaledLimit(2)}={}){
 signal?.throwIfAborted();const bytes=readOriginal(store,file),root=path.join(store.directory,'document-pages',file.sha256,DOCUMENT_VERSION),coverage={fileId:file.id,fileName:file.name,sha256:file.sha256,version:DOCUMENT_VERSION,totalPages:null,processedPages:[],failedPages:[],unprocessedPages:[],parsedCharacters:0,truncated:false,ocrRequiredPages:[],ocrCompletedPages:[],ocrFailedPages:[],ocrUnreviewedPages:[],attachments:[],status:'unknown',pages:[],visualLayoutVerified:false,limit:'页面处理记录不等于OCR文字正确或图表、批注、删除线均已核清。'};
 const pages=[];
 coverage.ocrRequests=[];coverage.ocrUnprocessedPages=[];
 // Hash-verified native page caches need no rewrite. Batch progress persistence,
 // while retaining every page receipt and flushing even when traversal aborts.
 const pendingCachedPages=[];
 const flushCachedPages=()=>{if(!pendingCachedPages.length)return;const checked=[...pendingCachedPages];pendingCachedPages.length=0;coverage.status=coverageState(coverage);save(path.join(root,'coverage.json'),coverage);onCoverage(coverage);log('parse-cache','已核查并复用分页缓存',file.name+' 第'+checked.join(',')+'页；逐页哈希有效，未重新OCR或解析');};
 const record=p=>{coverage.pages.push({page:p.page,status:p.status,textHash:p.textHash,parser:p.parser,error:p.error||null,characters:p.text?.length||0,cached:!!p.cached,attempts:p.attempts||1,ocrExecuted:p.ocrExecuted??null,ocrRequestAttempted:!!p.ocrRequestAttempted});if(p.cached){pendingCachedPages.push(p.page);if(pendingCachedPages.length>=25)flushCachedPages();return;}save(path.join(root,'page-'+p.page+'.json'),p);flushCachedPages();save(path.join(root,'coverage.json'),coverage);onCoverage(coverage);log('parse','页面处理记录',file.name+' 第'+p.page+'页：'+p.status);};
 if(file.extension!=='.pdf'){
  let text=file.content||'',truncated=!!file.truncated;
  if(['.txt','.md','.json','.csv','.log','.eml'].includes(file.extension)){try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/g,'\n');if(text.includes('\u0000'))throw Error('binary text');truncated=false;}catch{truncated=true;}}
  if(file.extension==='.docx'){try{const mammoth=await import('mammoth');text=(await mammoth.extractRawText({buffer:bytes},{externalFileAccess:false})).value;truncated=false;}catch{truncated=true;}}
  if(text.length>maxCharacters){text=text.slice(0,maxCharacters);truncated=true;}
  coverage.totalPages=1;coverage.parsedCharacters=text.length;coverage.truncated=truncated;
  if(text&&!truncated){coverage.processedPages=[1];pages.push({page:1,text,parser:'original-text',status:'parsed',textHash:digest(text)});}else{coverage.failedPages=[1];coverage.pages=[{page:1,status:'failed',error:file.parseError||'没有完整可读正文'}];}
  coverage.status=coverageState(coverage);save(path.join(root,'coverage.json'),coverage);return {coverage,pages};
 }
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,stopAtErrors:true});
 try{
  const pdf=await loading.promise;coverage.totalPages=pdf.numPages;onCoverage(coverage);
  const attachments=await pdf.getAttachments();coverage.attachments=Object.entries(attachments||{}).map(([name,a])=>({name,sha256:digest(a.content),bytes:a.content.length,status:'not_inspected'}));
  for(let page=1;page<=Math.min(pdf.numPages,maxPages);page++){
   signal?.throwIfAborted();let p;const cache=path.join(root,'page-'+page+'.json');
   try{const old=JSON.parse(fs.readFileSync(cache,'utf8'));if(old.version===DOCUMENT_VERSION&&old.sha256===file.sha256&&old.textHash===digest(old.text||'')&&old.status==='parsed'&&!old.ocrExecuted)p={...old,cached:true};}catch{}
   if(!p){let error;
    for(let attempt=1;attempt<=2;attempt++)try{
     const pdfPage=await pdf.getPage(page),text=await pdfPage.getTextContent(),content=text.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('').replace(/\r\n/g,'\n').trim();
     p={version:DOCUMENT_VERSION,sha256:file.sha256,page,text:content,textHash:digest(content),status:content.replace(/\s/g,'').length>=20?'parsed':'needs_ocr',parser:'pdfjs-text-page',attempts:attempt};pdfPage.cleanup();error=null;break;
    }catch(e){error=e;}
    if(!p)p={version:DOCUMENT_VERSION,sha256:file.sha256,page,text:'',textHash:digest(''),status:'failed',parser:'pdfjs-text-page',error:String(error?.message||'page parse failed'),attempts:2};
   }
   if(p.status!=='parsed')coverage.ocrRequiredPages.push(page);
   if(coverage.parsedCharacters+(p.text?.length||0)>maxCharacters){coverage.truncated=true;coverage.unprocessedPages.push(...allPages(pdf.numPages).filter(n=>n>=page));break;}
   if(p.status==='parsed'){coverage.processedPages.push(page);coverage.parsedCharacters+=p.text.length;pages.push(p);}else coverage.failedPages.push(page);
   record(p);
  }
  for(const n of allPages(pdf.numPages))if(!coverage.processedPages.includes(n)&&!coverage.failedPages.includes(n)&&!coverage.unprocessedPages.includes(n))coverage.unprocessedPages.push(n);
  if(coverage.ocrRequiredPages.length&&ocr){
   // Batch ranges are bounded; each returned page_idx must independently map
   // to the requested page. No undocumented relative-index correction.
   const ranges=[];for(const page of coverage.ocrRequiredPages){const last=ranges.at(-1);if(last&&page===last.at(-1)+1&&last.length<10)last.push(page);else ranges.push([page]);}
   for(const request of ranges){signal?.throwIfAborted();let result;
    if(coverage.ocrRequests.length>=maxOcrRequests){coverage.ocrUnprocessedPages.push(...request);coverage.limit+=' OCR请求预算耗尽，未请求页明确保留。';onCoverage(coverage);continue;}
    const receipt={pages:request,startedAt:new Date().toISOString(),status:'requested'};coverage.ocrRequests.push(receipt);onCoverage(coverage);
    try{result=await ocr(file,request,signal,log);}catch(error){result={pages:[],error:String(error.message)};}
    Object.assign(receipt,{finishedAt:new Date().toISOString(),status:result.error?'failed':'returned',model:result.model||'not_recorded',remoteTaskId:result.remoteTaskId||null,localCallId:result.localCallId||null,error:result.error||null});
    for(const page of request){const value=result.pages?.find(p=>p.page===page);if(value?.text?.trim()){
      const p={version:DOCUMENT_VERSION,sha256:file.sha256,page,text:value.text,textHash:digest(value.text),status:'ocr_unreviewed',parser:result.model||'intranet-ocr',ocrExecuted:true,ocrRequestAttempted:true,remoteTaskId:result.remoteTaskId||null,attempts:1};
      if(coverage.parsedCharacters+p.text.length>maxCharacters){coverage.truncated=true;coverage.ocrFailedPages.push(page);record({...p,text:'',status:'failed',error:'OCR字符预算耗尽'});continue;}
      pages.push(p);coverage.parsedCharacters+=p.text.length;coverage.processedPages.push(page);coverage.failedPages=coverage.failedPages.filter(n=>n!==page);coverage.ocrCompletedPages.push(page);coverage.ocrUnreviewedPages.push(page);record(p);
     }else{coverage.ocrFailedPages.push(page);record({version:DOCUMENT_VERSION,sha256:file.sha256,page,text:'',textHash:digest(''),status:'failed',parser:result.model||'intranet-ocr',ocrExecuted:result.executed??null,ocrRequestAttempted:true,error:result.error||'OCR未返回带有效页码的文字；不能确认空白页或完整页'});}
    }
   }
  }
 }catch(error){if(signal?.aborted)throw error;coverage.error=String(error.message);coverage.status='blocked';}
 finally{try{flushCachedPages();if(signal?.aborted){coverage.unprocessedPages=[...new Set([...coverage.unprocessedPages,...allPages(coverage.totalPages).filter(n=>!coverage.processedPages.includes(n)&&!coverage.failedPages.includes(n))])].sort((a,b)=>a-b);coverage.status=coverageState(coverage);save(path.join(root,'coverage.json'),coverage);onCoverage(coverage);}}finally{await loading.destroy();}}
 coverage.processedPages=[...new Set(coverage.processedPages)].sort((a,b)=>a-b);coverage.status=coverageState(coverage);save(path.join(root,'coverage.json'),coverage);
 return {coverage,pages:pages.sort((a,b)=>a.page-b.page)};
}

export async function prepareDocumentTask(ctx){
 const results=[];ctx.job.documentCoverage=[];for(const file of ctx.files)results.push(await inspectDocument(ctx.store,file,{signal:ctx.signal,log:ctx.log,onCoverage:coverage=>{const i=ctx.job.documentCoverage.findIndex(c=>c.fileId===file.id);if(i<0)ctx.job.documentCoverage.push(coverage);else ctx.job.documentCoverage[i]=coverage;ctx.store.save();},ocr:(f,pages,signal,log)=>recognizePdfPages(ctx.store,ctx.harness.directory,f,pages,signal,log)}));
 const coverage=results.map(r=>r.coverage);ctx.job.documentCoverage=coverage;
 writeArtifact(ctx.store,ctx.job,'分页原文与OCR草稿.json',Buffer.from(JSON.stringify({version:DOCUMENT_VERSION,documents:results,reviewRequired:'OCR页未经原件核对，不能当已确认文字。可下载逐页对照后上传已核对文字稿重新交办。'},null,2)),'evidence');
 const artifact=writeArtifact(ctx.store,ctx.job,'文档完整性清单.json',Buffer.from(JSON.stringify({version:DOCUMENT_VERSION,documents:coverage},null,2)),'evidence');
 const loaded=JSON.parse(resolveArtifact(ctx.store,ctx.job.id,artifact.id).bytes);if(JSON.stringify(loaded.documents)!==JSON.stringify(coverage))throw Error('文档完整性清单回读失败');
 ctx.job.checks.push({label:'原件分页覆盖清单已保存并回读',passed:true});
 return results;
}

export async function documentRequirements(ctx){
 const documents=await prepareDocumentTask(ctx),units=[];let number=0;
 for(const d of documents)for(const p of d.pages)for(let from=0;from<p.text.length;from+=1400){const text=p.text.slice(from,from+1400);units.push({id:'D'+(++number),sourceId:d.coverage.fileId,page:p.page,start:from,end:from+text.length,text});}
 const issues=[],items=[],dispositions=[],receipts=[];let calls=0;
 const identity=analysisIdentity(ctx.job,ctx.files,units,ctx.harness),resumed=restoreAnalysis(ctx.store,ctx.job,identity,units),history=resumed?.history||[];
 if(resumed){issues.push(...resumed.issues);items.push(...resumed.items);dispositions.push(...resumed.dispositions);ctx.log?.('checkpoint','从已验证检查点继续',resumed.parent.taskId+'；沿用'+resumed.parent.processedUnits+'个处置记录，语义结论仍待核');}
 const requiredComplete=documents.every(d=>d.coverage.status==='complete');
 if(!requiredComplete)issues.push({reason:'input_incomplete',detail:'来源页面、OCR核对、附件或截断未完成，禁止声明全文完成。'});
 // OCR requires a real comparison/confirmation. Do not silently feed an
 // unreviewed OCR draft into the business model as confirmed source text.
 const handledPreviously=new Set(dispositions.map(d=>d.unitId));
 const allReadable=units.filter(u=>!documents.find(d=>d.coverage.fileId===u.sourceId).coverage.ocrUnreviewedPages.includes(u.page));
 const readable=allReadable.filter(u=>!handledPreviously.has(u.id));
 for(const d of dispositions)d.pass||='extract';
 const previous=ctx.job.options?.documentResumeFrom?validateTaskResume(ctx.store,{scenarioId:'21',from:ctx.job.options.documentResumeFrom,conversationId:ctx.job.conversationId,rules:ctx.job.rules,files:ctx.job.dataScope||ctx.files,currentTaskId:ctx.job.id}):null;
 const p2=ctx.job.options?.executionRecoveryVersion==='v7-p2',duplicateCandidates=[],recoveryIdentity={scopeHash:contentHash({rules:ctx.job.rules||'',files:ctx.files.map(f=>({id:f.id,sha256:f.sha256}))}),unitsHash:contentHash(units),modelConfigFingerprint:modelConfigFingerprint(ctx.harness?.modelStatus?.()||{}),promptVersions:{extract:ANALYSIS_VERSION+'|baseline-extract',audit:ANALYSIS_VERSION+'|independent-rediscovery'}};
 const priorCalls=[...history.flatMap(h=>h.receipts||[]),...receipts];
 const session=new RecoverySession({store:ctx.store,job:ctx.job,units,phases:p2?['extract','audit']:['extract'],identity:recoveryIdentity,previous,payload:{items,issues,receipts,dispositions,duplicateCandidates},adopted:{dispositions,receipts:priorCalls,analysisCalls:priorCalls.length,providerRequests:priorCalls.length,wallMs:previous?Date.parse(previous.finishedAt)-Date.parse(previous.startedAt):0,rounds:history.length},blockedUnitIds:units.filter(u=>!allReadable.some(r=>r.id===u.id)).map(u=>u.id)});
 if(session.invalidations.length){const retired=dispositions.filter(d=>session.invalidations.some(i=>i.unitId===d.unitId&&i.phase===(d.pass||'extract')));session.payload.retiredDispositions=retired;for(let i=dispositions.length-1;i>=0;i--)if(retired.includes(dispositions[i]))dispositions.splice(i,1);session.save();}
 const persistAnalysis=(error=null)=>{
  session.save();
  const handled=new Set(dispositions.filter(d=>(d.pass||'extract')==='extract').map(d=>d.unitId)),state={version:ANALYSIS_VERSION,identity,history,parent:resumed?.parent||null,taskId:ctx.job.id,at:new Date().toISOString(),calls,totalUnits:units.length,processedUnits:handled.size,remainingUnitIds:units.filter(u=>!handled.has(u.id)).map(u=>u.id),status:error?'interrupted':'checkpoint',reason:error?String(ctx.signal?.reason?.message||error.message):null,items,issues,receipts,dispositions};
  const file=path.join(ctx.store.directory,'document-analysis',ctx.job.id,'checkpoint.json');save(file,state);
  ctx.job.documentAnalysis={version:ANALYSIS_VERSION,checkpointSha256:checkpointHash(fs.readFileSync(file)),parent:resumed?.parent||null,remainingReadableUnitIds:readable.filter(u=>!handled.has(u.id)).map(u=>u.id),calls,totalUnits:state.totalUnits,processedUnits:state.processedUnits,remainingUnitIds:state.remainingUnitIds,reviewedUnits:ctx.job.recovery?.counts.audit||0,status:state.status,reason:state.reason,checkpoint:file};
  ctx.job.summary='已解析分页材料；需求分析处置 '+state.processedUnits+'/'+state.totalUnits+' 片段，剩余 '+state.remainingUnitIds.length+'，候选 '+items.length+' 项均未独立确认。';
  if(ctx.job.status!=='cancelled')writeArtifact(ctx.store,ctx.job,'需求分析检查点-'+String(calls).padStart(2,'0')+'.json',Buffer.from(JSON.stringify(state,null,2)),'evidence');
  ctx.store.save();
 };
 writeArtifact(ctx.store,ctx.job,'分页来源片段清单.json',Buffer.from(JSON.stringify({version:DOCUMENT_VERSION,units},null,2)),'evidence');
 persistAnalysis();
 const batchesFor=pass=>recoveryBatches(allReadable,session,pass,{maxCharacters:scaledLimit(6200),maxUnits:scaledLimit(12)});
 const shape=JSON.stringify({items:[{title:'具体要求',status:'confirmed/needs_clarification',unitIds:['D1'],owner:'',dueText:'',summary:'原文事实与限制'}],dispositions:[{unitIds:['D2'],status:'background/uncertain',reason:'依据'}]});
 async function runTarget(target,pass){
  const todo=new Set(session.remaining(pass));target=target.filter(u=>todo.has(u.id));if(!target.length||!session.canStart())return;
  ctx.signal?.throwIfAborted();if(calls>=16||!session.begin(pass,target.map(u=>u.id)))return;
  calls++;const started=Date.now(),handled=new Set();let failed;
  try{
   const contextReceipt=documentContext(units,p2?target:[],{eligibleUnitIds:allReadable.map(u=>u.id)}),context=contextReceipt.units;
   const raw=await ctx.analyze({kind:pass==='audit'?'work-21-pages-audit':'work-21-pages',documents:[{id:'page-batch',name:'分页材料',text:target.map(u=>'['+u.id+' 文件'+u.sourceId+' 第'+u.page+'页]\n'+u.text).join('\n'),units:[...target,...context],headingContext:contextReceipt.headingCandidates,omittedContextUnitIds:contextReceipt.omittedContextUnitIds,focusIds:target.map(u=>u.id)}],instruction:'从这些正式目标片段逐条提取需求和验收条件。用户目标：'+ctx.job.rules+'。不得由成员推出责任人，不得把发生日期当截止；保留条件、例外、否定和标题范围。引用只用unitIds；没有明确责任或期限留空。每个目标编号均需事项或dispositions处置；只对本批下结论，不宣称全文完成。'+(pass==='audit'?' 独立重新阅读原文，不提供第一遍答案。重点寻找遗漏要求、条件、例外与反例；contextOnly只读上下文不算目标已处置。':''),shape,timeoutMs:PROCESSING_LIMITS.modelTimeoutMs,recoveryRequest:()=>session.reserveProvider()});
   if(!Array.isArray(raw.items)||!Array.isArray(raw.dispositions))throw Error('分页模型输出缺少items或dispositions');
   const allowed=new Map([...target,...context].map(u=>[u.id,u])),targetIds=new Set(target.map(u=>u.id));
   for(const [i,row]of raw.items.entries()){
    const refs=Array.isArray(row?.unitIds)?row.unitIds:[],valid=refs.length&&refs.every(id=>allowed.has(id))&&refs.some(id=>targetIds.has(id));
    if(!valid||typeof row.title!=='string'||!row.title.trim()){issues.push({reason:'citation_invalid',pass,batch:calls,index:i,raw:row});continue;}
    const evidence=refs.map(id=>allowed.get(id)),signature=digest(JSON.stringify({refs,row}));
    let key='REQ-'+digest(JSON.stringify({refs,title:row.title})).slice(0,16);
    const identical=items.find(item=>JSON.stringify(item.raw)===JSON.stringify(row)&&JSON.stringify(item.basis.map(r=>r.unitId))===JSON.stringify(refs));
    if(identical){key=identical.key;duplicateCandidates.push({pass,raw:row,duplicateOf:key,sourceUnitIds:refs});}
    else{
     if(items.some(item=>item.key===key))key+='::'+signature.slice(0,12);
     const item={key,title:row.title,status:'needs_confirmation',modelStatus:row.status,summary:typeof row.summary==='string'?row.summary:'',owner:'',dueText:'',basis:evidence.map(u=>({sourceId:u.sourceId,unitId:u.id,page:u.page,quote:u.text})),raw:row,extractionPass:pass,verification:'source_supported_requires_semantic_review'};
     items.push(item);issues.push({reason:'semantic_review',key:item.key,detail:'模型提取待核；责任人、日期角色、条件与范围尚未独立证明'});
    }
    for(const id of refs)if(targetIds.has(id)){handled.add(id);dispositions.push({unitId:id,pass,status:'item',key});}
   }
   for(const d of raw.dispositions)if(['background','uncertain'].includes(d.status)&&typeof d.reason==='string'&&d.reason.trim())for(const id of Array.isArray(d.unitIds)?d.unitIds:[])if(targetIds.has(id)){handled.add(id);dispositions.push({unitId:id,pass,status:d.status,reason:d.reason});if(d.status==='uncertain')issues.push({reason:'uncertain_disposition',pass,unitId:id,detail:d.reason});}
   receipts.push({call:calls,pass,modelCallId:raw.__auditId||'not_recorded',unitIds:target.map(u=>u.id),raw,elapsedMs:Date.now()-started,status:'succeeded'});
  }catch(error){failed=error;issues.push({reason:'model_failure',pass,unitIds:target.map(u=>u.id),detail:error.message});receipts.push({call:calls,pass,unitIds:target.map(u=>u.id),error:error.message,elapsedMs:Date.now()-started,status:'failed'});}
  session.finish(pass,target.map(u=>u.id),[...handled],{error:failed,candidates:items});persistAnalysis(failed);
  if(failed&&ctx.signal?.aborted&&ctx.signal.reason?.code!=='WORKSPACE_TIMEOUT')throw failed;
 }
 for(const pass of (p2?['extract','audit']:['extract'])){const failures=await runBoundedBatches(batchesFor(pass),target=>runTarget(target,pass),{concurrency:p2?2:1,canStart:()=>session.canStart(),signal:ctx.signal});const failed=failures.find(error=>!(ctx.signal?.reason?.code==='WORKSPACE_TIMEOUT'&&error===ctx.signal.reason));if(failed)throw failed;}
 session.save();

 if(ctx.signal?.reason?.code==='WORKSPACE_TIMEOUT')ctx.job.executionStopReason='timeout';
 const missing=units.filter(u=>!dispositions.some(d=>d.unitId===u.id&&(d.pass||'extract')==='extract'));for(const u of missing)issues.push({reason:'unit_unprocessed',unitId:u.id,sourceId:u.sourceId,page:u.page});
 const auditMissingUnitIds=p2?session.units.filter(u=>u.stages.audit.status!=='done').map(u=>u.sourceUnitId):[];for(const unitId of auditMissingUnitIds)issues.push({reason:'audit_unprocessed',unitId,detail:'规定的独立复核尚未登记完成'});
 if(!items.length)issues.push({reason:'negative_result_unverified',detail:'模型未提取任何要求不证明材料没有要求；应保留人工确认。'});
 const citationProofs=items.map(item=>{const valid=item.basis.every(ref=>{const unit=units.find(u=>u.id===ref.unitId);return unit&&unit.sourceId===ref.sourceId&&unit.page===ref.page&&unit.text===ref.quote;});if(!valid)throw Error('分页最终候选引用回读不一致');return {id:'VC-'+contentHash({key:item.key,basis:item.basis}).slice(0,20),itemKey:item.key,unitIds:item.basis.map(r=>r.unitId),status:'citation_validity_only',claimValidity:'not_verified'};});
 session.payload.citationProofs=citationProofs;
 for(const unit of session.units)unit.verificationIds=citationProofs.filter(p=>p.unitIds.includes(unit.sourceUnitId)).map(p=>p.id);
 session.save();
 writeArtifact(ctx.store,ctx.job,'分页引用核验.json',Buffer.from(JSON.stringify(citationProofs,null,2)),'evidence');
 const result={version:DOCUMENT_VERSION,analysisVersion:ANALYSIS_VERSION,citationProofs,auditMissingUnitIds,deliveryMode:ctx.job.executionStopReason==='timeout'?'partial_after_time_budget':'normal_window',reviewedUnits:ctx.job.recovery?.counts.audit||0,recovery:ctx.job.recovery,duplicateCandidates,history,parent:resumed?.parent||null,scenarioId:'21',items,issues,documents:ctx.job.documentCoverage,sourceUnits:units.length,processedUnits:units.length-missing.length,calls,receipts,dispositions,needsInput:issues.length>0,inputComplete:requiredComplete,limit:'按页解析覆盖、模型处置、语义正确性分开记录。未独立核验的要求保留待确认。'};
 const markdown='# 需求澄清与验收标准\n\n输入完整性：'+(requiredComplete?'所有登记页面已解析；图像版式未验证':'未通过')+'；提取处置 '+result.processedUnits+'/'+units.length+'；独立复核 '+result.reviewedUnits+'/'+units.length+'；待核记录 '+issues.length+'。\n\n'+result.limit+'\n\n'+items.map(i=>'## '+i.title+' ['+i.status+']\n\n事项ID：'+i.key+'\n\n'+i.summary+'\n\n'+i.basis.map(r=>'依据：'+r.sourceId+' 第'+r.page+'页 '+r.unitId+'\n> '+r.quote).join('\n')).join('\n\n')+'\n\n## 未解决记录\n\n'+issues.map(i=>'- '+JSON.stringify(i)).join('\n');
 const json=writeArtifact(ctx.store,ctx.job,'需求澄清与验收标准-结构化结果.json',Buffer.from(JSON.stringify(result,null,2)),'evidence'),md=writeArtifact(ctx.store,ctx.job,'需求澄清与验收标准.md',Buffer.from(markdown),'document');
 const back=JSON.parse(resolveArtifact(ctx.store,ctx.job.id,json.id).bytes);if(JSON.stringify(back)!==JSON.stringify(result)||resolveArtifact(ctx.store,ctx.job.id,md.id).bytes.toString()!==markdown)throw Error('21交付回读失败');
 ctx.job.workResult={...result,receipts:undefined,dispositions:undefined};ctx.job.documentVerification={quality:requiredComplete&&!issues.length?'complete_verified':items.length?'partial':'blocked',inputComplete:requiredComplete,processedUnits:result.processedUnits,reviewedUnits:result.reviewedUnits,totalUnits:units.length,deliveryVerified:true,openIssues:issues.length};
 ctx.job.status=items.length?'partial':'waiting_input';ctx.job.summary='已分页检查'+documents.length+'份材料、'+ctx.job.documentCoverage.reduce((n,c)=>n+c.processedPages.length,0)+'页；分析处置'+result.processedUnits+'/'+units.length+'片段，保留'+issues.length+'条待核。';
 ctx.job.checks.push({label:'21输入页面、片段处置、未解决清单与交付回读已分别登记',passed:true});
 if(!requiredComplete)ctx.job.warnings.push('全文输入完整性未通过，失败页/OCR待核/附件均见文档完整性清单。');
}
