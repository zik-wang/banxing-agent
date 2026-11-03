// Only structured host feedback reaches this component; provider bodies stay in audit logs.
globalThis.ModelFeedback={
 notice(t,esc){
  const recover=t.canRecoverDelivery?`<button class="retry" data-recover-delivery="${esc(t.id)}">核对并取回文件</button>`:'';
  if(t.businessState?.reportGenerated&&!t.serviceFailure&&!t.error&&t.termination?.reason==='contract_review_partial')return `<section class="run-notice report-open-questions" role="status"><strong>报告已生成，具体事项待核</strong><p>${t.businessState.reason==='model_disagreement'?'本次必审步骤已有执行记录，两路风险信号仍存在分歧，双方依据及解释空间均已保留。':'已有发现及处理范围见下方报告。'+(t.businessState.executionCoverage?.uninspected?.length?'仍有 '+esc(t.businessState.executionCoverage.uninspected.length)+' 项检查未完成。':'')}请按原文依据及报告列出的具体材料缺口或业务问题核实；本状态不代表合同可签。</p></section>`;
  if(t.materialDiagnostics?.some(d=>d.blocked))return `<section class="run-notice material-input-notice" role="status"><strong>文件需要重新保存后上传</strong><p>已检查文件结构，继续尝试相同文件不会解决问题。具体原因和保存办法见下方。</p><button type="button" class="retry" data-replace-material="${esc(t.id)}">上传修正后的文件</button></section>`;
  const f=t.serviceFailure;
  if(!f)return `<div class="run-notice"><p>${esc(t.error||t.termination?.error?.message||'已有材料、执行记录和成果已保留。')}</p>${t.canResume?`<button class="retry" data-retry="${esc(t.id)}">继续未完成的部分</button>`:''}${recover}</div>`;
  return `<section class="run-notice model-service-notice" role="status" aria-live="polite"><strong>${esc(f.title)}</strong><p>${esc(f.message)}</p><p>${esc(f.action)}${f.retryAfterSeconds?' 服务端建议自错误返回起至少等待 '+esc(f.retryAfterSeconds)+' 秒。':''}</p><small>${t.artifacts?.length?'已验证的文件仍可在下方下载；本轮任务尚未全部完成。':'材料与执行记录已保留，无需重复上传。'} 不会自动连续重试。</small>${t.canResume?`<button class="retry" data-retry="${esc(t.id)}">手动继续未完成部分</button>`:''}${recover}<details class="model-error-details"><summary>技术详情</summary><span>${esc([f.httpStatus?'HTTP '+f.httpStatus:'',f.requestId?'请求 '+f.requestId:''].filter(Boolean).join(' · ')||f.kind)}</span></details></section>`;
 },
 waiting(t,esc){
  const p=t.progress?.modelRequest;
  if(t.status!=='running'||!p||p.elapsedMs<15000)return '';
  const seconds=Math.floor(p.elapsedMs/1000),elapsed=seconds>=60?Math.floor(seconds/60)+'分'+(seconds%60)+'秒':seconds+'秒';
  return `<p class="model-waiting" role="status" aria-live="polite">${esc(p.provider==='intranet'?'正在等待内网模型响应':'正在等待公网模型响应')} · 本次请求已等待 ${esc(elapsed)}。暂未收到完整回复，可用下方“停止”结束等待。</p>`;
 }
};
