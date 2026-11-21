// Presentation only. Artifact actions still use the scoped, hash-checked endpoints.
window.ReplyPresentation={
 suggestions(turn){
  const q=turn.clarification||{},context=String(turn.request||'')+'\n'+String(q.question||'');
  const option=(label,text)=>({label,text});
  if(q.choices?.length)return [option('分别处理所选材料','请分别处理我勾选的材料，各自保留来源并交付结果，不合并不同版本。'),option('先比较再决定','请比较我勾选材料的主要差异，列出适用范围，等我确认后再继续制作最终成果。'),option('补充用途与格式','用途：〔请填写〕\n处理范围：〔请填写〕\n输出格式与篇幅：〔请填写〕')];
  if(/会议|预约|日历|free.?busy/i.test(context))return [option('填写双方空闲时间','请先寻找共同空档，不发送邀请。\n会议主题：〔请填写〕\n参会人及各自空闲时段：〔请填写〕\n日期范围、时区和时长：〔请填写〕'),option('提供日历快照','我会补充日历快照文件，上传后请先读取并检查冲突。\n会议主题与参会人：〔请填写〕\n日期范围、时区和时长：〔请填写〕\n先给候选时间，等我确认后再预约。'),option('填写已确定的安排','请按以下信息整理会议安排，先给我确认：\n主题和参会人：〔请填写〕\n日期、时间、时区和时长：〔请填写〕\n地点或会议链接：〔请填写〕\n尚未提供的信息不要代填，也不要声称已经发送邀请。')];
  if(/报销|发票|金额|报表|统计/.test(context))return [option('先整理可确认的明细','请先整理现有材料中可确认的明细，缺失字段留空，疑似重复和金额歧义单独列出，给我Excel。'),option('明确汇总口径','统计范围：〔请填写〕\n分组字段：〔请填写〕\n金额口径和币种：〔请填写〕\n退款及重复项处理：〔请填写〕'),option('先列出待核项','请先列出哪些原始记录需要我确认、有哪些选择及其对结果的影响；保留原记录，暂不猜测合并或扣减。')];
  if(/合同|审核|审查/.test(context))return [option('先检查已有材料','请先审核现有材料并保留原文依据，缺失附件和无法确认的事实单列，不代替我作最终签署决定。'),option('补充审核立场','审核立场：〔采购方／供方／中立，请选择〕\n合同类型及所处阶段：〔请填写〕\n重点关注和企业要求：〔请填写〕'),option('整理给负责人看','请用中文整理重点问题、原文位置、修改建议和待确认项，生成Word；确定事实与判断分开。')];
  if(/录音|音频|转写|字幕/.test(context))return [option('先交付已识别的内容','请保留已经取得的转写原文并生成可下载文本，标出时间范围和需回听之处；未经人工核听不要标为已校对。'),option('指定处理片段','需要处理的起止时间：〔请填写〕\n用途与关注内容：〔请填写〕\n输出格式：〔请填写〕'),option('先核对缺段','请列出已经转写、失败及未处理的时间范围，保留已有结果，只继续处理缺少的部分。')];
  return [option('先处理能够确定的部分','请先完成现有材料中能够确定的部分，保留来源和未确认项，并交付已完成成果。'),option('补充范围与格式','用途：〔请填写〕\n处理哪些材料或时间范围：〔请填写〕\n输出格式与篇幅：〔请填写〕'),option('先给我可选方案','请根据现有材料列出可执行方案，说明各自还缺哪些信息，等我选择后继续。')];
 },
 fillSuggestion(form,index){
  const button=form.querySelector('[data-decision-suggestion="'+index+'"]'),input=form.querySelector('textarea');if(!button||!input)return false;
  const suggestion=button.dataset.suggestionText,old=input.value,previous=form.dataset.lastSuggestion||'',feedback=form.querySelector('.decision-feedback');
  const next=!old.trim()||old===previous?suggestion:old.includes(suggestion)?old:old+'\n\n'+suggestion;
  if(next.length>input.maxLength){feedback.textContent='已保留你填写的内容；请先精简输入，再添加建议。';return false;}
  input.value=next;form.dataset.lastSuggestion=suggestion;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
  const blank=next.indexOf('〔请填写〕');if(blank>=0)input.setSelectionRange(blank,blank+'〔请填写〕'.length);else input.setSelectionRange(next.length,next.length);
  feedback.textContent='建议已填入，可继续编辑；点击“确认并继续”才会发送。';return true;
 },
 suggestionButtons(turn,esc){return '<div class="decision-suggestions" role="group" aria-label="建议填写方式">'+this.suggestions(turn).map((s,i)=>'<button type="button" data-decision-suggestion="'+i+'" data-suggestion-text="'+esc(s.text)+'" aria-controls="decision-details-'+esc(turn.id)+'">'+esc(s.label)+'</button>').join('')+'</div><p class="decision-hint">选一个建议填入下方，可以编辑后再发送。</p>';},
 question(turn,esc){
  const q=turn.clarification;if(!q)return '';
  if(q.state==='answered')return '<div class="decision-answered" role="status">已收到你的选择，正在后续消息中继续处理。</div>';
  if(turn.status!=='needs_input')return '';
  return `<form class="user-decision" data-decision-turn="${esc(turn.id)}" aria-label="补充处理要求"><div class="decision-heading"><span class="decision-symbol" aria-hidden="true">?</span><div><strong>需要你确认一下</strong><p>${q.choices.length?'找到多份可用材料，请选择要处理的版本，再补充用途和要求。':esc(q.question)}</p></div></div>${q.choices.length?`<fieldset><legend>处理哪些材料</legend>${q.choices.map((c,i)=>`<label class="decision-choice"><input type="checkbox" name="choice" value="${esc(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc(c.kind==='original'?'原始材料':'已有成果')} · ${esc(c.createdAt?new Date(c.createdAt).toLocaleString('zh-CN',{hour12:false}):'时间未记录')} · 候选${i+1}</small></span></label>`).join('')}</fieldset>`:''}${q.hasMore?'<p class="decision-hint">还有其他候选，可以填写文件名、日期或所属任务来缩小范围。</p>':''}${this.suggestionButtons(turn,esc)}<label class="decision-detail-label" for="decision-details-${esc(turn.id)}">${esc(q.detailLabel||'补充具体要求')}</label><textarea id="decision-details-${esc(turn.id)}" name="details" maxlength="4000" rows="2" ${q.choices.length?'':'required'} placeholder="例如：给领导看，只用本月数据，输出Word，200字以内。"></textarea><p class="decision-hint">${esc(q.detailHint||'告诉我用途、处理范围和输出格式；无需重新上传已有文件。')}</p><div class="decision-footer"><span role="status" class="decision-feedback">等待你的选择，材料和已有成果均保留。</span><button type="submit">确认并继续</button></div></form>`;
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
