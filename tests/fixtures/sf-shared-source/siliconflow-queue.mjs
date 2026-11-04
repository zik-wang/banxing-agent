import crypto from 'node:crypto';
import {policy} from './control.mjs';
export class SiliconflowQueue {
 constructor({load=()=>null,save=()=>{},now=Date.now,gapMs=60000,staleMs=90000,requiredDrainWorkers=[],allowed=()=>!policy().paused}={}){
  this.now=now;this.save=save;this.gapMs=gapMs;this.staleMs=staleMs;this.allowed=allowed;
  this.requiredDrainWorkers=requiredDrainWorkers;this.s=load()||{active:null,waiting:[],next_allowed_at:0,rate_limit_streak:0};this.s.drained??={};
 }
 commit(){this.save(this.s);}
 status(){const n=this.now();return {provider:'siliconflow',max_concurrency:1,gap_ms:this.gapMs,dispatch_allowed:this.allowed(),granted_total:this.s.granted_total||0,released_total:this.s.released_total||0,last_grant:this.s.last_grant||null,awaiting_drain_workers:this.requiredDrainWorkers.filter(w=>!this.s.drained[w]),drained_workers:Object.keys(this.s.drained),active:this.s.active?{worker_id:this.s.active.worker_id,label:this.s.active.label,started_at:this.s.active.started_at,heartbeat_at:this.s.active.last_seen_at,freshness:n-this.s.active.last_seen_at>this.staleMs?'状态待核实（保留占用，禁止自动抢占）':'租约心跳正常；实际进度看worker上报'}:null,waiting:this.s.waiting.map((r,i)=>({worker_id:r.worker_id,label:r.label,position:i+1,queued_at:r.queued_at})),next_allowed_at:this.s.next_allowed_at,cooldown_remaining_ms:Math.max(0,this.s.next_allowed_at-n),rate_limit_streak:this.s.rate_limit_streak};}
 act(action,body){
  const n=this.now(),s=this.s,worker=body.worker_id;
  if(action==='drained'){s.drained[worker]=n;this.commit();return {ok:true,...this.status()};}
  if(action==='cooldown'){
   const supplied=Number(body.retry_after_seconds||0);if(!Number.isFinite(supplied)||supplied<0)throw Error('invalid Retry-After seconds');
   s.rate_limit_streak=Math.min(6,s.rate_limit_streak+1);
   const delay=Math.max(this.gapMs,Math.min(3600000,supplied*1000),Math.min(900000,60000*2**(s.rate_limit_streak-1)));
   s.next_allowed_at=Math.max(s.next_allowed_at,n+delay);this.commit();return {ok:true,...this.status()};
  }
  if(action==='acquire'){
   if(!this.allowed())return {ok:false,paused:true,...this.status()};
   if(typeof body.request_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.request_id))throw Error('valid request_id required');
   if(body.label!==undefined&&(typeof body.label!=='string'||body.label.length>120))throw Error('label max 120 chars; metadata only');
   s.waiting=s.waiting.filter(r=>n-r.last_seen_at<=this.staleMs);
   if(s.active?.request_id===body.request_id){if(s.active.worker_id!==worker)throw Error('request owner mismatch');s.active.last_seen_at=n;this.commit();return {ok:true,granted:true,lease_id:s.active.lease_id,...this.status()};}
   let r=s.waiting.find(r=>r.request_id===body.request_id);
   if(r&&r.worker_id!==worker)throw Error('request owner mismatch');
   if(!r){if(s.waiting.length>=100)throw Error('queue full');r={worker_id:worker,request_id:body.request_id,label:body.label||'待调用任务',queued_at:n,last_seen_at:n};s.waiting.push(r);}else r.last_seen_at=n;
   // Only the polling head may claim the slot: a status GET never grants an abandoned job.
   if(!s.active&&n>=s.next_allowed_at&&!this.status().awaiting_drain_workers.length&&s.waiting[0]===r){s.waiting.shift();s.active={...r,started_at:n,lease_id:crypto.randomUUID()};s.granted_total=(s.granted_total||0)+1;s.last_grant={worker_id:worker,at:n};this.commit();return {ok:true,granted:true,lease_id:s.active.lease_id,...this.status()};}
   this.commit();return {ok:true,granted:false,position:s.waiting.indexOf(r)+1,...this.status()};
  }
  if(action==='cancel'){
   const r=s.waiting.find(r=>r.request_id===body.request_id);if(r&&r.worker_id!==worker)throw Error('request owner mismatch');
   s.waiting=s.waiting.filter(r=>r.request_id!==body.request_id);this.commit();return {ok:true,...this.status()};
  }
  if(!s.active||s.active.worker_id!==worker||s.active.lease_id!==body.lease_id)throw Error('active lease owner mismatch');
  if(action==='heartbeat'){s.active.last_seen_at=n;this.commit();return {ok:true,...this.status()};}
  if(action==='release'){
   if(!['ok','error','rate_limited'].includes(body.outcome||'ok'))throw Error('invalid outcome');
   if(body.outcome==='rate_limited')this.act('cooldown',body);
   else if(body.outcome==='ok')s.rate_limit_streak=0;
   s.active=null;s.released_total=(s.released_total||0)+1;s.next_allowed_at=Math.max(s.next_allowed_at,n+this.gapMs);this.commit();return {ok:true,...this.status()};
  }
  throw Error('unknown slot action');
 }
}
