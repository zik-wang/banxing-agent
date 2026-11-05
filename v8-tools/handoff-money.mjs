import {digest} from './resource-space.mjs';
import {decodeSource} from './file-types.mjs';
import {calculateMoney} from './money-calculator.mjs';

// Read only the settled worker's checkpoint, never a global/latest result.
// Missing/legacy/unsupported evidence remains unverified, not a guessed receipt.
export function handoffMoney(space,{projectId,workItemId,runId,turnId,request,refs}) {
 const missing=code=>({version:1,state:'unverified',issues:[code],receipts:[]});
 if(!runId)return missing('WORKER_RUN_UNAVAILABLE');
 try {
  const state=space.load(),run=state.runs[runId],key=r=>r.resourceId+':'+r.revisionId;
  if(!run||run.projectId!==projectId||run.workItemId!==workItemId||run.snapshot.interactionId!==turnId||run.snapshot.userRequest!==request)throw Error('WORKER_SCOPE_MISMATCH');
  const allowed=new Set(),visit=ref=>{if(allowed.has(key(ref)))return;const v=space.check(projectId,ref);allowed.add(key(ref));for(const p of v.parents||[])visit(p);};refs.forEach(visit);
  if((run.snapshot.selected||[]).some(r=>!allowed.has(key(r))))throw Error('WORKER_SELECTION_MISMATCH');
  const cp=space.check(projectId,run.checkpoint);
  if(cp.metadata.producerRunId!==runId||state.resources[run.checkpoint.resourceId]?.workItemId!==workItemId)throw Error('CHECKPOINT_PRODUCER_MISMATCH');
  const bundle=JSON.parse(space.read(projectId,run.checkpoint)),items=(bundle.results||[]).filter(r=>r.method==='money_calculation');
  if(!items.length)return missing('NO_MONEY_RECEIPT');
  if(items.length>20)throw Error('MONEY_RECEIPT_LIMIT');
  const receipts=items.map(item=>{
   const operations=Object.values(state.operations).filter(o=>o.rootId===run.rootId&&o.tool==='calculate_money'&&o.status==='complete'&&o.attempts?.some(a=>a.runId===runId)&&o.result?.resultId===item.resultId);
   if(operations.length!==1)throw Error('MONEY_OPERATION_BINDING_MISMATCH');
   const op=operations[0],{asset_ids,...plan}=op.args;
   if(!Array.isArray(asset_ids)||!asset_ids.length)throw Error('MONEY_PLAN_SOURCE_MISSING');
   let source='';const sources=[];
   for(const id of [...new Set(asset_ids)]){
    const a=bundle.assets?.find(a=>a.record.id===id);
    if(!a||!allowed.has(key(a.ref)))throw Error('MONEY_SOURCE_OUTSIDE_ROUTE');
    const v=space.check(projectId,a.ref),bytes=space.read(projectId,a.ref);
    if(v.hash!==a.record.sha256)throw Error('MONEY_SOURCE_HASH_MISMATCH');
    if(a.record.kind!=='text')throw Error('MONEY_REVIEW_READER_UNSUPPORTED');
    source+=decodeSource(bytes).text+'\n';sources.push({assetId:id,sha256:v.hash,ref:a.ref});
   }
   const computed=calculateMoney(source,plan),expected={...computed,sources:sources.map(({ref,...s})=>s),resultId:computed.receiptId};
   if(digest(expected)!==digest(item.moneyReceipt)||digest(expected)!==digest(op.result))throw Error('MONEY_RECEIPT_OR_PLAN_CHANGED');
   const binding={runId,turnId,projectId,workItemId,requestSha256:digest(request),operationId:op.operationId,checkpoint:run.checkpoint,sources,plan};
   return {binding,receipt:expected,digests:{algorithm:'sha256',encoding:'utf8',serialization:'JSON.stringify-v1',normalization:'none',sourceComposition:'decoded source text in unique asset_ids order, each followed by LF; identical to MoneyTools',spanUnit:'utf16_code_units',sourceFileHashes:'SHA256 of original file bytes; not comparable with sourceJsonString',sourceJsonString:computed.sourceSha256,planJson:computed.planSha256,receiptJson:digest(expected),bindingJson:digest(binding)}};
  });
  return {version:1,state:'source_and_arithmetic_bound',issues:[],receipts,semanticCorrectnessProven:false};
 }catch(e){return missing(e.code||e.message);}
}
