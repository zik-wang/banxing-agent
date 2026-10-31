import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requestedFormats} from '../v8-tools/delivery-format.mjs';
import {ResourceSpace,atomic,digest} from '../v8-tools/resource-space.mjs';
import {DocumentTools} from '../v8-tools/document-tools.mjs';
import {DocumentExtras} from '../v8-tools/document-extras.mjs';
import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';
import {TextTools} from '../v8-tools/text-tools.mjs';
import {runContractReview,parseDocument} from './harness.mjs';
import {resolveReviewContext} from './conversation.mjs';
import {groupReportIssues} from './grouping.mjs';
import {contextFingerprint} from './model-access.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const cloud=p=>['cloud','siliconflow','iteracompute'].includes(p);
export function protectReviewCloudInputs({enabled,botId,chat,operator,files=[],priorContract=false}){
 if(!enabled||botId!=='review'||!cloud(chat?.provider))return false;
 if(priorContract)return true;
 const docs=files.filter(f=>/\.(docx|pdf)$/i.test(f.name));if(!docs.length)return false;
 let approval;try{approval=read(operator.approvalFile);}catch{return true;}
 return docs.some(f=>!approval.materials?.some(m=>m.sha256===f.sha256&&['public','synthetic'].includes(m.classification)));
}
export function useContractHarness({enabled,botId,mode,request,files=[],priorContract=false}){
 if(!enabled||botId!=='review'||!['revise','resume','rebuild_delivery'].includes(mode))return false;if(mode==='rebuild_delivery')return priorContract;
 if(/(?:合并|比较|对比|代码审查|审核代码|这张发票|这些发票|审核方案|润色|改写|删除报告|删掉报告)/.test(request))return false;
 if(!priorContract&&/(?:word|docx|excel|xlsx|转换|转成|转为)/i.test(request)&&!/(?:审核|审查|重审|复核|补审)/.test(request))return false;return priorContract||(files.some(f=>/\.(docx|pdf)$/i.test(f.name))&&/合同|采购|购销/.test(request+' '+files.map(f=>f.name).join(' ')));
}

