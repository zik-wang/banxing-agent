import fs from 'node:fs';
import {atomic} from '../v8-tools/resource-space.mjs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {runContractReview} from './harness.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>atomic(p,v);
export function resolveReviewContext(request,previous={}){
 if(typeof request!=='string'||!request.trim()||request.length>4000)throw Error('请用4000字以内说明审核要求');
 const context={contract_type:'equipment_purchase_cn',stance:'buyer',region:'中国大陆',stage:'pre_signing',signing_date:'',signing_date_verified:false,...previous,guidance:request};
 if(/(?:这是|审核|审查|审一下)(?:这份|一份)?(?:劳动|租赁|借款|服务)合同/.test(request))throw Error('当前专项仅支持设备采购合同；其他合同请使用通用审核助理');
 const roles={供应商:'seller',供方:'seller',卖方:'seller',采购方:'buyer',买方:'buyer',中立:'neutral',双方:'neutral'},positive=[],negative=[];
 for(const match of request.matchAll(/(?:按|从|站在|以)(供应商|供方|卖方|采购方|买方|中立|双方)(?:角度|立场)?|(中立|双方)立场/g)){const role=roles[match[1]||match[2]],before=request.slice(0,match.index);if(/(?:不要|不能|不得|不应|别|不)$/.test(before))negative.push(role);else positive.push(role);}
 const choices=[...new Set(positive)];if(choices.length>1||(!choices.length&&negative.includes(context.stance)))throw Error('请明确按采购方、供方还是中立立场审核；原材料仍保留');if(choices.length)context.stance=choices[0];
 if(/(?:现在|已经|当前|目前|处于|按)(?:在|是)?履行(?:中|阶段)/.test(request))context.stage='performance';
 if(/(?:现在|当前|目前|处于|按)(?:是)?争议(?:处理|阶段)/.test(request))context.stage='dispute';
 // A new message supplements previous guidance; it never changes tools or budgets.
 if(previous.guidance)context.guidance=(previous.guidance+'\n本轮补充：'+request);
 if(context.guidance.length>4000)throw Error('累计审核要求超过4000字，请合并要求后重新提交');
 return context;
}

// Host integration contract for 8884: resolve only authorized workspace references,
// then register real delivery bytes. Neither callback nor profile comes from chat text.
export function createReviewAdapter({profile,resolveMaterials,publishArtifact,runReview=runContractReview}){
 return async({scope,selection,request,directory,previousContext})=>{
  if(scope?.botId!=='review'||!scope.workspaceId||!scope.conversationId||scope.contractType!=='equipment_purchase_cn')throw Error('REVIEW_HOST_SCOPE_REQUIRED');
  const inputs=await resolveMaterials({scope,selection});
  if(!inputs?.length||inputs.filter(f=>f.role==='contract').length!==1)throw Error('请选择一份主合同；其余材料作为附件');
  for(const f of inputs)if(!f.sha256||hash(fs.readFileSync(f.path))!==f.sha256)throw Error('材料已变化或授权引用失效');
  const context=resolveReviewContext(request,previousContext),result=await runReview({...profile,directory,inputs,context});
  const artifacts=[];
  for(const [kind,file]of Object.entries(result.outputs)){
   const bytes=fs.readFileSync(file),sha256=hash(bytes);
   artifacts.push(await publishArtifact({scope,path:file,kind,sha256,bytes:bytes.length,sourceFileIds:inputs.map(f=>f.fileId),runId:result.run.run_id,executionStatus:result.run.execution_status}));
  }
  return {context,executionStatus:result.run.execution_status,runId:result.run.run_id,artifacts,result};
 };
}

