'use strict';
// Reminder delivery does not depend on the model being reachable.
window.Reminders = (() => {
  let config, latest, signature = '', preview = false, audio;
  const dialog = document.querySelector('#reminder-dialog');
  const content = document.querySelector('#reminder-items');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '未设置';
  let settings = { sound:false }, alerted = new Set();
  const nativeActive = new Map();
  try { settings = {...settings,...JSON.parse(localStorage.getItem('companion-reminder-settings') || '{}')}; alerted = new Set(JSON.parse(localStorage.getItem('companion-reminder-alerted') || '[]')); } catch {}
  function pending(state) {
    const rows = state.notifications.filter(n => !n.read && n.taskId && !state.tasks.find(t => t.id === n.taskId)?.done);
    return [...new Map([...rows].reverse().map(n => [n.taskId,n])).values()];
  }
  function saveSettings() { try { localStorage.setItem('companion-reminder-settings',JSON.stringify(settings)); } catch {} }
  function sound() {
    if (!settings.sound || !audio || audio.state !== 'running') return;
    for (const [delay,hz] of [[0,660],[0.25,880]]) {
      const oscillator=audio.createOscillator(),gain=audio.createGain(),start=audio.currentTime+delay;
      oscillator.frequency.value=hz;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.13,start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+.2);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(start);oscillator.stop(start+.22);
    }
  }
  function updateSettingsUI() {
    const native = 'Notification' in window ? Notification.permission : 'unsupported';
    document.querySelector('#enable-desktop').textContent = native === 'granted' ? '系统通知已允许' : native === 'denied' ? '系统通知被浏览器阻止' : native === 'unsupported' ? '当前浏览器不支持系统通知' : '开启系统通知';
    document.querySelector('#enable-desktop').disabled = native === 'unsupported';
    document.querySelector('#enable-reminder-sound').textContent = settings.sound ? '关闭提示音' : '开启提示音';
    document.querySelector('#reminder-channel-status').textContent = '页面弹窗已启用' + (native === 'granted' ? ' · 系统通知已允许（送达由浏览器和系统决定）' : ' · 系统通知未开启') + (settings.sound ? ' · 提示音已开启，刷新后需点一次页面激活声音' : ' · 提示音关闭');
  }
  function show(rows, isPreview = false) {
    if(!rows.length)return;
    preview = isPreview;
    document.querySelector('#reminder-heading').textContent = isPreview ? '这是提醒效果预览' : `${rows.length} 项待办到时间了`;
    document.querySelector('#reminder-description').textContent = isPreview ? '预览不会创建待办或修改你的提醒。' : '提醒会保留在这里，直到你确认、稍后再提醒，或完成待办。';
    content.innerHTML = rows.map(n => {
      const task=latest?.tasks.find(t=>t.id===n.taskId);
      return `<article class="alarm-item"><div class="alarm-time">计划时间：${escape(time(n.dueAt || task?.dueAt || n.createdAt))}</div><h3>${escape(n.body)}</h3>${task?.details ? `<p>${escape(task.details)}</p>` : ''}<div class="alarm-actions">${isPreview ? '<button class="primary" data-alarm-action="preview-close">知道了，关闭预览</button>' : `<button class="primary" data-alarm-action="ack" data-alarm-id="${escape(n.id)}">我知道了</button><button class="secondary" data-alarm-action="snooze" data-alarm-id="${escape(n.id)}">5 分钟后再提醒</button><button class="text-button" data-alarm-action="complete" data-alarm-id="${escape(n.id)}">完成待办</button>`}</div></article>`;
    }).join('');
    if (!dialog.open) dialog.showModal();
  }
  function deliver(rows) {
    const fresh=rows.filter(n=>!alerted.has(n.id));
    if (!fresh.length) return;
    sound();
    for (const n of fresh) {
      alerted.add(n.id);
      if ('Notification' in window && Notification.permission==='granted') {
        try {
          const notification=new Notification('伴行 · 待办到时间了',{body:n.body,tag:n.id,requireInteraction:true});
          nativeActive.set(n.id,notification);
          notification.onclick=()=>{ window.focus(); if(latest) show(pending(latest)); notification.close(); };
          notification.onerror=()=>{ document.querySelector('#reminder-channel-status').textContent='系统通知未能显示，页面弹窗和提醒中心仍可用'; };
        } catch { document.querySelector('#reminder-channel-status').textContent='当前浏览器未能显示系统通知，页面弹窗仍可用'; }
      }
    }
    try { localStorage.setItem('companion-reminder-alerted',JSON.stringify([...alerted].slice(-200))); } catch {}
  }
  function update(state) {
    latest=state;
    const rows=pending(state), count=rows.length;
    for(const [key,notice] of nativeActive)if(!rows.some(n=>n.id===key)){notice.close();nativeActive.delete(key);}
    document.querySelector('#reminder-badge').textContent=String(count);
    document.querySelector('#reminder-center').classList.toggle('has-unread',count>0);
    document.title=count ? `(${count}) 提醒到时间了 · 伴行` : '伴行 · Personal Agent';
    document.querySelector('#reminder-connection').textContent='提醒服务已连接 · 每 3 秒检查';
    const next=rows.map(n=>n.id).join(',');
    if (!preview && next!==signature) { signature=next; if(count) show(rows); else if(dialog.open) dialog.close(); }
    if (!preview) deliver(rows);
    const unread=state.notifications.filter(n=>!n.read).length;
    document.querySelector('#notification-history').innerHTML=state.notifications.slice(0,30).map(n=>`<article class="inbox-item ${n.read?'':'unread'}"><div><strong>${escape(n.body || n.title)}</strong><small>${escape(time(n.createdAt))} · ${n.read?'已确认/已读':'未确认'}</small></div>${!n.read?`<button class="text-button" data-inbox-ack="${escape(n.id)}">我知道了</button>`:''}</article>`).join('') || '<p class="empty-hint">目前没有已触发的提醒。</p>';
    document.querySelector('#notification-history-count').textContent=unread ? `${unread} 条未读` : '全部已读';
  }
  document.querySelector('#reminder-preview').addEventListener('click',()=>{ show([{body:'休息一下，喝杯水。',createdAt:new Date().toISOString()}],true); sound(); });
  document.querySelector('#reminder-center').addEventListener('click',()=>{ const rows=latest?pending(latest):[]; if(rows.length)show(rows); else { config.switchPage('tasks'); document.querySelector('#notification-history-section').scrollIntoView({behavior:'smooth'}); } });
  dialog.addEventListener('cancel',event=>{ if(!preview)event.preventDefault(); else preview=false; });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-alarm-action], [data-inbox-ack]');if(!button||button.disabled)return;
    if(button.dataset.alarmAction==='preview-close'){preview=false;signature='';dialog.close();if(latest)update(latest);return;}
    button.disabled=true;
    try {
      const action=button.dataset.alarmAction || 'ack';
      await config.request('/api/notifications/respond',{notificationId:button.dataset.alarmId || button.dataset.inboxAck,action});
      config.showToast(action==='snooze'?'已设置为 5 分钟后再提醒':action==='complete'?'待办已完成':'已确认这条提醒');
      await config.refresh();
    } catch(error){button.disabled=false;config.showToast(error.message);}
  });
  document.querySelector('#enable-desktop').addEventListener('click',async()=>{
    if(!('Notification'in window))return;
    try{await Notification.requestPermission();updateSettingsUI();config.showToast(Notification.permission==='granted'?'系统通知已允许':'系统通知未获允许，页面弹窗仍会显示');}catch{config.showToast('当前浏览器无法请求系统通知，页面弹窗仍可用');}
  });
  document.querySelector('#enable-reminder-sound').addEventListener('click',async()=>{
    try{if(!settings.sound){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('浏览器不支持提示音');audio ||=new Audio();await audio.resume();settings.sound=true;sound();}else settings.sound=false;saveSettings();updateSettingsUI();}catch(error){config.showToast(error.message);}
  });
  document.addEventListener('pointerdown',()=>{if(settings.sound){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audio ||=new Audio();void audio.resume().catch(()=>{});}}},{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&config)void config.refresh().catch(()=>{});});
  updateSettingsUI();
  return {configure(value){config=value;},update,disconnected(){document.querySelector('#reminder-connection').textContent='提醒服务连接已断开，重新连接后会补查';}};
})();