// Executed by the existing 8884 worker. All references and profiles are host-owned.
export async function executeHostReview(config,{next,signal}={}){
 const c=config.continuity,directory=path.resolve(config.directory),operator=config.contractReview||{};
 if(config.botPolicy?.id!=='review'||!c?.workspaceId||!c.conversationId||!c.workItemId)throw Error('REVIEW_HOST_SCOPE_REQUIRED');
 fs.mkdirSync(directory,{recursive:true});const space=new ResourceSpace(c.spaceRoot),workspace=c.workspaceId,work=space.work(workspace,c.workItemId),runId=randomUUID(),excluded=new Set([...(c.excludedInputs||[]),...(work.excluded||[])].map(r=>r.resourceId));
 const write=(n,v)=>atomic(path.join(directory,n),v),allowed=ref=>{const seen=new Set(),s=space.load();function walk(r){if(excluded.has(r.resourceId))throw Error('RESOURCE_EXCLUDED_IN_CONVERSATION');const key=r.resourceId+':'+r.revisionId;if(seen.has(key))return;seen.add(key);space.check(workspace,r,new Set(),s);for(const p of s.resources[r.resourceId].revisions[r.revisionId].parents)walk(p);}walk(ref);return space.check(workspace,ref);};
 const current=c.selectedResult===undefined?work.current:c.selectedResult;let previous=null;
 if(current){try{const v=space.check(workspace,current);if(v.metadata.bundle)previous=JSON.parse(space.read(workspace,current));}catch(e){throw Error('当前成果不可访问：'+e.message);}}
 const wantsWord=requestedFormats(config.request).includes('docx'),reviewAction=/(?:审核|审查|重审|复核|补审|重点|检查)/.test(config.request),exporting=wantsWord&&previous?.contractReview&&!reviewAction;
 if(c.mode==='rebuild_delivery'&&previous?.contractReview)return deliverExisting();
 if(previous?.contractReview&&/(?:最重要|核心|主要).{0,8}(?:问题|风险)|总结.{0,8}(?:问题|风险)/.test(config.request)&&!/(?:改为|换成|补充材料|重新|重审|供方|采购方|中立)/.test(config.request))return summarizePrevious();
 let sourceRefs=(c.selectedInputs||[]).filter(r=>!excluded.has(r.resourceId));
 if(!sourceRefs.length&&previous?.contractReview)sourceRefs=previous.contractReview.inputRefs.filter(r=>!excluded.has(r.resourceId));
 if(exporting)sourceRefs=[];
 const materials=[];fs.mkdirSync(path.join(directory,'review-inputs'),{recursive:true});
 for(const ref of sourceRefs){const v=allowed(ref),name=v.metadata.name||v.metadata.asset?.name;if(!name||! /\.(docx|pdf)$/i.test(name))return needsInput('合同专项只读取本轮明确选择的DOCX/PDF；未读取或外发其他类型材料。');const bytes=space.read(workspace,ref),file=path.join(directory,'review-inputs',ref.resourceId+path.extname(name).toLowerCase());fs.writeFileSync(file,bytes,{flag:'wx'});materials.push({ref,name,path:file,sha256:digest(bytes),fileId:ref.resourceId});}
 
 if(exporting)return await exportPreviousWord();
 if(!materials.length)return needsInput('请上传或明确选择主合同；不会从其他对话或全局最近文件中猜测。');
 if(/(?:比较|对比|合并)/.test(config.request))return needsInput('本设备采购审核专项尚未对接版本比较或合并；本轮未执行这些操作，原件和已有报告保留。可在通用助理中明确选择相应材料处理。');
 if(wantsWord&&!previous?.contractReview&&!reviewAction)return needsInput('当前没有已审核报告可转Word。本轮未将原文格式转换误作合同审核，也未发送材料给模型。');
 // Authorization precedes model calls, including classification fallback.
 let approval=null;
 if(cloud(config.chat.provider)){
  if(!operator.approvalFile||!fs.existsSync(operator.approvalFile))return needsInput('该合同尚未获准发送公网。请使用内网，或由维护者批准明确的公开/合成测试材料。');
  approval=read(operator.approvalFile);
  if(materials.some(m=>!approval.materials?.some(a=>a.sha256===m.sha256&&['public','synthetic'].includes(a.classification))))return needsInput('本轮包含未获准的合同材料，未向公网发送。原件已保留，无需重复上传。');
  if(approval.botGuidanceSha256!==digest(config.botPolicy.guidance||''))return needsInput('审核助理指导已变化，公网授权需要重新核对；未发送指导或合同内容。');
 }
 if(requestedFormats(config.request).some(f=>!['docx','txt','json'].includes(f)))return needsInput('合同专项报告目前支持网页、文字、审计JSON和Word；本轮没有生成所要求的Excel/PDF，原材料保留。');
 const parsed=[];for(const m of materials)parsed.push({m,doc:await parseDocument(config.python,m.path,{signal})});
 const explicitEquipment=/(?:设备|仪器|仪表|机电).{0,8}(?:采购|购销|买卖)|(?:采购|购销|买卖).{0,8}(?:设备|仪器|仪表|机电)/.test(config.request);
 const primary=parsed.filter(({m,doc})=>!/^附件|^技术附件/.test(m.name)&&!/^附件[一二三四五六七八九十0-9]/.test(doc.units[0]?.raw_text||'')&&/(?:设备|仪器|仪表|机电).{0,12}(?:采购|购销|买卖).{0,6}合同|(?:采购|购销|买卖).{0,12}(?:设备|仪器|仪表|机电).{0,6}合同/.test(doc.units.slice(0,5).map(u=>u.raw_text).join('\n')));
 let main=primary.length===1?primary[0]:null;
 if(!main&&explicitEquipment&&materials.length===1)main=parsed[0];
 if(!main&&previous?.contractReview){const prior=previous.contractReview.primaryResourceId;main=parsed.find(p=>p.m.ref.resourceId===prior)||null;}
 if(!main)return needsInput('当前专项仅支持中国大陆设备采购合同。请确认合同类型，并在多份合同时明确选择一份主合同；没有套用设备采购规则。');
 let userContext;try{userContext=resolveReviewContext(config.request,previous?.contractReview?.userContext||{});}catch(e){return needsInput(e.message);}const context={...userContext,guidance:[config.botPolicy.guidance||'',userContext.guidance].filter(Boolean).join('\n本轮用户要求：\n')};
 if(context.guidance.length>4000)return needsInput('累计审核指导超过4000字，请精简审核助理指导或开始新的审核；原件和历史报告保留。');
 const inputs=materials.map(m=>{const first=parsed.find(p=>p.m===m)?.doc.units[0]?.raw_text||'',heading=(first.match(/^\s*[^\n，。；：:]{0,12}?(附件[一二三四五六七八九十0-9]+)(?:\s|[：:、]|$)/)||[])[1],prior=previous?.contractReview?.materialLabels?.find(p=>p.ref.resourceId===m.ref.resourceId&&p.ref.revisionId===m.ref.revisionId);return {...m,role:m===main.m?'contract':'attachment',label:m===main.m?'':heading||(m.name.match(/附件[一二三四五六七八九十0-9]+/)||[])[0]||prior?.label||''};});
 const policyFile=path.join(here,'policy.example.json');
 const reviewConfig={directory:path.join(directory,'contract-evidence'),python:config.python,chat:{...config.chat,maxAttempts:1,structuredMode:'forced_tool',enableThinking:false,maxTokens:operator.maxTokens||6000,timeoutMs:operator.callTimeoutMs||180000},context,inputs,policyFile,ruleFile:path.join(here,'ruleset.json'),maxModelCalls:operator.maxCalls??12,timeoutMs:operator.timeoutMs||900000,preflightModel:operator.preflightModel!==false};
 if(approval){if(approval.policySha256!==digest(fs.readFileSync(policyFile)))return needsInput('政策内容变化，未获准的企业规则不会发送公网。');reviewConfig.externalApproval={approval_id:approval.id,provider:config.chat.provider,base_url:config.chat.baseUrl,model:config.chat.model,material_classification:materials.every(m=>approval.materials.find(a=>a.sha256===m.sha256)?.classification==='synthetic')?'synthetic':'public',input_sha256:inputs.map(m=>m.sha256),context_sha256:contextFingerprint(context),policy_sha256:approval.policySha256};}
 reviewConfig.testMaterialLabel=approval?'本次为获准的公开或合成测试材料，并非独立审定Gold。':'';
 const start=Date.now(),result=await runContractReview(reviewConfig,{next,signal,onProgress:p=>write('contract-progress.json',p)});
 const records=[];for(const [format,file]of Object.entries(result.outputs))records.push(await registerFile(file,format==='text'?'text':format==='html'?'html':'json'));
 let delivered=records;if(wantsWord){const word=await makeWord(fs.readFileSync(result.outputs.text,'utf8'));records.push(word);delivered=[word];}
 const state={userContext,context,primaryResourceId:main.m.ref.resourceId,inputRefs:materials.map(m=>m.ref),materialLabels:inputs.map(m=>({ref:m.ref,role:m.role,label:m.label})),reviewRunId:result.run.run_id,executionStatus:result.run.execution_status,reportGroups:result.run.report_groups,groupingCounts:result.run.grouping_counts,scope:result.run.scope,reviewedChecks:result.run.checks.filter(x=>x.execution_state==='reviewed').length,totalChecks:16};
 return finish(records,delivered,state,result.run.execution_status==='complete',`合同专项审核${result.run.execution_status==='complete'?'已完成既定流程':'已有部分结果'}：${state.reviewedChecks}/16个专题完成执行，保留${result.run.findings.length}个原始候选，按${result.run.report_groups?.length??result.run.findings.length}个主问题呈现（归组不代表事实确认）。法律依据尚未核验，不代表合同可签。${wantsWord?'已按要求交付真实Word文件。':'报告与原文证据、未完成项已保存。'}`,Date.now()-start,result.run.calls.length);


 function summarizePrevious(){
  const groups=previous.contractReview.reportGroups;
  let findings=[];if(!groups){const audit=previous.artifacts.find(a=>path.basename(a.record.path)==='review-result.json');if(audit){const bytes=space.read(workspace,audit.ref);if(digest(bytes)!==audit.record.sha256)throw Error('REPORT_HASH_MISMATCH');const run=JSON.parse(bytes);findings=run.findings||[];}}
  const selected=groups||groupReportIssues(findings);
  const answer=selected.length?'当前报告最重要的问题是：'+selected.slice(0,3).map(g=>g.title+'。'+(g.subIssues[0]?.summary||'')+' 条件与解释空间：'+g.subIssues.map(s=>s.interpretationSpace||'').filter(Boolean).join('；')).join('\n\n')+'\n这是对已有报告的归纳，未重新审核；原审核状态为'+previous.contractReview.executionStatus+'，法律依据未核验。':'当前报告没有足以归纳的已保存主问题；原审核状态仍为'+previous.contractReview.executionStatus+'，不能据此认定没有风险。';
  const delivery={state:'completed',outcome:'fully_completed',answer,answerOrigin:'contract_host',requirementsSatisfied:true,verifiedArtifacts:[],continuity:{resultRef:current,runId}};
  space.tx(s=>s.runs[runId]={runId,rootId:runId,projectId:workspace,workItemId:c.workItemId,directory,snapshot:{userRequest:config.request,selected:[current]},checkpoint:current,status:'completed',selectionPromoted:false,budget:{modelRequests:0,toolAttempts:0,maxModelRequests:0,maxToolAttempts:0}});
  write('resource-receipt.json',{runId,rootId:runId,checkpoint:current,artifacts:[]});write('delivery-settlement.json',delivery);write('agent-run.json',{status:'completed',answer,contractReview:true,delivery,metrics:{modelRequests:0},termination:null});return delivery;
 }
 function deliverExisting(){const wanted=/(?:word|docx)/i.test(config.request)?'docx':null,last=previous.contractReview.lastDeliveredIds,items=previous.artifacts.filter(a=>wanted?path.extname(a.record.path).toLowerCase()==='.'+wanted:!last||last.includes(a.record.artifactId));if(!items.length)return needsInput('当前选中版本没有所需格式，请明确要求转换，而不是取回已有文件');for(const a of items){space.read(workspace,a.ref);if(!fs.existsSync(a.record.path)||digest(fs.readFileSync(a.record.path))!==a.record.sha256)throw Error('REGISTERED_DELIVERY_MISSING_OR_CHANGED');}const snapshot={projectId:workspace,workItemId:c.workItemId,userRequest:config.request,selected:[current],inputClassification:config.inputClassification,ruleSnapshotId:digest({revision:space.load().projects[workspace].ruleRevision,rules:space.load().projects[workspace].rules})};space.tx(s=>s.runs[runId]={runId,rootId:runId,projectId:workspace,workItemId:c.workItemId,directory,snapshot,checkpoint:current,status:'completed',selectionPromoted:false,budget:{modelRequests:0,toolAttempts:0,maxModelRequests:40,maxToolAttempts:100}});const delivery={state:'completed',outcome:'fully_completed',answer:'已取回当前选中版本的原交付文件，未重新审核或导出。原审核结论不变。',answerOrigin:'contract_host',requirementsSatisfied:true,verifiedArtifacts:items.map(a=>a.record),continuity:{runId,resultRef:current}};write('resource-receipt.json',{runId,rootId:runId,snapshot,checkpoint:current,resourceSelections:[{ref:current,reason:'Explicit existing delivery retrieval; same artifact IDs and SHA'}],artifacts:items});write('delivery-settlement.json',delivery);write('agent-run.json',{status:'completed',answer:delivery.answer,contractReview:true,delivery,termination:null,metrics:{modelRequests:0}});write('contract-dispatch.json',{handler:'contract_review',operation:'retrieve_existing',runId,status:'completed'});return delivery;}
 async function registerFile(file,kind,extra={}){for(const m of materials)allowed(m.ref);const bytes=fs.readFileSync(file),artifactId=extra.artifactId||randomUUID(),record={...extra,artifactId,path:file,sha256:digest(bytes),kind:kind==='html'||kind==='json'?'text':kind,title:kind==='docx'?'设备采购合同审核报告（Word）':path.basename(file),expectedBytesSha256:digest(bytes),previews:[],previewErrors:[],contentVerified:false,readbackPassed:true,generation:'contract_harness',role:'current',originRunId:runId};const ref=space.put({projectId:workspace,workItemId:c.workItemId,kind:'artifact',bytes,parents:[...materials.map(m=>m.ref),...(exporting&&current?[current]:[])],metadata:{name:path.basename(file),artifactId,classification:config.inputClassification,producerRunId:runId,originConversationId:c.conversationId}});record.resourceRef=ref;return {record,ref};}
 async function makeWord(text){const docs=new DocumentTools({directory:path.join(directory,'word-export'),inputs:[],python:config.python}),extras=new DocumentExtras(docs,{docxModule:config.docxModule,artifactModule:config.artifactModule}),delivery=new DeliveryTools(docs,extras,new TextTools(docs));const a=await delivery.export({title:'设备采购合同审核报告',format:'docx',content:text});return registerFile(a.path,'docx',extras.artifacts.get(a.artifactId));}
 async function exportPreviousWord(){const prior=previous.artifacts.find(a=>path.extname(a.record.path)==='.txt');if(!prior)return needsInput('当前选中的成果没有可核对的报告正文，请明确选择需要转换的报告。');space.check(workspace,prior.ref);const bytes=space.read(workspace,prior.ref);if(digest(bytes)!==prior.record.sha256)throw Error('REPORT_HASH_MISMATCH');const a=await makeWord(bytes.toString('utf8'));return finish([...previous.artifacts,a],[a],previous.contractReview,true,'已将当前选中的完整审核报告转为Word，并回读核对。原审核状态仍为'+previous.contractReview.executionStatus+'；文件转换完成不代表审核通过。',0,0);}
 function needsInput(message){const value={state:'needs_input',outcome:'needs_input',answer:message,answerOrigin:'contract_host',verifiedArtifacts:[],requirementsSatisfied:false,requirements:[],unmetRequirements:[message]};write('delivery-settlement.json',value);write('agent-run.json',{status:'needs_input',answer:message,contractReview:true,termination:null,metrics:{modelRequests:0}});write('contract-dispatch.json',{handler:'contract_review',state:'needs_input',reason:message});return value;}
 function finish(all,delivered,state,complete,answer,elapsedMs,modelCalls){const parents=[...materials.map(m=>m.ref),...(exporting&&current?[current]:[])];for(const ref of parents)space.check(workspace,ref);const assets=materials.map(m=>({ref:m.ref,record:{...space.check(workspace,m.ref).metadata.asset,id:space.check(workspace,m.ref).metadata.localId||m.ref.resourceId,name:m.name,sha256:m.sha256}}));const bundle={schemaVersion:1,assets,tables:[],results:[],sources:[],sourceRecords:[],artifacts:all,contractReview:{...state,lastDeliveredIds:delivered.map(a=>a.record.artifactId)}};const snapshot={projectId:workspace,workItemId:c.workItemId,userRequest:config.request,selected:parents,selectedInputs:materials.map(m=>m.ref),inputClassification:config.inputClassification,ruleSnapshotId:digest({revision:space.load().projects[workspace].ruleRevision,rules:space.load().projects[workspace].rules})};const ref=space.put({projectId:workspace,workItemId:c.workItemId,kind:'result',bytes:Buffer.from(JSON.stringify(bundle)),parents:[...parents,...all.map(a=>a.ref)],metadata:{bundle:true,contractReview:true,indexable:true,name:'设备采购合同审核报告',artifactCount:all.length,classification:config.inputClassification,producerRunId:runId,originConversationId:c.conversationId,sourceRefs:materials.map(m=>m.ref)}});space.tx(s=>{s.runs[runId]={runId,rootId:runId,projectId:workspace,workItemId:c.workItemId,directory,snapshot,checkpoint:ref,status:complete?'completed':'partial',budget:{modelRequests:modelCalls,toolAttempts:0,maxModelRequests:40,maxToolAttempts:100},selectionPromoted:false};const w=s.workItems[workspace+'/'+c.workItemId];if(w.selectionRevision===work.selectionRevision){w.current=ref;w.selectionRevision++;s.runs[runId].selectionPromoted=true;}});const delivery={state:complete?'completed':'partial',outcome:complete?'fully_completed':'partially_delivered',answer,answerOrigin:'contract_host',requirementsSatisfied:complete,requirements:[],unmetRequirements:complete?[]:['合同审核仍有未完成项，请查看报告范围和原始记录'],verifiedArtifacts:delivered.map(a=>a.record),continuity:{resultRef:ref,runId,rootId:runId}};write('resource-receipt.json',{runId,rootId:runId,snapshot,resourceSelections:materials.map(m=>({ref:m.ref,sha256:m.sha256,reason:'Explicit current-conversation selection or selected contract result lineage'})),checkpoint:ref,artifacts:all});write('delivery-settlement.json',delivery);write('agent-run.json',{status:delivery.state,answer,contractReview:true,delivery,termination:complete?null:{reason:'contract_review_partial'},metrics:{modelRequests:modelCalls,elapsedMs}});write('contract-dispatch.json',{handler:'contract_review',operation:wantsWord?'word_and_review':'review',runId,reviewRunId:state.reviewRunId,scope:{workspaceId:workspace,conversationId:c.conversationId,workItemId:c.workItemId},resolvedResourceIds:materials.map(m=>m.ref.resourceId),sources:materials.map(m=>({uiFileId:config.contractReview.uiFileBindings?.find(b=>b.ref.resourceId===m.ref.resourceId&&b.ref.revisionId===m.ref.revisionId)?.fileId||null,resourceId:m.ref.resourceId,revisionId:m.ref.revisionId,sha256:m.sha256,reviewFileId:'F'+m.sha256.slice(0,20)})),status:delivery.state});return delivery;}
}
