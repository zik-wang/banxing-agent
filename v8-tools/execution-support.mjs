import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ReceiptProgress} from './receipt-progress.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const string=(max=200)=>({type:'string',minLength:1,maxLength:max});
const integer=(max)=>({type:'integer',minimum:0,maximum:max});
const metaTools=new Set(['update_plan','get_execution_state','read_tool_receipt','discover_tools']);
export const executionScope=({request,sources,scope})=>hash(JSON.stringify({request,sources:sources.map(a=>[a.id,a.sha256]).sort(),scope:scope||null}));

function writeAtomic(file,value){
 const tmp=file+'.'+randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value),{flag:'wx'});
 try{fs.renameSync(tmp,file);}catch(error){fs.unlinkSync(tmp);throw error;}
}

// Only receipts already returned by this authorized execution are recoverable.
// Tool arguments cannot choose a directory or enlarge the source scope.
export class ExecutionSupport{
 constructor({directory,scopeKey,snapshot=()=>({}),authorize=()=>{},canRecover=()=>true}){
  if(!/^[a-f0-9]{64}$/.test(scopeKey))throw Error('Host execution scope is required');
  this.scopeKey=scopeKey;this.snapshot=snapshot;this.authorize=authorize;this.canRecover=canRecover;
  this.directory=path.join(path.resolve(directory),'execution-support',scopeKey);
  this.receiptDirectory=path.join(this.directory,'receipts');fs.mkdirSync(this.receiptDirectory,{recursive:true});
  this.planFile=path.join(this.directory,'plan.json');
  this.progress=new ReceiptProgress(this.directory,scopeKey);
  this.plan=fs.existsSync(this.planFile)?JSON.parse(fs.readFileSync(this.planFile,'utf8')):{version:0,steps:[],explanation:''};
  if(this.plan.scopeKey&&this.plan.scopeKey!==scopeKey)fail('PLAN_SCOPE_CHANGED','Saved plan belongs to a different authorized execution scope');
 }
 receipt(callId){
  this.authorize();
  if(!this.canRecover())fail('LOCAL_ONLY_RESULT','Historical content in this run is local-only; it cannot be recovered into planner context');
  if(!/^[a-f0-9-]{36}$/.test(callId||''))fail('UNKNOWN_TOOL_RECEIPT','Use a callId actually returned in this execution');
  const file=path.join(this.receiptDirectory,callId+'.json');
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())fail('UNKNOWN_TOOL_RECEIPT','Receipt is unavailable in the current authorized execution scope');
  const stored=JSON.parse(fs.readFileSync(file,'utf8'));
  if(stored.scopeKey!==this.scopeKey||hash(JSON.stringify(stored.receipt))!==stored.sha256||stored.receipt.callId!==callId)fail('TOOL_RECEIPT_CHANGED','Saved receipt integrity check failed');
  return stored;
 }
 observe(result){
  if(!/^[a-f0-9-]{36}$/.test(result.callId||''))fail('INVALID_TOOL_RECEIPT','Host-generated callId is required');
  const receipt=structuredClone(result),file=path.join(this.receiptDirectory,result.callId+'.json');
  fs.writeFileSync(file,JSON.stringify({scopeKey:this.scopeKey,sha256:hash(JSON.stringify(receipt)),receipt}),{flag:'wx'});
 }
 read({call_id,pointer='',offset=0,length=6000,query}){
  const stored=this.receipt(call_id);let value=stored.receipt;
  if(pointer){
   if(!pointer.startsWith('/')||/~(?![01])/u.test(pointer))fail('INVALID_RECEIPT_POINTER','Use an RFC6901 pointer within the saved tool receipt');
   for(const segment of pointer.slice(1).split('/')){const key=segment.replaceAll('~1','/').replaceAll('~0','~');
    if(!value||typeof value!=='object'||!Object.hasOwn(value,key))fail('INVALID_RECEIPT_POINTER','Pointer does not exist in the saved receipt');
    value=value[key];
   }
  }
  const text=typeof value==='string'?value:JSON.stringify(value);let start=Math.min(offset,text.length);
  if(query){start=text.indexOf(query,offset);if(start<0)return{callId:call_id,pointer,matched:false,totalChars:text.length,nextOffset:null,historicalReceipt:true};}
  const end=Math.min(start+length,text.length),recoveryProgress=this.progress.record({callId:call_id,pointer,receiptSha256:stored.sha256,start,end,totalChars:text.length});
  return{callId:call_id,tool:stored.receipt.tool,receiptSha256:stored.sha256,pointer,text:text.slice(start,end),start,end,totalChars:text.length,nextOffset:end<text.length?end:null,recoveryProgress,historicalReceipt:true,contentVerified:false,note:recoveryProgress.repeatedRange?'This historical slice was already returned. Its bytes are unchanged. Use recoveryProgress.nextUnreadOffset for an unread slice, a narrower pointer/query, or finish from available evidence; do not restart whole-receipt pagination to repair arguments.':'Recovered prior tool output; cursor progress tracks returned receipt text, not source coverage or semantic correctness.'};
 }
 recoveryHint(receipt){
  this.authorize();if(!this.canRecover())return null;
  const d=receipt.data||{},target=receipt.contextReceipt?.retrieve?.arguments||(receipt.tool==='read_tool_receipt'&&d.historicalReceipt?{call_id:d.callId,pointer:d.pointer||''}:{call_id:receipt.callId,pointer:typeof d.text==='string'?'/data/text':''});
  const view=this.progress.get(target.call_id,target.pointer||'');if(!view)return null;
  return{arguments:{call_id:target.call_id,...(target.pointer?{pointer:target.pointer}:{}),offset:view.nextUnreadOffset??view.totalChars},progress:{...view,note:'Returned receipt-text ranges only; not source or business completeness. At end, no unread historical text remains. Explicit offsets may still reread any authorized range.'}};
 }
 update({steps,explanation='',expected_version}){
  this.authorize();
  if(expected_version!==undefined&&expected_version!==this.plan.version)fail('PLAN_VERSION_CHANGED','Read get_execution_state and update the current plan version');
  if(new Set(steps.map(s=>s.id)).size!==steps.length||steps.filter(s=>s.status==='in_progress').length>1)fail('INVALID_PLAN','Step IDs must be unique, with at most one in_progress step');
  for(const step of steps){
   if(step.status==='completed'&&!step.evidence_call_ids?.length)fail('PLAN_EVIDENCE_REQUIRED','Completed steps require actual successful business tool callIds');
   for(const id of step.evidence_call_ids||[]){const r=this.receipt(id).receipt;if(r.status!=='ok'||metaTools.has(r.tool))fail('PLAN_EVIDENCE_REQUIRED','Discovery, plan updates, historical receipt retrieval and failed calls cannot prove a completed business step');}
  }
  const value={steps,explanation};
  if(JSON.stringify(value)===JSON.stringify({steps:this.plan.steps,explanation:this.plan.explanation}))return{...this.plan,metaOnly:true,recoveredReceipt:true};
  const plan={...value,version:this.plan.version+1,scopeKey:this.scopeKey,contentVerified:false};writeAtomic(this.planFile,plan);this.plan=plan;
  return{...plan,metaOnly:true,note:'Plan status is model-declared and tied to real tool receipts; it does not certify business correctness.'};
 }
 state({include_recent=true}={}){
  this.authorize();
  const snapshot={...this.snapshot()};
  if(!include_recent)delete snapshot.recentCalls;
  return{plan:this.plan,...snapshot,receiptRecovery:this.canRecover()?this.progress.list():[],scopeKey:this.scopeKey,metaOnly:true,contentVerified:false,note:'Current host state and saved work; receipt recovery ranges are pagination control state, not source/business completeness.'};
 }
 tools(){return[
  {name:'update_plan',description:'Persist a short execution plan for multi-step tasks. Use pending/in_progress/completed; only one step may be in_progress. Completed steps require successful business tool callIds, never invented evidence. Does not certify semantic correctness.',inputSchema:object({steps:{type:'array',minItems:1,maxItems:12,items:object({id:string(60),step:string(400),status:{...string(),enum:['pending','in_progress','completed']},evidence_call_ids:{type:'array',maxItems:20,items:string(36)}},['id','step','status'])},explanation:{type:'string',maxLength:1000},expected_version:integer(1000000)},['steps']),execute:a=>this.update(a)},
  {name:'get_execution_state',description:'Recover current persisted plan, host counters, recent failures and saved work references. Set include_recent=true to include recent tool calls, false for a smaller state. Use after interruption; does not reread originals or create business results.',inputSchema:object({include_recent:{type:'boolean'}}),execute:a=>this.state(a)},
  {name:'read_tool_receipt',description:'Recover a prior tool result by its actual callId, including content compacted from model history. Optional RFC6901 pointer, literal query and pagination avoid rereading sources. Access stays within the current host-owned execution scope; old output is not new evidence.',inputSchema:object({call_id:string(36),pointer:{type:'string',maxLength:1000},offset:integer(10000000),length:{type:'integer',minimum:1,maximum:12000},query:string(300)},['call_id']),execute:a=>this.read(a)}
 ];}
}