export function conversationRoutes(profile,jobs,{runReview=runContractReview}={}){
 const root=path.resolve(profile.dataRoot),conversations=path.join(root,'conversations');fs.mkdirSync(conversations,{recursive:true});
 return async(req,res,url)=>{
  const match=url.pathname.match(/^\/api\/conversations(?:\/([a-f0-9-]{36})(?:\/(turns))?)?$/);if(!match)return false;
  const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
  const [,id,action]=match;
  if(req.method==='GET'&&id&&!action){const file=path.join(conversations,id,'conversation.json');if(!fs.existsSync(file)){send({error:'对话不存在'},404);return true;}const c=read(file);send({...c,materials:c.materials.map(({path:_,...m})=>m),turns:c.turns.map(t=>{const f=path.join(root,t.jobId,'job.json');const j=fs.existsSync(f)?read(f):null;return {...t,job:j?{id:j.id,status:!jobs.has(j.id)&&j.status==='running'?'interrupted':j.status,conclusion:j.conclusion,error:j.error,progress:j.progress,outputs:j.outputs}:null};})});return true;}
  if(req.method!=='POST'||(id&&action!=='turns')){send({error:'不支持的操作'},405);return true;}
  if([...jobs.values()].some(j=>j.status==='running')){send({error:'已有审核正在执行，请稍后发送下一条要求'},409);return true;}
  let size=0,chunks=[];for await(const b of req){size+=b.length;if(size>45*1024*1024)throw Error('上传材料过大');chunks.push(b);}const body=JSON.parse(Buffer.concat(chunks));
  if(Object.keys(body).some(k=>!['request','files'].includes(k)))throw Error('对话输入只能包含要求和本次上传的文件');
  const cfile=id?path.join(conversations,id,'conversation.json'):null;
  if(id&&!fs.existsSync(cfile))throw Error('对话不存在');
  const c=id?read(cfile):{id:randomUUID(),materials:[],turns:[],context:null};
  const context=resolveReviewContext(body.request,c.context||{});
  if(id&&body.files?.length)throw Error('替换材料请新建审核对话，避免修改原审核范围');
  if(!id){if(!Array.isArray(body.files)||body.files.length<1||body.files.length>8||body.files.filter(f=>f.role==='contract').length!==1)throw Error('请上传一份主合同及可选附件');
   fs.mkdirSync(path.join(conversations,c.id));
   for(const f of body.files){if(!['contract','attachment'].includes(f.role)||typeof f.name!=='string'||! /\.(docx|pdf)$/i.test(f.name)||typeof f.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64))throw Error('仅支持PDF和DOCX合同材料');const bytes=Buffer.from(f.base64,'base64');if(!bytes.length||bytes.length>30*1024*1024)throw Error('单份材料须为1字节至30MB');const fileId=randomUUID(),target=path.join(conversations,c.id,fileId+path.extname(f.name).toLowerCase());fs.writeFileSync(target,bytes,{flag:'wx'});c.materials.push({fileId,path:target,name:path.basename(f.name.replaceAll('\\','/')),role:f.role,label:f.label||'',sha256:hash(bytes)});}
  }
  for(const m of c.materials)if(hash(fs.readFileSync(m.path))!==m.sha256)throw Error('原件已变化，本轮未重新分析其他材料');
  const jobId=randomUUID(),folder=path.join(root,jobId);fs.mkdirSync(folder);const job={id:jobId,status:'running',createdAt:new Date().toISOString(),context,files:c.materials.map(({path:_,...m})=>m),progress:{calls:0,stages:[],checks:[]},directory:path.join(folder,'review')};jobs.set(jobId,job);
  c.turns.push({id:randomUUID(),request:body.request,jobId,createdAt:job.createdAt});c.context=context;save(path.join(conversations,c.id,'conversation.json'),c);save(path.join(folder,'job.json'),job);
  const config={...profile,inputs:c.materials,context,directory:job.directory};delete config.dataRoot;delete config.port;
  void runReview(config,{onProgress:p=>{job.progress=p;save(path.join(folder,'job.json'),job);}}).then(r=>{job.status=r.run.execution_status;job.conclusion=r.run.review_conclusion;job.outputs=['report.html','report.txt','review-result.json'];save(path.join(folder,'job.json'),job);}).catch(e=>{job.status='failed';job.error=e.message;save(path.join(folder,'job.json'),job);});
  send({id:c.id,jobId,status:'running'},202);return true;
 };
}
