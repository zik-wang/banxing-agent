// Presentation only. Artifact actions still use the scoped, hash-checked endpoints.
window.ReplyPresentation={
 question(turn,esc){
  const q=turn.clarification;if(!q)return '';
  if(q.state==='answered')return '<div class="decision-answered" role="status">已收到你的选择，正在后续消息中继续处理。</div>';
  if(turn.status!=='needs_input')return '';
  return `<form class="user-decision" data-decision-turn="${esc(turn.id)}" aria-label="补充处理要求"><div class="decision-heading"><span class="decision-symbol" aria-hidden="true">?</span><div><strong>需要你确认一下</strong><p>${q.choices.length?'找到多份可用材料，请选择要处理的版本，再补充用途和要求。':esc(q.question)}</p></div></div>${q.choices.length?`<fieldset><legend>处理哪些材料</legend>${q.choices.map((c,i)=>`<label class="decision-choice"><input type="checkbox" name="choice" value="${esc(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc(c.kind==='original'?'原始材料':'已有成果')} · ${esc(c.createdAt?new Date(c.createdAt).toLocaleString('zh-CN',{hour12:false}):'时间未记录')} · 候选${i+1}</small></span></label>`).join('')}</fieldset>`:''}${q.hasMore?'<p class="decision-hint">还有其他候选，可以填写文件名、日期或所属任务来缩小范围。</p>':''}<label class="decision-detail-label" for="decision-details-${esc(turn.id)}">${esc(q.detailLabel||'补充具体要求')}</label><textarea id="decision-details-${esc(turn.id)}" name="details" maxlength="4000" rows="2" ${q.choices.length?'':'required'} placeholder="例如：给领导看，只用本月数据，输出Word，200字以内。"></textarea><p class="decision-hint">${esc(q.detailHint||'告诉我用途、处理范围和输出格式；无需重新上传已有文件。')}</p><div class="decision-footer"><span role="status" class="decision-feedback">等待你的选择，材料和已有成果均保留。</span><button type="submit">确认并继续</button></div></form>`;
 },
 body(turn,render,esc,fallback){
  if(turn.status==='needs_input'&&turn.clarification?.state==='pending')return '';
  const p=turn.presentation;
  if(p?.kind!=='statistics')return '<div class="message-body reply-body">'+render(p?.text??fallback)+'</div>';
  return '<div class="message-body reply-body readable-reply"><p>'+esc(p.lead)+'</p><dl class="reply-facts">'+p.facts.map(f=>'<div'+(f.emphasis?' class="reply-fact-main"':'')+'><dt>'+esc(f.label)+'</dt><dd>'+esc(f.value)+'</dd></div>').join('')+'</dl>'+(p.notes.length?'<div class="reply-notes"><strong>待核事项</strong><ul>'+p.notes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></div>':'')+'<p class="reply-caveat">'+esc(p.caveat)+'</p></div>';
 },
 technical(turn,esc){
  const t=turn.presentation?.technical;
  if(!t)return '';
  return '<details class="technical-receipt"><summary>技术回执与核对依据</summary><p>保留原始统计、文件编号和校验信息供追查。模型原答如有保留，不代表其中每项判断已经核实。</p><pre>'+esc(JSON.stringify(t,null,2))+'</pre></details>';
 }
};
