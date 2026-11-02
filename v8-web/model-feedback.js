// Only structured host feedback reaches this component; provider bodies stay in audit logs.
globalThis.ModelFeedback={
 notice(t,esc){
  const f=t.serviceFailure;
  if(!f)return `<div class="run-notice"><p>${esc(t.error||t.termination?.error?.message||'已有材料、执行记录和成果已保留。')}</p>${t.canResume?`<button class="retry" data-retry="${esc(t.id)}">继续未完成的部分</button>`:''}</div>`;
  return `<section class="run-notice model-service-notice" role="status" aria-live="polite"><strong>${esc(f.title)}</strong><p>${esc(f.message)}</p><p>${esc(f.action)}${f.retryAfterSeconds?' 服务端建议自错误返回起至少等待 '+esc(f.retryAfterSeconds)+' 秒。':''}</p><small>${t.artifacts?.length?'已验证的文件仍可在下方下载；本轮任务尚未全部完成。':'材料与执行记录已保留，无需重复上传。'} 不会自动连续重试。</small>${t.canResume?`<button class="retry" data-retry="${esc(t.id)}">手动继续未完成部分</button>`:''}<details class="model-error-details"><summary>技术详情</summary><span>${esc([f.httpStatus?'HTTP '+f.httpStatus:'',f.requestId?'请求 '+f.requestId:''].filter(Boolean).join(' · ')||f.kind)}</span></details></section>`;
 },
 waiting(t,esc){
  const p=t.progress?.modelRequest;
  if(t.status!=='running'||!p||p.elapsedMs<15000)return '';
  const seconds=Math.floor(p.elapsedMs/1000),elapsed=seconds>=60?Math.floor(seconds/60)+'分'+(seconds%60)+'秒':seconds+'秒';
  return `<p class="model-waiting" role="status" aria-live="polite">${esc(p.provider==='intranet'?'正在等待内网模型响应':'正在等待公网模型响应')} · 本次请求已等待 ${esc(elapsed)}。暂未收到完整回复，可用下方“停止”结束等待。</p>`;
 }
};
