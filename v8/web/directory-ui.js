'use strict';
window.DirectoryUI=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let api,refresh,toast,panel,latest,signature='',busy=false;
 function configure(options){api=options.request;refresh=options.refresh;toast=options.showToast;panel=document.createElement('section');panel.className='editor-panel';panel.id='directory-panel';
  panel.innerHTML='<h2>连接工作目录</h2><p class="field-help">为当前对话连接一个本机文件夹，只读扫描文件变化，约每30秒检查。扫描结果留在本机；聊天请求模型分析时，相关文本可能发送到已配置的模型服务。</p><form id="directory-form"><label>目录名称<input id="directory-name" maxlength="60" placeholder="例如：星河项目" required></label><label>本机目录的完整路径<input id="directory-path" maxlength="1000" placeholder="例如：D:\\工作资料\\星河项目" required></label><button id="directory-connect" type="submit">连接并只读扫描</button></form><p class="field-help">首次扫描建立基线。之后可在聊天说“目录列表”“扫描目录”“目录变化”。跳过隐藏项与链接；最多5个连接，每次500个文件/50MB，单文件10MB。DOCX、PDF、表格和媒体目前只跟踪版本，正文仍需已有解析/识别流程。</p><div id="directory-list"></div>';
  document.querySelector('#page-workbench').prepend(panel);
  panel.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;lock();try{await api('/api/directories/connect',{conversationId:Conversations.current(),name:panel.querySelector('#directory-name').value,path:panel.querySelector('#directory-path').value});panel.querySelector('form').reset();toast('目录已连接，基线与限制请查看下方。');await refresh();}catch(e){toast(e.message);}finally{busy=false;lock();}});
  panel.addEventListener('click',async e=>{const b=e.target.closest('[data-dir-scan],[data-dir-disconnect]');if(!b||busy)return;busy=true;lock();try{await api(b.dataset.dirScan?'/api/directories/scan':'/api/directories/disconnect',{conversationId:Conversations.current(),connectionId:b.dataset.dirScan||b.dataset.dirDisconnect});await refresh();}catch(e){toast(e.message);}finally{busy=false;lock();}});
 }
 function lock(){if(panel)panel.querySelectorAll('button').forEach(b=>b.disabled=busy);}
 function update(state){latest=state;if(!panel)return;const rows=(state.directoryConnections||[]).filter(c=>c.conversationId===Conversations.current()),key=JSON.stringify([Conversations.current(),rows]);if(key===signature)return;signature=key;
  panel.querySelector('#directory-list').innerHTML=rows.length?rows.map(c=>`<article class="news-card"><h3>${esc(c.name)}</h3><p class="field-help">${esc(c.path)}</p><p>${c.scanning?'扫描中':c.initialized?'基线已建立':'基线未完整建立'} · ${c.indexed}份索引 · ${c.changeCount}条保留变化</p>${c.error?`<p>${esc(c.error)}</p>`:''}${(c.warnings||[]).map(w=>`<p class="field-help">${esc(w)}</p>`).join('')}<button type="button" data-dir-scan="${esc(c.id)}">立即扫描</button><button type="button" data-dir-disconnect="${esc(c.id)}">断开并清除索引</button></article>`).join(''):'<p class="field-help">当前对话还没有连接目录。断开只清除助手索引，不删除原目录。</p>';lock();
 }
 return {configure,update};
})();
