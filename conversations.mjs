import {id,now,text} from './core.mjs';
export function initConversations(store){
 const s=store.state;s.conversations||=[];if(!s.conversations.length)s.conversations.push({id:id(),title:'原有对话',createdAt:now()});
 for(const r of s.runs)if(!r.conversationId)r.conversationId=s.conversations[0].id;
 store.save();
}
export function createConversation(store){const limit=store.productExperience?200:30;if(store.state.conversations.length>=limit)throw Error('已达到'+limit+'个对话上限，请先整理历史记录');const c={id:id(),title:'新对话',createdAt:now()};store.state.conversations.unshift(c);store.save();return c;}
export function resolveConversation(store,value){if(!store.state.conversations)initConversations(store);const c=store.state.conversations.find(c=>c.id===(value||store.state.conversations[0]?.id));if(!c)throw Error('对话已不存在，请新建对话');return c;}
export function deleteConversation(store,harness,value){
 const c=resolveConversation(store,text(value,100)),runs=store.state.runs.filter(r=>r.conversationId===c.id),ids=new Set(runs.map(r=>r.id));
 if(runs.some(r=>harness.active.has(r.id)))throw Error('此对话仍在处理，请先停止再删除');
 store.state.runs=store.state.runs.filter(r=>!ids.has(r.id));store.state.approvals=store.state.approvals.filter(a=>!ids.has(a.runId)||a.status==='approved');
 store.state.conversations=store.state.conversations.filter(x=>x.id!==c.id);if(!store.state.conversations.length)createConversation(store);store.save();return {deleted:c.id,conversation:store.state.conversations[0]};
}
