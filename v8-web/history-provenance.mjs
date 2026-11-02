// Host metadata travels with the retained content, rather than the branch's last mode.
export function turnProvenance(conversation,turn,lookup=()=>null,trail=new Set()) {
 const key=conversation.id+':'+turn.id;
 if(trail.has(key))return [{conversationId:conversation.id,turnId:turn.id,origin:'unknown'}];
 trail.add(key);
 const own=turn.historyProvenance;
 const mode=own?.origin||turn.modelConnection?.mode;
 const sources=[];
 if(['intranet','cloud','host'].includes(mode))sources.push({conversationId:conversation.id,turnId:turn.id,origin:mode});
 else if(turn.hostControl&&!turn.artifacts?.length&&!turn.meetingId)sources.push({conversationId:conversation.id,turnId:turn.id,origin:'host'});
 else if(turn.inheritedFrom||turn.inherited&&conversation.branch){
  const ref=turn.inheritedFrom||{conversationId:conversation.branch.conversationId,turnId:turn.id},parent=lookup(ref.conversationId),original=parent?.turns.find(t=>t.id===ref.turnId);
  if(original)sources.push(...turnProvenance(parent,original,lookup,trail));
  else sources.push({conversationId:conversation.id,turnId:turn.id,origin:'unknown'});
 }else sources.push({conversationId:conversation.id,turnId:turn.id,origin:conversation.networkOrigin==='intranet'?'intranet':'unknown'});
 for(const d of own?.dependencies||[])sources.push({...d,origin:['intranet','cloud','host'].includes(d.origin)?d.origin:'unknown'});
 return sources;
}
export function retainedProvenance(c,turns=c.turns,lookup) {
 const sources=turns.filter(t=>!!(t.request||t.answer||t.artifacts?.length)).flatMap(t=>turnProvenance(c,t,lookup));
 return [...new Map(sources.map(s=>[s.conversationId+':'+s.turnId+':'+s.origin,s])).values()];
}
export function provenanceBlocked(sources){return sources.some(s=>!['cloud','host'].includes(s.origin));}
