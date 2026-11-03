import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ToolError} from './harness.mjs';

// A question is an execution state, not evidence that a requested export failed.
export function canProduceAlternatives(request,formats){
 return formats.length===1&&['docx','xlsx','pdf','txt','md'].includes(formats[0])&&!/(?:发送|发邮件|发布|预约|付款|删除|覆盖|替换|合并|只用|只要|仅用|选一|选择|最新|第一|第二|审核|审查|分析|统计|总结|撰写|提取|核对|对比|比较|修改|补充)/u.test(request);
}
export function candidateChoices(resources){
 const seen=new Set();return resources.filter(r=>['original','result'].includes(r.kind)&&r.resourceId&&r.revisionId&&!seen.has(r.resourceId+':'+r.revisionId)&&seen.add(r.resourceId+':'+r.revisionId)).slice(0,12).map(r=>({id:r.resourceId+':'+r.revisionId,ref:{resourceId:r.resourceId,revisionId:r.revisionId},name:r.name,sha256:r.sha256,createdAt:r.createdAt,kind:r.kind}));
}
export class UserDecision {
 constructor({docs,extras,books,texts,continuity,config}){Object.assign(this,{docs,extras,books,texts,c:continuity,config});this.pending=null;}
 question(question,choices=[],reason='file_selection',more=false){return {id:randomUUID(),state:'pending',kind:reason,title:'需要你确认处理范围',question,choices,hasMore:more,detailLabel:'补充用途和要求',detailHint:'例如：给领导看，只处理本月数据，金额保留两位小数，输出Word。',originalRequest:this.docs.request};}
 tools(){return [{name:'ask_user',description:'Ask the user a necessary question and pause in needs_input. Supply real discovered resource_id/revision_id choices for file ambiguity; never invent file IDs. For one or two safe format-conversion alternatives the host may generate both distinct copies. For many choices or substantive business decisions wait for the user. This is not a failure and needs no export first.',inputSchema:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:1200},choices:{type:'array',maxItems:12,items:{type:'object',properties:{resource_id:{type:'string',maxLength:400},revision_id:{type:'string',maxLength:400}},required:['resource_id','revision_id'],additionalProperties:false}}},required:['question'],additionalProperties:false},execute:async a=>{const all=this.c?.workspace?.list({limit:100000,excluded:(this.c.config.continuity.excludedInputs||[]).map(x=>x.resourceId)}).resources||[];const resources=(a.choices||[]).map(choice=>{const r=all.find(r=>r.resourceId===choice.resource_id&&r.revisionId===choice.revision_id);if(!r)throw new ToolError('CHOICE_SCOPE_DENIED','请选择本工作空间实际可用的原件或成果');this.c.allowed(r.ref);return r;});this.pending=this.question(a.question,candidateChoices(resources));return {hostUserDecision:this.pending};}}];}
 fromHistory(answer,run,history){
  if(this.pending)return this.pending;
  if(run.status==='needs_input')return this.question(answer,[],'missing_details');
  if(run.termination||run.status!=='model_finished'||!/(?:请|需要|须).{0,25}(?:确认|选择|指定|告诉)|哪一[份个版]/u.test(answer))return null;
  const ambiguous=[...history].reverse().find(x=>x.error?.code==='AMBIGUOUS_WORKSPACE_RESOURCE');
  const listed=[...history].reverse().find(x=>x.tool==='list_materials'&&x.status==='ok'&&x.data?.resources?.some(r=>['result','original'].includes(r.kind)));
  const candidates=candidateChoices(ambiguous?.error.details?.candidates?.map(r=>({...r,kind:'result'}))||listed?.data.resources||[]);
  return this.question(answer,candidates,candidates.length?'file_selection':'missing_details',!!listed?.data.nextCursor);
 }
 observe(result){
  // Deciding between file versions needs metadata, not repeated content reads.
  if(result.tool!=='list_materials'||result.status!=='ok'||this.c?.selected.length||!canProduceAlternatives(this.docs.request,this.docs.requestedFormats)||!/(?:这个|这份|那个|哪份)/u.test(this.docs.request)||!/(?:做成|转成|转为|转换|导出|存成)/u.test(this.docs.request))return null;
  const choices=candidateChoices(result.data?.resources||[]);if(!choices.length)return null;
  this.pending=this.question('请确认要转换的材料；可以选择一份或多份，并补充用途和要求。',choices,'file_selection',!!result.data.nextCursor);
  return {needsInput:true,clarification:this.pending,message:this.pending.question};
 }
 async convert(choice,index){
  const value=this.c.allowed(choice.ref);if(value.hash!==choice.sha256)throw new ToolError('CHOICE_CHANGED','候选文件内容已改变，请重新选择');
  const source=this.c.space.load().resources[choice.ref.resourceId];if(source.status==='archived'||source.revoked||this.c.work?.excluded?.some(r=>r.resourceId===choice.ref.resourceId))throw new ToolError('CHOICE_UNAVAILABLE','候选文件已不可用，请重新选择');
  const bundle=value.metadata.bundle?JSON.parse(this.c.space.read(this.c.projectId,choice.ref)):null;
  this.c.include(choice.ref,'Host converts each explicitly offered alternative separately; no version guessed or original overwritten');
  const format=this.docs.requestedFormats[0],title=path.parse(choice.name||'成果').name+' · '+String(choice.createdAt||'').replace('T',' ').slice(0,16).replace(':','-')+' · 版本'+(index+1);
  let args={title:title.slice(0,110),format:format==='pdf'?'docx':format};
  if(bundle?.tables?.length){
   if(format==='xlsx'){if(bundle.tables.length!==1)throw new ToolError('CHOICE_TABLE_SCOPE','一份成果含多张表，请明确需要哪些工作表');return this.execute('export_table',{table_id:bundle.tables[0].id,title:args.title});}
   args.table_ids=bundle.tables.map(t=>t.id);
  }else if(bundle){
   const usable=bundle.artifacts.filter(a=>path.extname(a.record.path).toLowerCase()==='.txt'||a.record.kind==='docx'&&a.record.wordSource);
   const preferred=usable.find(a=>path.extname(a.record.path).toLowerCase()==='.txt')||usable.find(a=>a.record.kind==='docx');
   if(!preferred)throw new ToolError('CHOICE_READER_REQUIRED','这份成果尚无可直接转换的完整正文，请明确需要转换的文件');
   args.artifact_ids=[preferred.record.artifactId];
  }else{
   const asset=[...this.docs.assets.values()].find(a=>a.resourceRef?.resourceId===choice.ref.resourceId);
   if(asset?.kind!=='text')throw new ToolError('CHOICE_READER_REQUIRED','该原件需要先读取内容；请明确处理要求后继续');
   args.content=this.texts.source(asset.id).text;args.source_ids=[asset.id];
  }
  const output=await this.execute('export_document',args);
  return format==='pdf'?this.execute('convert_to_pdf',{artifact_id:output.artifactId}):output;
 }
 async execute(name,args){const r=await this.harness.execute(name,args);if(r.status==='error')throw new ToolError(r.error.code,r.error.message);return r.data;}
 async handle(decision,{approved=false}={}){
  if(!decision)return null;
  if(approved&&decision.details)return null;
  const choices=decision.choices,auto=!decision.autoAttempted&&!decision.hasMore&&choices.length>0&&choices.length<3&&canProduceAlternatives(this.docs.request,this.docs.requestedFormats);
  if(!approved&&!auto)return {needsInput:true,clarification:decision,message:decision.question};
  if(!auto&&approved)return null; // Business decisions continue through the ordinary planner with exact refs.
  decision.autoAttempted=true;const completed=[];for(let i=0;i<choices.length;i++){try{const a=await this.convert(choices[i],i);completed.push({choiceId:choices[i].id,artifactId:a.artifactId});}catch(e){decision.failures??=[];decision.failures.push({choiceId:choices[i].id,code:e.code||'CONVERSION_FAILED',message:e.message});}}
  const receipt={decisionId:decision.id,mode:approved?'user_selected':'all_small_alternatives',choices,completed,failures:decision.failures||[],originalsUnchanged:true};
  fs.writeFileSync(path.join(this.docs.directory,'user-decision-receipt.json'),JSON.stringify(receipt,null,2));
  if(decision.failures?.length)return {needsInput:true,clarification:decision,message:'已保留可用成果。'+decision.failures.map(x=>x.message).join('；')+'。请补充需要处理的文件和具体要求。'};
  return {completed:true,message:choices.length===2?'有两份可用候选，我已分别生成副本，并按时间和版本标明。请下载需要的一份；原文件均保留。':'已按选定材料生成文件，原件保留。',decisionReceipt:receipt};
 }
 async approved(){const x=this.config.clarificationResolution;return x?this.handle(x,{approved:true}):null;}
 async finish(answer,run,history){const decision=this.fromHistory(answer,run,history);return this.handle(decision);}
}
