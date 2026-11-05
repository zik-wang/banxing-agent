const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无上报';
const labels={todo:'待办',running:'进行中',blocked:'阻塞',done:'worker 汇报完成（待用户验收）'};
const reviewBox=document.createElement('aside');reviewBox.id='supervision';$('inspection').insertAdjacentElement('afterend',reviewBox);
const sfBox=document.createElement('aside');sfBox.id='siliconflow';reviewBox.insertAdjacentElement('afterend',sfBox);
function worker(w){return `<div class="worker"><h3><code>${esc(w.worker_id)}</code></h3><p><span class="tag ${w.freshness==='状态待核实'?'warn':''}">${esc(w.freshness)}</span><span class="tag">${esc(labels[w.status]||'未开始上报')}</span></p><p>当前阶段：${esc(w.stage||'—')}</p><p>下一步：${esc(w.next_step||'—')}</p><p class="${w.blocker?'warn':''}">阻塞：${esc(w.blocker||'无上报')}</p><p>产物位置：<code>${esc(w.result_path||'—')}</code></p><p class="muted">更新时间：${esc(date(w.updated_at))}</p></div>`;}
let busy=false;
async function refresh(){if(busy)return;busy=true;try{
 const r=await fetch('/api/state',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error(r.status);const s=await r.json();
 const ws=s.workers,connected=ws.filter(w=>w.connected).length;
 $('stats').innerHTML=[[s.tasks.length,'真实任务'],[`${connected} / ${ws.length}`,'worker 已接入'],[ws.filter(w=>w.reports.some(r=>r.status==='blocked')).length,'有阻塞上报的窗口'],[s.tasks.filter(t=>t.acceptance.accepted).length,'用户验收通过']].map(([n,l])=>`<div class="stat"><b>${n}</b>${l}</div>`).join('');
 $('sessions').innerHTML=ws.map(w=>`<article class="worker"><h3><code>${esc(w.worker_id)}</code></h3><p><span class="tag ${w.freshness==='状态待核实'?'warn':''}">${esc(w.freshness)}</span></p><p>消息通道：${w.thread_id?'已绑定原聊天':'待下次上报绑定'}</p><p>接入验证：${esc(s.connection_verification?.workers.find(v=>v.worker_id===w.worker_id)?.verification||(w.onboarding_receipt?.progress_reported_at?'已提交阶段结果，待核查':w.onboarding_receipt?.acknowledged_at?'已收到并开始，待阶段结果':w.onboarding?'已入队，待回执':'未验证'))}</p><p>关联任务：${esc(w.task_ids.length?w.task_ids.map(id=>id==='GENERAL'?'跨任务 / 待归类':id).join('、'):'尚未关联')}</p><p>最近汇报：${esc(w.stage||'—')}</p><p class="muted">${esc(date(w.updated_at))}</p></article>`).join('');
 $('unclassified').innerHTML=s.unclassified.length?s.unclassified.map(w=>`<article>${worker(w)}</article>`).join(''):'<p class="muted">暂时不便归入已有任务的进度可上报到 GENERAL。</p>';
 $('tasks').innerHTML=s.tasks.map(t=>`<article><span class="tag">${esc(t.task_id)} · ${esc(t.status)}</span><span class="tag ${t.acceptance.accepted?'ok':''}">${t.acceptance.accepted?'用户验收通过':'用户尚未验收'}</span><h2>${esc(t.title)}</h2><p class="muted">${esc(t.goal)}</p>${t.workers.length?t.workers.map(worker).join(''):'<p class="muted">尚无相关上报；窗口可随时关联此任务。</p>'}</article>`).join('');
 $('demos').innerHTML=s.demo.map(w=>`<article><span class="tag warn">模拟数据 / DEMO</span>${worker(w)}</article>`).join('');
 $('milestones').innerHTML=s.milestones.map(m=>`<li>${esc(m)}</li>`).join('');
 const h=s.inspector;const alive=h&&Date.now()-Date.parse(h.heartbeat_at)<60000;
 const sf=s.siliconflow;sfBox.textContent=sf?`硅基流动共享队列 · 并发上限1 · 调用任务占用：${sf.active?.worker_id||'无'} · 排队：${sf.waiting.map(w=>w.worker_id).join(' → ')||'无'} · 冷却剩余${Math.ceil(sf.cooldown_remaining_ms/1000)}秒 · 待旧调用收尾确认：${sf.awaiting_drain_workers.join('、')||'无'}。仅接入此调度器的调用受控；状态不等于模型正在运行。`:'硅基流动队列尚未加载';
 const paused=s.run_control?.mode==='paused'||(s.run_control?.deadline&&Date.now()>=Date.parse(s.run_control.deadline));
 $('inspection').textContent=`独立 AFK 巡检：${alive?'心跳正常':'状态待核实'} · 派发${paused?'已暂停':'允许'} · 截止 ${date(s.run_control?.deadline)} · 周期 ${s.interval_ms/60000} 分钟 · 上次 ${date(h?.last_inspection_at)} · 下次 ${date(h?.next_inspection_at)}。自动审查：${s.supervision?.message||'尚未配置'}。汇总保存在 local-progress/data/summaries。`;
 reviewBox.innerHTML='<h2>AFK 建议与回执</h2><p>'+esc(s.supervision?.message||'暂无自动审查记录')+'</p>'+Object.entries(s.supervision?.deliveries||{}).map(([id,d])=>`<p><code>${esc(id)}</code>：${s.supervision?.receipts?.[id]?'worker 已主动回执，实际结果看后续上报':d.status==='queued_pending_worker_ack'?'建议已入队，待 worker 回执':'投递结果待核实'}<br>${esc(d.advice)}</p>`).join('');
 $('connection').className='';$('connection').textContent=`上报服务可用 · 每 5 秒刷新 · 本次 ${date(s.generated_at)} · 无法据此判断 worker 进程存活`;
}catch(e){$('connection').className='failure';$('connection').textContent='上报服务连接失败；下方保留旧快照，状态待核实。'+e.message;}finally{busy=false;}}
$('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,5000);
