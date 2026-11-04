import fs from 'node:fs';
import path from 'node:path';
import {root,data,read,write,snapshot} from './core.mjs';
export function auditConnections(s=snapshot()){
 const workspace=path.resolve(root,'..');
 const workers=s.workers.filter(w=>w.onboarding||w.thread_id).map(w=>{
  let enrollment=w.onboarding,receipt=w.onboarding_receipt;
  const pending=read(path.join(data,'supervision-pending',w.worker_id+'.json'));
  if(pending?.cycle_id){
   const cycle=read(path.join(data,'supervision',pending.cycle_id+'.json'));const delivery=cycle?.deliveries?.[w.worker_id];
   const ack=read(path.join(data,'supervision-receipts',pending.cycle_id,w.worker_id+'.json'));
   if(delivery){
    enrollment={id:pending.cycle_id,requested_at:delivery.queued_at||cycle.created_at};
    receipt=ack?{...ack,progress_reported_at:Date.parse(w.updated_at)>Date.parse(ack.acknowledged_at)?w.updated_at:null,progress_report:Date.parse(w.updated_at)>Date.parse(ack.acknowledged_at)?w.reports[0]:null}:null;
   }
  }
  const report=receipt?.progress_report;
  const result={worker_id:w.worker_id,id:enrollment?.id||null,thread_bound:!!w.thread_id,acknowledged:!!receipt?.acknowledged_at,progress_reported:!!receipt?.progress_reported_at,status:report?.status||w.status,blocker:w.blocker||'',result_path:report?.result_path||null,verified_at:new Date().toISOString()};
  if(result.result_path){
   const resolved=path.resolve(result.result_path);
   if(resolved.toLowerCase().startsWith(workspace.toLowerCase()+path.sep)){
    try{const real=fs.realpathSync(resolved);if(!real.toLowerCase().startsWith(workspace.toLowerCase()+path.sep))throw Error('outside workspace');const st=fs.statSync(real);result.result_exists=true;result.is_file=st.isFile();result.modified_at=st.mtime.toISOString();result.modified_after_request=st.mtimeMs>=Date.parse(enrollment.requested_at);result.bytes=st.size;}catch(e){result.result_exists=false;result.path_check_error=e.code||e.message;}
   }else result.path_check_error='路径超出本项目，未访问';
  }
  result.verification=result.acknowledged&&result.progress_reported&&result.result_exists&&result.is_file&&result.modified_after_request?'已核对回执及本轮新产物路径':result.progress_reported?'已提交阶段结果，产物路径待核实':result.acknowledged?'已收到并开始，待阶段结果':enrollment?'消息入队，未收到回执':'已绑定，建议待回执';
  return result;
 });
 const audit={generated_at:new Date().toISOString(),notice:'仅核实主动回执、阶段上报和产物文件元数据，不读取材料正文，不代替内容质量审查或用户验收',workers};
 write(path.join(data,'connection-verification.json'),audit);return audit;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(root,'connection-audit.mjs'))console.log(JSON.stringify(auditConnections(),null,2));
