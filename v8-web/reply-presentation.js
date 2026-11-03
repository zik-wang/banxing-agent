// Presentation only. Artifact actions still use the scoped, hash-checked endpoints.
window.ReplyPresentation={
 body(turn,render,esc,fallback){
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
