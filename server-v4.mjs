import {acquireDataLease} from './data-lease.mjs';
import {installObserver,conversationDiagnostics} from './qa-observer.mjs';
import {versionManifest} from './qa-version.mjs';
import {revisionState,selectRevision} from './work-revisions.mjs';
import {startOffice} from './conversation-work.mjs';
import {randomUUID} from 'node:crypto';
import {deliveryRunView,deliveryJobView} from './delivery-settlement.mjs';
import {conversationAttachmentState,setConversationAttachment} from './attachment-context.mjs';
import {CalendarService} from './calendar-service.mjs';
import {reportModel,renderReport} from './presentation.mjs';
import {calendarSpec,calendarHttp} from './demo-calendar.mjs';
import {invoiceBatchSummary} from './invoice-batch.mjs';
import {deploymentInvoiceOptions} from './invoice-deployment.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {Store,now} from './core.mjs';
import {DirectoryConnections} from './directory-connections.mjs';
import {Harness} from './runtime.mjs';
import {ConversationActions,publicChatJobs} from './conversation-actions.mjs';
import {createServiceDirectory} from './hybrid-deployment.mjs';
import {Workspace} from './workspace.mjs';
import {createInvoiceRuntime,invoiceRuntimeStatus} from './invoice-runtime.mjs';
import {sampleFiles} from './samples.mjs';
import {MAX_WORKSPACE_FILE,readOriginal} from './workspace-files.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {FILE_MIMES} from './file-delivery.mjs';
import {AUDIO_EXTENSIONS,audioMime} from './audio-formats.mjs';
import {extractUploadWorker,importUpload,MAX_UPLOAD} from './uploads.mjs';
import {chatHandoff} from './chat-intent.mjs';
import {initConversations,createConversation,deleteConversation,resolveConversation} from './conversations.mjs';
import {Proactive} from './proactive.mjs';
import {Delegations} from './delegations.mjs';
import {MultimodalJobs} from './multimodal-jobs.mjs';
import {searchKnowledge} from './knowledge.mjs';
import {semanticGet,semanticPost} from './semantic-workspace.mjs';
import {resolveReviewActor} from './semantic-review.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||8814);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT不合法');
const runtimeModules=['portable-directory.mjs','calendar-change.mjs','office-edits.mjs','work-revisions.mjs','data-lease.mjs','web/work-ui.js','file-delivery.mjs','web/conversations.js','conversation-work.mjs','delivery-settlement.mjs','attachment-context.mjs','runtime.mjs','spreadsheet-tools.mjs','web/chat-files.js','web/app-v3.js','report-handoff.mjs','calendar-service.mjs','calendar-mcp-server.mjs','calendar-mcp-client.mjs','calendar-provider.mjs','presentation.mjs','task-intake.mjs','web/product-ui.js','web/product.css',"invoice-batch-ports.mjs","invoice-batch.mjs","invoice-chat-route.mjs","invoice-delivery.mjs","invoice-deployment.mjs","invoice-disposition.mjs","invoice-evidence.mjs","invoice-history.mjs","invoice-intranet-media.mjs","invoice-local-render.mjs","invoice-page.mjs","invoice-relations.mjs","invoice-reliability.mjs","invoice-roi-checkpoints.mjs","invoice-roi-evidence.mjs","invoice-roi-render.mjs","invoice-roi.mjs","invoice-runtime.mjs","invoice-stages.mjs","invoice-structure.mjs",'demo-calendar.mjs','conversation-actions.mjs','scenarios.mjs','semantic-binding.mjs','semantic-benchmark.mjs','semantic-delivery.mjs','semantic-workspace.mjs','semantic-audit.mjs','semantic-review.mjs','semantic-atoms.mjs','semantic-relations.mjs','semantic-contract.mjs','supplement-plan.mjs','supplement-evidence.mjs','supplement-workspace.mjs','targeted-recovery.mjs','intranet-only.mjs','hybrid-deployment.mjs','workspace.mjs','source-coverage.mjs','source-recovery.mjs','task-recovery.mjs','recovery-batches.mjs','recovery-queue.mjs','document-integrity.mjs','document-continuation.mjs','document-context.mjs','structured-analysis.mjs','deepseek-runtime.mjs','inference-config.mjs','cloud-policy.mjs','comparison-preflight.mjs','comparison-audit.mjs'];
const runtimeBuild={capturedAt:new Date().toISOString(),modules:Object.fromEntries(runtimeModules.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]))};runtimeBuild.id=createHash('sha256').update(JSON.stringify(runtimeBuild.modules)).digest('hex');
// Local history, files and reminders must start even when the company LAN is absent.
const directory=createServiceDirectory();void directory.refresh().then(()=>directory.discoverMore()).catch(error=>console.error('内网能力检查未完成：',error.message));
const dataDirectory=process.env.DEMO_DATA_DIR||path.join(ROOT,'data'),dataLease=acquireDataLease(dataDirectory);process.once('exit',dataLease.release);
const store=new Store(dataDirectory);store.state.modelSettings={provider:'qwen'};store.state.subscription={enabled:false};store.save();
store.productExperience=true;store.presentationEnabled=true;const calendarService=new CalendarService(store);initConversations(store);const activatedReminders=store.activatePendingReminders();if(activatedReminders)console.log('已按默认授权启用本地提醒：'+activatedReminders+'项');const proactive=new Proactive(store);
const harness=new Harness(store,{directory}),workspace=new Workspace(store,harness,deploymentInvoiceOptions(directory,{factory:createInvoiceRuntime,status:invoiceRuntimeStatus})),token=randomBytes(32).toString('hex'),host=`127.0.0.1:${port}`,origin='http://'+host;
harness.runtimeBuild=runtimeBuild;
const delegations=new Delegations(store,workspace),multimodal=new MultimodalJobs(store,workspace,harness);
const directories=new DirectoryConnections(store);harness.directories=directories;
harness.chatActions=new ConversationActions(store,workspace,harness,delegations);harness.chatActions.calendarService=calendarService;
const qaObserver=process.env.QA_NAMESPACE?installObserver(store,harness,workspace,process.env.QA_NAMESPACE):null;
harness.qaObserver=qaObserver;
const qaLoadedVersion=qaObserver?versionManifest(ROOT):null;
const assets={'/work-ui.js':['work-ui.js','text/javascript; charset=utf-8'],'/product-ui.js':['product-ui.js','text/javascript; charset=utf-8'],'/product.css':['product.css','text/css; charset=utf-8'],'/semantic-review.js':['semantic-review.js','text/javascript; charset=utf-8'],'/directory-ui.js':['directory-ui.js','text/javascript; charset=utf-8'],'/chat-jobs.js':['chat-jobs.js','text/javascript; charset=utf-8'],'/grok.css':['grok.css','text/css; charset=utf-8'],'/grok-shell.js':['grok-shell.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app-v3.js','text/javascript; charset=utf-8'],'/conversations.js':['conversations.js','text/javascript; charset=utf-8'],'/proactive.js':['proactive.js','text/javascript; charset=utf-8'],'/chat-files.js':['chat-files.js','text/javascript; charset=utf-8'],'/local-tools.js':['local-tools.js','text/javascript; charset=utf-8'],'/workbench.js':['workbench.js','text/javascript; charset=utf-8'],'/reminders.js':['reminders.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const json=(res,value,status=200)=>{if(res.qaRequest)qaObserver?.emit({...res.qaRequest,stage:'request_intake',status:status>=400?'failed':'completed',outputRefs:value?.id?[value.id]:[],metadata:{httpStatus:status,errorCode:status>=400?'REQUEST_REJECTED':null}});res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function body(req,limit){const buffers=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('请求过大');buffers.push(chunk);}try{return JSON.parse(Buffer.concat(buffers).toString('utf8')||'{}');}catch{throw Error('请求不是JSON');}}
const validToken=value=>typeof value==='string'&&value.length===token.length&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
export const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
    if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return json(res,{error:'仅允许本机同源访问'},403);
    const pathname=new URL(req.url,origin).pathname;
    if(req.method==='GET'&&pathname.startsWith('/api/qa/')){
      if(!qaObserver)return json(res,{error:'QA diagnostics disabled'},404);
      if(!validToken(req.headers['x-csrf-token']))return json(res,{error:'QA diagnostics require same-origin session token'},403);
      const query=new URL(req.url,origin).searchParams,cid=query.get('conversationId');
      if(pathname==='/api/qa/version')return json(res,{loaded:qaLoadedVersion,disk:versionManifest(ROOT),runtimeBuild,telemetry:qaObserver.health()});
      if(!cid||!store.state.conversations.some(c=>c.id===cid))return json(res,{error:'Conversation required'},404);
      if(pathname==='/api/qa/conversation')return json(res,conversationDiagnostics(store,qaObserver,cid));
      if(pathname==='/api/qa/events'){const after=Number(query.get('after')||0),limit=Number(query.get('limit')||500);if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)return json(res,{error:'Invalid cursor'},400);const events=qaObserver.events({conversationId:cid,after,limit});return json(res,{events,nextCursor:events.at(-1)?.sequence||after,telemetry:qaObserver.health()});}
      return json(res,{error:'Unknown QA endpoint'},404);
    }
    if(/^\/api\/(?:research|search|news|subscription)(?:\/|$)/.test(pathname))return json(res,{error:'第四版不提供公网搜索、RSS或资讯订阅'},410);
    if(req.method==='GET'&&assets[pathname]){const [file,type]=assets[pathname];res.writeHead(200,{'Content-Type':type});return res.end(fs.readFileSync(path.join(ROOT,'web',file)));}
    if(req.method==='GET'&&pathname==='/api/calendar/status')return json(res,calendarService.status());
    if(req.method==='GET'&&pathname==='/api/calendar/operations')return json(res,{operations:calendarService.operations(new URL(req.url,origin).searchParams.get('conversationId'))});
    if(req.method==='GET'&&/^\/api\/jobs\/[^/]+\/report$/.test(pathname)){const job=store.state.jobs.find(j=>j.id===pathname.split('/')[3]);if(!job)throw Error('任务不存在');const requested=new URL(req.url,origin).searchParams.get('conversationId');if(requested&&job.conversationId!==requested)throw Error('不能跨对话预览成果');const bytes=Buffer.from(renderReport(await reportModel(store,deliveryJobView(store,job))));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-downloads",'X-Banxing-Task-Status':deliveryJobView(store,job).status});return res.end(bytes);}
    if(req.method==='GET'&&pathname==='/api/state'){const {workspaceFiles,jobs,knowledge,connectedDirectories,...personal}=store.state;return json(res,{...personal,runs:personal.runs.map(r=>deliveryRunView(store,r)),directoryConnections:directories.state(),chatJobs:publicChatJobs(store),knowledgeCount:knowledge?.length||0,modelService:harness.modelStatus(),csrfToken:token,running:[...harness.active.keys()],services:directory.status()});}
    if(req.method==='GET'&&pathname==='/api/health')return json(res,{...await harness.health(),runtimeBuild});
    if(req.method==='GET'&&pathname==='/api/services')return json(res,directory.status());
    if(req.method==='GET'&&pathname==='/api/workspace')return json(res,workspace.state());
    if(req.method==='GET'&&/^\/api\/jobs\/[^/]+\/progress$/.test(pathname)){
      const job=store.state.jobs.find(j=>j.id===pathname.split('/')[3]);if(!job)throw Error('任务不存在');
      return json(res,{id:job.id,status:job.status,active:workspace.active.has(job.id),scenarioId:job.scenarioId,summary:job.summary,error:job.error,startedAt:job.startedAt,finishedAt:job.finishedAt,recovery:job.recovery,supplement:job.supplement,sourceCoverage:job.sourceCoverage,coverageProgress:job.coverageProgress,invoiceBatch:invoiceBatchSummary(job),documentAnalysis:job.documentAnalysis?{processedUnits:job.documentAnalysis.processedUnits,totalUnits:job.documentAnalysis.totalUnits,reviewedUnits:job.documentAnalysis.reviewedUnits}:null,providerRequests:job.reliability?.providerRequests,analysisSessions:job.reliability?.analysisSessions,quality:job.reliability?.quality});
    }
    if(req.method==='GET'&&/^\/api\/workspace\/files\/[^/]+\/recognition$/.test(pathname))return json(res,workspace.recognition(pathname.split('/')[4]));
    if(req.method==='GET'&&/^\/api\/workspace\/files\/[^/]+\/(original|preview)$/.test(pathname)){
      const file=store.state.workspaceFiles.find(f=>f.id===pathname.split('/')[4]);if(!file)throw Error('文件不存在');const bytes=readOriginal(store,file),preview=pathname.endsWith('/preview'),types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.pdf':'application/pdf',...Object.fromEntries(AUDIO_EXTENSIONS.map(ext=>[ext,audioMime(ext)]))};if(preview&&!types[file.extension])throw Error('文件不能预览');res.writeHead(200,{'Content-Type':preview?types[file.extension]:'application/octet-stream','Content-Length':bytes.length,...preview?{}:{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)}});return res.end(bytes);
    }
    if(req.method==='GET'&&/^\/api\/jobs\/[^/]+\/artifacts\/[^/]+$/.test(pathname)){const parts=pathname.split('/'),requestedConversation=new URL(req.url,origin).searchParams.get('conversationId');if(requestedConversation&&store.state.jobs.find(j=>j.id===parts[3])?.conversationId!==requestedConversation)throw Error('下载文件不属于当前对话');const {artifact,bytes}=resolveArtifact(store,parts[3],parts[5]),preview=new URL(req.url,origin).searchParams.get('preview')==='1',mime=preview&&artifact.name.endsWith('.wav')?'audio/wav':FILE_MIMES[artifact.name.split('.').at(-1).toLowerCase()]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length,'Content-Disposition':(mime==='audio/wav'?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(artifact.name)});return res.end(bytes);}
    if(req.method==='GET'&&/^\/api\/semantic\/[^/]+$/.test(pathname))return json(res,semanticGet(workspace,decodeURIComponent(pathname.split('/')[3])));
    if(req.method==='GET'&&pathname==='/api/conversations/work'){const cid=new URL(req.url,origin).searchParams.get('conversationId');return json(res,revisionState(store,cid));}
    if(req.method==='GET'&&pathname==='/api/conversations/attachments'){const c=resolveConversation(store,new URL(req.url,origin).searchParams.get('conversationId'));return json(res,conversationAttachmentState(store,c.id));}
    if(req.method==='GET'&&pathname==='/api/demo-calendar/openapi.json')return json(res,calendarSpec());
    if(req.method==='GET'&&pathname==='/api/demo-calendar/events')return json(res,calendarHttp(store,'events',{conversationId:new URL(req.url,origin).searchParams.get('conversationId')}));
    if(req.method!=='POST')return json(res,{error:'没有这个接口'},404);
    if(!validToken(req.headers['x-csrf-token']))return json(res,{error:'页面凭据失效，请刷新'},403);
    const input=await body(req,pathname==='/api/workspace/files'?Math.ceil(MAX_WORKSPACE_FILE/3)*4+2000:pathname==='/api/files/upload'?Math.ceil(MAX_UPLOAD/3)*4+2000:pathname==='/api/workspace/recognize/confirm'?242000:70000);
    if(qaObserver){res.qaRequest={requestId:randomUUID(),conversationId:typeof input.conversationId==='string'?input.conversationId:null,inputRefs:Array.isArray(input.fileIds)?input.fileIds.filter(x=>typeof x==='string'):[]};qaObserver.emit({...res.qaRequest,stage:'request_intake',status:'started',metadata:{route:pathname}});}
    if(pathname==='/api/services/refresh'){if(workspace.active.size||workspace.recognizing.size||harness.active.size)throw Error('助手正在处理上一项请求，请稍候');await directory.refresh();await directory.discoverMore();return json(res,directory.status());}
    if(pathname.startsWith('/api/directories/')){
      const conversation=resolveConversation(store,input.conversationId);
      if(pathname==='/api/directories/connect')return json(res,await directories.connect(conversation.id,input),201);
      if(pathname==='/api/directories/scan')return json(res,await directories.scan(conversation.id,input.connectionId));
      if(pathname==='/api/directories/disconnect')return json(res,directories.disconnect(conversation.id,input.connectionId));
      if(pathname==='/api/directories/changes')return json(res,directories.changes(conversation.id,input));
    }
    if(pathname==='/api/calendar/connect'){const client=await calendarService.client.connect();return json(res,{tools:calendarService.client.tools,status:calendarService.status()});}
    if(pathname==='/api/calendar/change')return json(res,await calendarService.prepareChange(input.conversationId,input));
    if(pathname==='/api/calendar/prepare')return json(res,await calendarService.prepare(input.conversationId,input.event));
    if(pathname==='/api/calendar/decision'){if(input.confirmed!==true||typeof input.approve!=='boolean')throw Error('需要明确确认或取消');return json(res,await calendarService.decide(input.conversationId,input.operationId,input.approve));}
    if(pathname==='/api/conversations/work/select'){if(harness.active.size||workspace.active.size)throw Error('请等待当前任务结束再切换版本');return json(res,selectRevision(store,input.conversationId,input.jobId,input.artifactId));}
    if(pathname==='/api/conversations/work/correct'){
      if(harness.active.size||workspace.active.size)throw Error('请等待当前任务结束再更正');
      if(input.clientRequestId&&!/^[A-Za-z0-9_-]{8,100}$/.test(input.clientRequestId))throw Error('请求标识无效');
      const correctionRequest={jobId:input.jobId,sheet:input.sheet,column:input.column,row:input.row,value:input.value},prior=input.clientRequestId&&store.state.runs.find(r=>r.conversationId===input.conversationId&&r.clientRequestId===input.clientRequestId);if(prior){if(JSON.stringify(prior.correctionRequest)!==JSON.stringify(correctionRequest))throw Error('请求标识已绑定不同更正内容');return json(res,prior,202);}
      selectRevision(store,input.conversationId,input.jobId);const job=store.state.jobs.find(j=>j.id===input.jobId),request='人工更正：'+String(input.sheet)+'，第'+String(input.row)+'条，'+String(input.column)+'改为'+String(input.value);
      const run={id:randomUUID(),conversationId:input.conversationId,clientRequestId:input.clientRequestId||null,correctionRequest,request,status:'running',startedAt:new Date().toISOString(),trace:[],turns:0,resolvedFileIds:job.dataScope.map(f=>f.id),sourceFiles:job.dataScope};
      return json(res,startOffice(harness,run,{operation:'edit',sourceJob:job,steps:[{type:'set_cell',sheet:String(input.sheet),row:String(input.row),column:String(input.column),value:input.value}],formats:['xlsx']},[]),202);
    }
    if(pathname==='/api/conversations/create')return json(res,createConversation(store),201);
    if(pathname==='/api/conversations/delete'){
      const result=deleteConversation(store,harness,input.conversationId);
      for(const c of directories.state(input.conversationId))directories.disconnect(input.conversationId,c.id);
      return json(res,result);
    }
    if(pathname==='/api/proactive/config')return json(res,proactive.configure(input));
    if(pathname==='/api/proactive/check')return json(res,proactive.check(new Date(),{preview:input.preview===true}));
    if(pathname==='/api/conversations/attachments/update'){const c=resolveConversation(store,input.conversationId);if(harness.active.size||workspace.active.size)throw Error('任务执行中，请先停止再调整附件范围');return json(res,setConversationAttachment(store,c.id,input.fileId,input.status));}
    if(pathname==='/api/workspace/files')return json(res,await workspace.upload(input),201);
    if(pathname==='/api/workspace/examples'){const files=[];for(const item of await sampleFiles(input.scenarioId)){const exampleKey=input.scenarioId+':'+item.name;let file=store.state.workspaceFiles.find(f=>f.exampleKey===exampleKey);if(!file){file=await workspace.upload(item);file.exampleKey=exampleKey;store.save();}files.push(file);}return json(res,{files},201);}
    if(pathname==='/api/workspace/recognize')return json(res,await workspace.recognizeFile(input.fileId,input));
    if(pathname==='/api/workspace/recognize/cancel')return json(res,workspace.cancelRecognition(input.fileId));
    if(pathname==='/api/workspace/recognize/confirm')return json(res,workspace.confirmRecognition(input));
    if(/^\/api\/semantic\/(prepare|start|delivery|authorize|review|gold-annotation|gold-adjudicate)$/.test(pathname)){const actor=resolveReviewActor(store,input);return json(res,semanticPost(workspace,pathname.split('/')[3],input,actor));}
    if(/^\/api\/demo-calendar\/(setup|check|write)$/.test(pathname)){if(pathname.endsWith('/write')&&!harness.active.has(input.runId))throw Error('写入必须属于当前运行中的日历对话');return json(res,calendarHttp(store,pathname.split('/').at(-1),input));}
    if(pathname==='/api/jobs/start')return json(res,workspace.start(input),202);
    if(pathname==='/api/jobs/supplement')return json(res,workspace.supplement(String(input.jobId||''),{preferEvidence:input.preferEvidence!==false}),202);
    if(pathname==='/api/jobs/resume')return json(res,workspace.resume(String(input.jobId||''),{fileIds:input.fileIds,pages:input.pages,conversationId:input.conversationId}),202);
    if(pathname==='/api/multimodal/start')return json(res,multimodal.start(input),202);
    if(pathname==='/api/knowledge/search')return json(res,await searchKnowledge(store,harness,input.query,AbortSignal.timeout(30000)));
    if(pathname==='/api/delegations/create')return json(res,delegations.create(input),201);
    if(pathname==='/api/delegations/toggle')return json(res,delegations.toggle(input));
    if(pathname==='/api/jobs/cancel')return json(res,workspace.cancel(input.jobId));
    if(pathname==='/api/jobs/approve-actions')return json(res,workspace.approveActions(input));
    if(pathname==='/api/chat/handoff')return json(res,chatHandoff(store,input));
    if(pathname==='/api/chat'){if(workspace.recognizing.size||[...workspace.active.keys()].some(id=>store.state.jobs.find(j=>j.id===id)?.conversationId!==input.conversationId))throw Error('助手正在处理上一项请求，请稍候');return json(res,harness.start(input.message,{fileIds:input.fileIds,intentContextRunId:input.intentContextRunId,conversationId:input.conversationId,mode:input.mode,excludedFileIds:input.excludedFileIds,attachmentInheritance:input.attachmentInheritance,retryOperationRunId:input.retryOperationRunId,clientRequestId:input.clientRequestId}),202);}
    if(pathname==='/api/cancel'){harness.cancel(input.runId);return json(res,{ok:true});}
    if(pathname==='/api/model/config')throw Error('第四版固定使用内网能力目录，不接入公网模型');
    if(pathname==='/api/profile'){store.updateProfile({...input,topics:['ai']});return json(res,{ok:true});}
    if(pathname==='/api/notes')return json(res,store.saveNote(input));
    if(pathname==='/api/files/upload')return json(res,importUpload(store,await extractUploadWorker(input)),201);
    if(pathname==='/api/approve')return json(res,store.approve(input.approvalId,input.dueAt));
    if(pathname==='/api/reject'){const proposal=store.state.approvals.find(p=>p.id===input.approvalId);if(!proposal||proposal.status!=='pending')throw Error('提议已处理或不存在');proposal.status='rejected';store.save();return json(res,{ok:true});}
    if(pathname==='/api/tasks/toggle'){const task=store.state.tasks.find(t=>t.id===input.taskId);if(!task)throw Error('待办不存在');task.done=!task.done;if(task.done)for(const n of store.state.notifications.filter(n=>n.taskId===task.id&&!n.read)){n.read=true;n.acknowledgedAt=now();n.response='complete';}store.save();return json(res,task);}
    if(pathname==='/api/tasks/schedule')return json(res,store.scheduleTask(input.taskId,input.dueAt));
    if(pathname==='/api/notifications/respond')return json(res,store.respondNotification(input.notificationId,input.action));
    if(pathname==='/api/notifications/read'){for(const n of store.state.notifications)n.read=true;store.save();return json(res,{ok:true});}
    return json(res,{error:'没有这个接口'},404);
  }catch(error){if(!res.headersSent)json(res,{error:String(error.message).slice(0,700)},/上一项请求/.test(error.message)?409:400);}
});
let lastProactive=0;const ticker=setInterval(()=>{store.tick();delegations.tick();directories.tick();if(Date.now()-lastProactive>=60000){lastProactive=Date.now();proactive.check();}},3000);ticker.unref();
server.listen(port,'127.0.0.1',()=>console.log('伴行 V7 · '+origin));
const shutdown=()=>{void calendarService.client.close();for(const a of harness.active.values())a?.abort();for(const a of workspace.active.values())a?.abort();for(const a of workspace.recognizing.values())a?.abort();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
