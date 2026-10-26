import {scaledLimit,PROCESSING_LIMITS} from './processing-capacity.mjs';
import {taskAttachmentResolution,assertConversationAttachment,bindConversationFiles} from './attachment-context.mjs';
import {ensureHtmlReport} from './presentation.mjs';
import {reimburseBatch,validateInvoiceResume} from './invoice-batch.mjs';
import {POLICY as INVOICE_POLICY} from './invoice-stages.mjs';
import {startSupplement} from './supplement-workspace.mjs';
import {SCENARIOS,STATUS_LABELS} from './scenarios.mjs';
import {id,now} from './core.mjs';
import {addWorkspaceFile,readOriginal,workspaceStorage} from './workspace-files.mjs';
import {importArchive,isArchiveName} from './archives.mjs';
import {isAudioExtension} from './audio-formats.mjs';
import {writeArtifact} from './artifacts.mjs';
import {analyzeTask} from './workflow-ai.mjs';
import {mediaStatus,transcribeIntranet,recognizeIntranet} from './intranet-media.mjs';
import {digest} from './workspace-files.mjs';
import {structureTranscript} from './transcript-post.mjs';
import {ocrForChat as runOcrForChat,lookForChat as runLookForChat} from './document-tools.mjs';
import {meeting,organize,compare,ledger} from './workflow-processors.mjs';
import {LOCAL_PROCESSORS} from './local-scenarios.mjs';
import {WORK_PROCESSORS} from './work-scenario-processors.mjs';
import {deliveryFormats,sourceJobContent,attachDeliverables,validateDelivery} from './file-delivery.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {beginVerification,createAnalysisAudit,finishVerification} from './reliability.mjs';
import {reimburseReliable} from './invoice-reliability.mjs';
import {createInvoiceRuntime} from './invoice-runtime.mjs';
import {validateResumeRequest,executionFailure} from './document-continuation.mjs';
import {validateTaskResume} from './task-recovery.mjs';
import {assertCloudTaskAllowed} from './cloud-policy.mjs';
const processors={...LOCAL_PROCESSORS,...WORK_PROCESSORS,'04':meeting,'07':organize,'08':compare,'09':reimburseReliable,'10':ledger};
export class Workspace {
  constructor(store,harness,options={}){
    this.invoiceRuntimeStatus=options.invoiceRuntimeStatus||(()=>null);this.invoiceRuntimeFactory=options.invoiceRuntimeFactory||(()=>null);this.store=store;this.harness=harness;this.analyze=options.analyze||((args)=>analyzeTask(harness,args));this.transcribe=options.transcribe||((file,signal,log)=>transcribeIntranet(store,harness.directory,file,signal,log));this.recognize=options.recognize||((file,signal,log)=>recognizeIntranet(store,harness.directory,file,signal,log));this.active=new Map();this.recognizing=new Map();
    store.state.workspaceFiles||=[];store.state.jobs||=[];for(const job of store.state.jobs)if(['running','queued'].includes(job.status)){job.status='interrupted';job.error='服务重启，执行中断；已生成结果保留，不自动重做。';job.finishedAt=now();}store.save();
  }
  state(){return {storage:workspaceStorage(this.store),invoiceRuntime:this.invoiceRuntimeStatus(),scenarios:SCENARIOS,statusLabels:STATUS_LABELS,localMedia:mediaStatus(this.harness.directory),recognizing:[...this.recognizing.keys()],recognitionProgress:[...this.recognizing].map(([fileId,controller])=>({fileId,...controller.progress})),files:this.store.state.workspaceFiles.map(({content,recognition,...file})=>({...file,characters:content.length,recognition:recognition?{kind:recognition.kind||'ocr',model:recognition.model,confirmed:!!recognition.confirmedAt,draftHash:recognition.draftHash}:null})),jobs:this.store.state.jobs,active:[...this.active.keys()]};}
  async upload(input){if(input.conversationId&&!this.store.state.conversations?.some(c=>c.id===input.conversationId))throw Error('对话不存在，不能上传附件');const startedAt=now(),start=performance.now(),result=await(isArchiveName(input?.name)?importArchive(this.store,input):addWorkspaceFile(this.store,input));const finishedAt=now(),durationMs=Math.round(performance.now()-start);for(const file of result.files||[result])if(['.pdf','.png','.jpg','.jpeg'].includes(file.extension))file.invoiceIntake={stage:'upload_parse',startedAt,finishedAt,durationMs,fileId:file.id,pageNo:null,requestId:null,success:true,timeoutReason:null,retryCount:0,sharedArchiveUpload:!!result.files};if(input.conversationId)bindConversationFiles(this.store,input.conversationId,result.files||[result],'upload');this.store.save();return result;}
  recognition(fileId){const file=this.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('文件不存在');return {fileId,name:file.name,extension:file.extension,recognition:file.recognition||null};}
  async recognizeFile(fileId,options={}){
    if(this.active.size||this.harness.active.size||this.recognizing.size)throw new Error('助手正在处理上一项请求，请稍候或停止');
    const file=this.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('文件不存在');
    if(file.recognition)return this.recognition(fileId);
    const audio=isAudioExtension(file.extension),provider=options.asrProvider||'intranet';
    if(provider!=='intranet')throw new Error('第三版只调用所列内网识别服务');
    const controller=new AbortController();this.recognizing.set(fileId,controller);
    controller.progress={label:audio?'准备转写录音':'准备识别文字',startedAt:now(),updatedAt:now(),done:null,total:null};
    const log=(type,label,detail='',event={})=>{controller.progress={...controller.progress,label,updatedAt:now(),done:Number.isFinite(event.done)?event.done:null,total:Number.isFinite(event.total)?event.total:null};};
    try{const result=audio?await this.transcribe(file,controller.signal,log,provider):await this.recognize(file,controller.signal,log);if(controller.signal.aborted)throw new Error('识别已取消');readOriginal(this.store,file);const content=audio?structureTranscript(result.content):result.content;if(typeof content!=='string'||!content.trim()||content.length>60000)throw new Error('需要不超过60000字符的有效识别文字');file.recognition={kind:audio?'asr':'ocr',provider:result.provider||'intranet',model:result.model||(audio?'内网 Qwen3-ASR':'内网 MinerU'),device:result.device,segments:result.segments||null,originalSha256:file.sha256,rawText:audio?result.content:undefined,draftText:content,draftHash:digest(Buffer.from(content)),records:result.records||[],recognizedAt:now(),confirmedAt:null};this.store.save();return this.recognition(fileId);}catch(error){if(controller.signal.aborted)throw new Error(this.harness.directory.localMedia?'本地识别已停止，不保存草稿。':'已停止等待，不保存识别草稿；已提交的内网请求可能继续处理。');throw error;}finally{this.recognizing.delete(fileId);}
  }
  async recognizeForChat(fileId,signal=AbortSignal.timeout(180000),log=()=>{}){
    const file=this.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('文件不存在');
    const audio=isAudioExtension(file.extension),visual=['.png','.jpg','.jpeg','.pdf'].includes(file.extension)&&file.parseStatus==='needs_ocr';
    if(!audio&&!visual)throw new Error('这份材料可以直接读取，不需要识别');
    if(file.recognition?.originalSha256===file.sha256&&file.recognition.draftText)return {fileId:file.id,name:file.name,worker:file.recognition.kind==='asr'?'intranet-asr':'intranet-ocr',reviewed:!!file.recognition.confirmedAt,cached:true,text:file.content||file.recognition.draftText,note:file.recognition.confirmedAt?'用户已核对':'未经回听或对照原件，人名和金额需抽查'};
    readOriginal(this.store,file);
    const result=audio?await this.transcribe(file,signal,log,'intranet'):await this.recognize(file,signal,log);
    if(signal.aborted)throw new Error('识别已取消');
    const content=audio?structureTranscript(result.content):result.content;
    if(typeof content!=='string'||!content.trim()||content.length>60000)throw new Error('需要不超过60000字符的有效识别文字');
    file.recognition={kind:audio?'asr':'ocr',provider:result.provider||'intranet',model:result.model||(audio?'内网 Qwen3-ASR':'内网 MinerU'),device:result.device,segments:result.segments||null,originalSha256:file.sha256,rawText:audio?result.content:undefined,draftText:content,draftHash:digest(Buffer.from(content)),records:result.records||[],recognizedAt:now(),confirmedAt:null,dispatchedByChat:true};
    file.content=content;file.contentSource=audio?'聊天交办的内网转写，已按问句做文字后处理，未经回听':'聊天交办的内网文档识别，未经对照原件';this.store.save();
    return {fileId:file.id,name:file.name,worker:audio?'intranet-asr':'intranet-ocr',reviewed:false,cached:false,text:content,note:audio?'这是ASR第一遍，未经回听。27B只标出不确定处，不改这段原文，不补人名。说话人编号来自文字后处理，不是声纹。':'这是OCR的独立一遍，未经对照原件。还要和多模态结果逐项对照：相同才写成确定值，不同就并列原文并标待核对。'};
  }
  ocrForChat(fileId,signal,log){return runOcrForChat(this,fileId,signal,log);}
  lookForChat(fileId,question,signal,log){return runLookForChat(this,fileId,question,signal,log);}
  cancelRecognition(fileId){this.recognizing.get(fileId)?.abort();return {cancelled:true};}
  confirmRecognition(input){
    if(this.active.size||this.harness.active.size||this.recognizing.size)throw new Error('助手正在处理上一项请求，请稍候或停止');
    const file=this.store.state.workspaceFiles.find(f=>f.id===input.fileId),recognition=file?.recognition;if(!recognition||recognition.draftHash!==input.draftHash)throw new Error('识别版本已变化，请重新打开核对');
    const limit=recognition.kind==='asr'?60000:20000;
    if(typeof input.content!=='string'||!input.content.trim()||input.content.length>limit)throw new Error('请核对并填写不超过'+limit+'字符的识别文字');
    readOriginal(this.store,file);if(recognition.originalSha256!==file.sha256)throw new Error('原件版本不一致，请重新识别');
    if(recognition.confirmedTextHash===digest(Buffer.from(input.content)))return {fileId:file.id,confirmed:true};
    if((input.expectedTextHash||null)!==(recognition.confirmedTextHash||null))throw new Error('核对文字已在其他页面更新，请重新打开后合并修改');
    recognition.revisions||=[];if(recognition.revisions.length>=50)throw new Error('核对版本超过50次，请重新上传原件');recognition.revisions.push({previousHash:recognition.confirmedTextHash||null,content:input.content,at:now()});recognition.confirmedAt=now();recognition.confirmedTextHash=digest(Buffer.from(input.content));
    file.content=input.content;file.parseStatus='ready';file.parseError=null;file.truncated=false;file.contentSource=(recognition.kind==='asr'?'ASR':'OCR')+'，经用户核对';this.store.save();return {fileId:file.id,confirmed:true};
  }
  start(input,context={}){
    const scenario=SCENARIOS.find(s=>s.id===input.scenarioId&&s.available);if(!scenario)throw new Error('此场景尚未接入，不能开始执行');
    const parent=context.parentRunId?this.store.state.runs.find(r=>r.id===context.parentRunId&&r.status==='running'&&this.harness.active.has(r.id)):null;
    if(context.parentRunId&&!parent)throw Error('聊天任务上下文已失效');
    if(this.active.size||[...this.harness.active.keys()].some(id=>id!==parent?.id)||this.recognizing.size)throw new Error('助手正在处理上一项请求，请稍候或停止');
    if(!Array.isArray(input.fileIds)||(!input.fileIds.length&&!['01','11','20'].includes(scenario.id))||input.fileIds.length>PROCESSING_LIMITS.attachmentCount||new Set(input.fileIds).size!==input.fileIds.length)throw new Error('请选择1至50个不同文件；简报、周报和内网巡检可不选文件');
    const files=input.fileIds.map(fileId=>{const file=this.store.state.workspaceFiles.find(f=>f.id===fileId);if(!file)throw new Error('所选文件不存在');readOriginal(this.store,file);return file;});
    if(parent?.attachmentResolution)for(const file of files){if(!parent.resolvedFileIds.includes(file.id))throw Error('任务文件不在本轮已解析附件范围内');assertConversationAttachment(this.store,parent.conversationId,file.id);}
    const awaitingReview=f=>(f.recognition&&!f.recognition.confirmedAt)||f.parseStatus==='audio'||f.parseStatus==='needs_ocr',chatUsable=f=>!!(f.recognition?.dispatchedByChat&&f.content);
    if(scenario.id!=='07'&&files.some(f=>awaitingReview(f)&&!(scenario.id==='09'&&['.pdf','.png','.jpg','.jpeg'].includes(f.extension))&&!(scenario.id==='21'&&f.extension==='.pdf')&&!(parent&&chatUsable(f))))throw new Error(parent?'材料尚未识别或核对。请先调用 recognize_attachment 交给内网识别，不要让用户离开对话，也不要生成结果。':'需要先核对并确认录音转写或OCR文字，再开始处理任务');
    if(scenario.id==='08'&&files.length!==2)throw new Error('版本比较需要两份文件，按勾选顺序为旧版、新版');
    const rules=typeof input.rules==='string'?input.rules.trim():'';if(rules.length>scaledLimit(3000))throw new Error('执行规则最多7500字');
    const sourceOptions=input.options&&typeof input.options==='object'?input.options:{};
    if(sourceOptions.asrProvider&&sourceOptions.asrProvider!=='intranet')throw new Error('第三版只调用内网识别服务');
    const options={selfName:String(sourceOptions.selfName||'').slice(0,80),allowAsr:sourceOptions.allowAsr===true,asrProvider:sourceOptions.asrProvider||'intranet',templateId:String(sourceOptions.templateId||''),sheetName:String(sourceOptions.sheetName||'').slice(0,100),headerRow:Number(sourceOptions.headerRow||1),dedupeColumns:String(sourceOptions.dedupeColumns||'').slice(0,500),clipRanges:Array.isArray(sourceOptions.clipRanges)?sourceOptions.clipRanges.slice(0,scaledLimit(12)).map(r=>({start:Number(r.start),end:Number(r.end)})):[],previousJobId:String(sourceOptions.previousJobId||'')};
    if(scenario.id==='09'){options.invoiceResumeFrom=String(sourceOptions.invoiceResumeFrom||'');options.invoiceRetryFileIds=Array.isArray(sourceOptions.invoiceRetryFileIds)?sourceOptions.invoiceRetryFileIds:undefined;options.invoiceRetryPages=sourceOptions.invoiceRetryPages&&typeof sourceOptions.invoiceRetryPages==='object'?sourceOptions.invoiceRetryPages:undefined;}
    options.executionRecoveryVersion=['08','24','21'].includes(scenario.id)?'v7-p2':null;
    options.executionResumeFrom=String(sourceOptions.executionResumeFrom||'');
    if(options.executionResumeFrom)validateTaskResume(this.store,{scenarioId:scenario.id,from:options.executionResumeFrom,conversationId:parent?.conversationId,rules,files});
    if(['08','24','21'].includes(scenario.id))assertCloudTaskAllowed(this.harness,files,rules);
    options.documentResumeFrom=scenario.id==='21'?(options.executionResumeFrom||String(sourceOptions.documentResumeFrom||'')):String(sourceOptions.documentResumeFrom||'');
    if(options.documentResumeFrom)validateResumeRequest(this.store,{scenarioId:scenario.id,from:options.documentResumeFrom,conversationId:parent?.conversationId,rules,files});
    options.outputFormats=deliveryFormats(sourceOptions.outputFormats,rules);
    if(options.previousJobId){const previous=this.store.state.jobs.find(j=>j.id===options.previousJobId);if(!previous?.workResult||previous.scenarioId!==scenario.id||previous.conversationId!==(parent?.conversationId)||['queued','running'].includes(previous.status))throw Error('前次结果不属于当前对话同一场景，或尚未交付');}
    const job={id:id(),scenarioId:scenario.id,title:scenario.title,goal:rules||scenario.description,dataScope:files.map(f=>({id:f.id,name:f.name,sha256:f.sha256})),authorization:'读取选定文件；仅在任务输出目录创建新文件，不覆盖原件；本地提醒默认授权，范围或时间缺失时需补充；不付款、不发送邮件、不写外部系统。',status:'queued',nextTrigger:'立即执行；需要确认或补充时暂停',evidence:[],createdAt:now(),rules,options,trace:[],artifacts:[],checks:[],warnings:[],actions:[],summary:'',error:null};
    job.resolvedFileIds=files.map(f=>f.id);job.attachmentResolution=taskAttachmentResolution(parent,files,parent?'workflow_selected_from_resolved_context':'workspace_explicit_selection');
    if(parent){job.conversationId=parent.conversationId;job.chatRunId=parent.id;}else if(scenario.id==='09'&&context.invoiceResumeConversationId){job.conversationId=context.invoiceResumeConversationId;job.chatRunId=context.invoiceResumeChatRunId;}
    this.store.state.jobs.unshift(job);this.store.save();const controller=new AbortController();this.active.set(job.id,controller);
    if(parent)void this.afterChat(job,files,controller,parent);else void this.execute(job,files,controller);return job;
  }
  supplement(jobId,options={}){return startSupplement(this,{jobId,preferEvidence:options.preferEvidence!==false});}
  resume(jobId,options={}){
    const previous=this.store.state.jobs.find(j=>j.id===jobId);
    if(previous?.scenarioId==='09'){
      const ids=validateInvoiceResume(this.store,previous,{conversationId:options.conversationId,fileIds:options.fileIds,pages:options.pages}),key=JSON.stringify({ids:[...ids].sort(),pages:options.pages||{}});
      const child=this.store.state.jobs.find(j=>j.scenarioId==='09'&&j.options.invoiceResumeFrom===previous.id&&j.options.invoiceResumeKey===key);if(child)return child;
      const job=this.start({scenarioId:'09',fileIds:previous.dataScope.map(f=>f.id),rules:previous.rules,options:{...previous.options,invoiceResumeFrom:previous.id,invoiceRetryFileIds:ids,invoiceRetryPages:options.pages}},{invoiceResumeConversationId:previous.conversationId,invoiceResumeChatRunId:previous.chatRunId});job.options.invoiceResumeKey=key;this.store.save();return job;
    }
    if(!previous||!['08','24','21'].includes(previous.scenarioId)||previous.conversationId)throw Error('此恢复入口仅支持Workspace中本地公开材料任务');
    if(previous.recovery&&!previous.recovery.canResume)throw Error('任务已完成处置或达到累计预算/阻断停止条件');
    return this.start({scenarioId:previous.scenarioId,fileIds:previous.dataScope.map(f=>f.id),rules:previous.rules,options:{...previous.options,executionResumeFrom:previous.id,...(previous.scenarioId==='21'?{documentResumeFrom:previous.id}:{})}});
  }
  async afterChat(job,files,controller,parent){
    while(this.harness.active.has(parent.id)&&!controller.signal.aborted)await new Promise(resolve=>setTimeout(resolve,60));
    if(controller.signal.aborted||parent.status!=='done'){
      job.status='cancelled';job.error='聊天请求未完成或已停止，排队任务没有开始。';job.finishedAt=now();this.active.delete(job.id);this.store.save();return;
    }
    await this.execute(job,files,controller);
  }
  async execute(job,files,controller){
    const signal=controller.signal,log=(type,label,detail='')=>{if(job.status==='cancelled')return;job.trace.push({type,label,detail:String(detail).slice(0,1500),at:now()});this.store.save();};
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('执行超时，请缩小任务'),{code:'WORKSPACE_TIMEOUT'})),job.scenarioId==='09'?INVOICE_POLICY.batchMs+INVOICE_POLICY.deliveryMs+scaledLimit(30000):scaledLimit(['08','24'].includes(job.scenarioId)?900000:job.scenarioId==='21'?600000:300000));
    try{
      const invoiceRuntime=job.scenarioId==='09'?this.invoiceRuntimeFactory(this.store,this.harness):null;
      const taskHarness=invoiceRuntime?.harness||this.harness;
      if(invoiceRuntime){job.invoiceRuntime=invoiceRuntime.descriptor;const intranet=invoiceRuntime.descriptor.ocrTransport==='intranet-http';log('runtime',intranet?'09 使用公司内网识别与文字模型':'09 使用本地OCR与云端27B文字模型',intranet?'OCR、视觉和局部恢复均调用公司内网；本机不加载模型':'原图留在本机；独立视觉未配置');}
      job.status='running';job.startedAt=now();log('context','已锁定授权范围',`${files.length}份输入，仅写本次交付目录`);
      beginVerification(this.store,job,files,this.harness);
      for(const file of files)if(file.recognition?.confirmedAt){const scope=job.dataScope.find(item=>item.id===file.id);scope.recognition={kind:file.recognition.kind||'ocr',model:file.recognition.model,confirmedAt:file.recognition.confirmedAt,textSha256:file.recognition.confirmedTextHash};}
      const analyze=async args=>{if(['08','24','21'].includes(job.scenarioId))assertCloudTaskAllowed(taskHarness,files,job.rules,args);const audit=createAnalysisAudit(this.store,job,args);try{const result=await (invoiceRuntime?.analyze||this.analyze)({...args,signal:job.scenarioId==='09'?(args.signal||signal):signal,onEvent:log,audit});audit?.submitted(result);audit?.finish();if(audit&&result&&typeof result==='object')Object.defineProperty(result,'__auditId',{value:audit.id,configurable:true});return result;}catch(error){audit?.finish(error);throw error;}};
      if(invoiceRuntime?.batch)invoiceRuntime.batch.analyze=analyze;
      await (invoiceRuntime?.batch?reimburseBatch:processors[job.scenarioId])({store:this.store,harness:taskHarness,job,files,analyze,log,signal,invoiceIO:{batch:invoiceRuntime?.batch,recover:invoiceRuntime?.recover?(file,fields,coverage,s,l,context)=>invoiceRuntime.recover(file,fields,coverage,s,l,context):undefined,recognize:(file,s,l)=>invoiceRuntime?invoiceRuntime.recognize(file,s,l):this.recognize(file,s,l),look:(id,q,s,l)=>invoiceRuntime?invoiceRuntime.look(id,q,s,l):this.lookForChat(id,q,s,l)},transcribe:(file,s)=>this.transcribe(file,s,log,job.options.asrProvider)});
      if((signal.aborted||job.status==='cancelled')&&!(job.scenarioId==='09'&&signal.reason?.code==='WORKSPACE_TIMEOUT'&&job.artifacts.length&&job.status!=='cancelled'))throw new Error('任务已取消');
      if(job.options.outputFormats?.length){
        const missing=[];for(const format of job.options.outputFormats){const existing=job.artifacts.find(a=>a.name.toLowerCase().endsWith('.'+format));if(existing){await validateDelivery(format,resolveArtifact(this.store,job.id,existing.id).bytes,{title:'',blocks:[],sheets:[]});job.checks.push({label:format.toUpperCase()+'已有交付文件可回读',passed:true});}else missing.push(format);}
        if(missing.length){log('export','正在生成指定下载格式',missing.join('、'));const result=await attachDeliverables(this.store,this.harness,job,await sourceJobContent(this.store,job),missing,signal);if(result.failures.length){if(job.status==='completed')job.status='partial';job.summary+='；部分指定格式未交付，请查看提示。';}}
      }
      for(const file of files)readOriginal(this.store,file);
      await finishVerification(this.store,job,files);
      job.checks.push({label:'全部输入原件SHA256复核一致，未覆盖原件',passed:true});job.nextTrigger=job.status==='awaiting_approval'?'等待补充行动范围或提醒时间':job.status==='waiting_input'?(job.nextTrigger||'补充材料后重新核对'):'无；本次执行已结束';
      job.evidence=job.artifacts.map(a=>({artifactId:a.id,name:a.name,sha256:a.sha256,bytes:a.bytes}));
      if(job.status==='awaiting_approval'&&job.actions.length&&job.actions.every(a=>a.dueAt&&Number.isFinite(Date.parse(a.dueAt))&&/(Z|[+-]\d{2}:\d{2})$/.test(a.dueAt)&&Date.parse(a.dueAt)>Date.now())){
        this.approveActions({jobId:job.id,actions:job.actions.map(a=>({id:a.id,dueAt:a.dueAt}))});
        log('action','已按默认授权设置提醒',`${job.actions.length}项，时间来自已核验的任务输入`);
      }
      const audit={jobId:job.id,scenarioId:job.scenarioId,status:job.status,inputFiles:job.dataScope,authorization:job.authorization,checks:job.checks,warnings:job.warnings,artifacts:job.evidence,checkedAt:now()};
      writeArtifact(this.store,job,'校验与执行记录.json',Buffer.from(JSON.stringify(audit,null,2)),'audit');log('verify','输出与原件校验完成',job.status==='awaiting_approval'?'文件已交付，行动范围或提醒时间待补充':job.summary);job.finishedAt=now();
    }catch(error){
      const failure=['08','24','21'].includes(job.scenarioId)?executionFailure(job,signal,error):null;
      if(failure){job.status=failure.status;job.error=failure.message;job.executionStopReason=failure.timedOut?'timeout':'user_cancelled';}
      else if(signal.aborted||job.status==='cancelled'){job.status='cancelled';job.error='已取消，原件保留；已有交付物和已确认待办不会被撤销。';}
      else{job.status=/需要|请选择|补充|超过150000|正文|不受支持|目前支持|最多\d+秒/.test(error.message)?'waiting_input':'failed';job.error=String(error.message).slice(0,800);}
      try{await finishVerification(this.store,job,files,{error,cancelled:failure?failure.cancelled:signal.aborted||job.status==='cancelled'});}catch(receiptError){job.reliability&&(job.reliability.quality='failed');job.warnings.push('完成核查回执保存失败：'+receiptError.message);}
      job.nextTrigger=job.status==='waiting_input'?'补充输入后新建任务重试':'用户决定是否重试';job.trace.push({type:'error',label:STATUS_LABELS[job.status],detail:job.error,at:now()});job.finishedAt=now();
    }finally{if(this.store.presentationEnabled&&job.artifacts.length&&job.status!=='cancelled')try{await ensureHtmlReport(this.store,job);}catch(e){job.warnings.push('HTML预览未生成；原始交付保留：'+e.message);}clearTimeout(timer);this.active.delete(job.id);this.store.save();}
  }
  cancel(jobId){const job=this.store.state.jobs.find(j=>j.id===jobId);if(!job)throw new Error('找不到任务');if(!this.active.has(jobId))return job;job.status='cancelled';this.active.get(jobId).abort();this.store.save();return job;}
  approveActions(input){
    const job=this.store.state.jobs.find(j=>j.id===input.jobId);if(!job||!['04','15'].includes(job.scenarioId))throw new Error('找不到待确认行动任务');
    if(job.approvalCompleted)return job;
    if(job.status!=='awaiting_approval')throw new Error('此任务不在待确认状态');
    if(!Array.isArray(input.actions))throw new Error('需要明确确认的行动项列表');
    if(new Set(input.actions.map(a=>a.id)).size!==input.actions.length)throw new Error('行动项不能重复');
    const requested=input.actions.map(a=>{const action=job.actions.find(item=>item.id===a.id);if(!action)throw new Error('行动项不属于本次任务');const dueAt=a.dueAt||null;if(dueAt&&(!Number.isFinite(Date.parse(dueAt))||!/(Z|[+-]\d{2}:\d{2})$/.test(dueAt)))throw new Error('提醒时间需要带时区的有效日期');return {action,dueAt};});
    for(const {action,dueAt} of requested){const existing=this.store.state.tasks.find(t=>t.sourceJobId===job.id&&t.sourceActionId===action.id);const task=existing||{id:id(),title:action.title,details:`来源：${action.location}\n原文：${action.quote}\n原文负责人：${action.owner||'待确认'}`,dueAt,done:false,notifiedAt:null,createdAt:now(),sourceJobId:job.id,sourceActionId:action.id};if(!existing)this.store.state.tasks.push(task);action.status='created';action.createdTaskId=task.id;action.dueAt=task.dueAt;}
    for(const action of job.actions)if(action.status==='pending')action.status='not_requested';job.approvalCompleted=true;job.status=job.warnings.length?'partial':'completed';job.summary=`文件已交付；已创建${requested.length}项本机待办，其中${requested.filter(x=>x.dueAt).length}项设置提醒。`;job.nextTrigger='本次任务已结束，待办按各自提醒时间触发';
    job.checks.push({label:`${requested.length}项待办已写入本机存储并回读ID，提醒时间仅采用用户确认值`,passed:requested.every(({action})=>this.store.state.tasks.some(t=>t.id===action.createdTaskId))});
    const receipt=writeArtifact(this.store,job,'待办创建回执.json',Buffer.from(JSON.stringify({jobId:job.id,confirmedAt:now(),status:job.status,actions:job.actions},null,2)),'receipt');job.evidence.push(...requested.map(({action})=>({type:'task',taskId:action.createdTaskId,sourceActionId:action.id})),{artifactId:receipt.id,name:receipt.name,sha256:receipt.sha256});this.store.save();return job;
  }
}
