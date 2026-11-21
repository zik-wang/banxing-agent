// Opening a composer is navigation. Only an explicit content action saves a chat.
const draftViews=new Map(),draftPromises=new Map(),draftTargets=new Map(),lastBotConversation=new Map();
function isDraftConversation(id){return typeof id==='string'&&id.startsWith('draft-');}
function openDraft(botId){
 const bot=botOptions.find(b=>b.id===botId&&b.enabled);if(!bot)throw Error('这个助理不存在或已停用');
 if(viewState==='ready'&&data&&!data.group&&data.bot.id===botId&&!data.turns.length&&!data.files.length){$('#message').focus();closeSidebar(false);return;}
 let draft=draftViews.get(botId);if(!draft){draft={id:'draft-'+crypto.randomUUID(),bot:{...bot},files:[],turns:[],group:null,currentResult:null};draftViews.set(botId,draft);}
 beginView(draft.id,'ready');selectedBotId=botId;$('#bot-select').value=botId;data=draft;selected=selections.get(current)||new Set();selections.set(current,selected);
 localStorage.setItem('v8-current','new:'+botId);history.replaceState(null,'','#new:'+botId);render();showList();closeSidebar(false);$('#message').focus();
}
async function activateBot(botId){
 if(viewState!=='ready')return;
 if(data&&!data.group&&data.bot.id===botId){$('#message').focus();closeSidebar(false);return;}
 const draft=draftViews.get(botId);if(draft&&drafts.get(draft.id)?.trim())return fresh(botId);
 const chats=list.filter(c=>c.kind!=='group'&&(c.botId||'general')===botId),remembered=chats.find(c=>c.id===lastBotConversation.get(botId)),previous=chats.find(c=>c.running)||remembered||chats.at(-1);
 return previous?open(previous.id):fresh(botId);
}
async function ensureConversation(id=current){
 if(!isDraftConversation(id))return id;if(draftTargets.has(id))return draftTargets.get(id);if(draftPromises.has(id))return draftPromises.get(id);
 const entry=[...draftViews.entries()].find(([,v])=>v.id===id);if(!entry)throw Error('输入草稿已切换，请重新打开需要的助理');const [botId,view]=entry;
 const promise=(async()=>{try{
  const saved=await api('/api/conversations',{method:'POST',body:JSON.stringify({botId,clientRequestId:id})});draftTargets.set(id,saved.id);
  if(current===id)saveDraft();for(const map of [drafts,failedSends,notices,selections,uploads])if(map.has(id)){map.set(saved.id,map.get(id));map.delete(id);}if(sending.delete(id))sending.add(saved.id);
  if(draftViews.get(botId)===view)draftViews.delete(botId);lastBotConversation.set(botId,saved.id);
  if(current===id){current=saved.id;data=saved;selected=selections.get(saved.id)||new Set();selections.set(saved.id,selected);localStorage.setItem('v8-current',saved.id);history.replaceState(null,'','#'+saved.id);render();showList();}
  return saved.id;
 }finally{draftPromises.delete(id);}})();draftPromises.set(id,promise);return promise;
}
