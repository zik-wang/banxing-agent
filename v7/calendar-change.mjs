import {atomic,digest,validateEvent,conflict} from './calendar-provider.mjs';
export const changeHash=o=>digest({kind:o.kind,providerEventId:o.providerEventId,expectedRevision:o.expectedRevision,event:o.event});
const equal=(a,b)=>a.title===b.title&&Date.parse(a.start)===Date.parse(b.start)&&Date.parse(a.end)===Date.parse(b.end)&&(a.location||'')===(b.location||'')&&(a.description||'')===(b.description||'');
export async function applyCalendarChange(provider,file,state,op){
 if(!['update','delete'].includes(op.kind))throw Error('不是有效的日程修改操作');
 if(op.status==='verified')return {operation:op,idempotent:true};
 if(!['approved','updating','deleting','uncertain'].includes(op.status)||!op.approvedAt||op.approvedHash!==changeHash(op))throw Error('用户尚未确认或授权内容已变化');
 if(Date.now()-Date.parse(op.approvedAt)>15*60000)throw Error('授权已过期，请重新查看并确认');
 const save=()=>atomic(file,state),calendarId=op.event.calendarId;let actual;
 try{actual=await provider.get(calendarId,op.providerEventId);}catch(error){if(op.kind==='delete'&&op.attemptedAt&&/事件不存在/.test(error.message)){Object.assign(op,{status:'verified',verifiedAt:new Date().toISOString(),actual:null,lastError:null});save();return {operation:op,readbackVerified:true};}throw error;}
 if(op.kind==='update'&&op.attemptedAt&&equal(actual,op.event)){Object.assign(op,{status:'verified',actual,verifiedAt:new Date().toISOString(),lastError:null});save();return {operation:op,readbackVerified:true};}
 if(!op.expectedRevision||actual.etag!==op.expectedRevision)throw Error('事件已被其他操作修改，请重新读取并确认');
 if(op.kind==='update'){const event=validateEvent(op.event),list=await provider.list(calendarId,event.start,event.end);if(!list.complete)throw Error('日历查询不完整');if(conflict(list.events.filter(e=>e.id!==op.providerEventId),event).length)throw Error('新时段存在冲突，请重新选择');}
 op.status=op.kind==='delete'?'deleting':'updating';op.attemptedAt||=new Date().toISOString();save();
 try{if(op.kind==='delete'){await provider.remove(calendarId,op.providerEventId,op.expectedRevision);let absent=false;try{await provider.get(calendarId,op.providerEventId);}catch(e){if(/事件不存在/.test(e.message))absent=true;else throw e;}if(!absent)throw Error('删除后事件仍存在');actual=null;}else{await provider.update(op.event,op.providerEventId,op.expectedRevision);actual=await provider.get(calendarId,op.providerEventId);if(!equal(actual,op.event))throw Error('改期后的回读不一致');}
  Object.assign(op,{status:'verified',actual,lastError:null,verifiedAt:new Date().toISOString()});save();return {operation:op,readbackVerified:true};
 }catch(error){op.status='uncertain';op.lastError=error.message;save();throw error;}
}
