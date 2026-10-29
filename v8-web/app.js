const replyText=(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeUrl(value){
    const s=String(value).trim();
    if(/[\u0000-\u0020\u007f\\]/.test(s))return null;
    if(s.startsWith('/')&&!s.startsWith('//'))return s;
    if(s.startsWith('#'))return s;
    try{const u=new URL(s);return ['http:','https:','mailto:'].includes(u.protocol)?s:null;}catch{return null;}
  }
  function inline(value,depth=0){
    if(depth>3)return escape(value);
    const re=/\x60([^\x60\n]+)\x60|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|~~([^~\n]+)~~|https?:\/\/[^\s<>"\x60]+/g;
    let out='',end=0,m;
    while((m=re.exec(value))){
      out+=escape(value.slice(end,m.index));end=re.lastIndex;
      if(m[1])out+='<code>'+escape(m[1])+'</code>';
      else if(m[2]){
        const url=safeUrl(m[3]);
        out+=url?'<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+inline(m[2],depth+1)+'</a>':escape(m[2])+' ('+escape(m[3])+')';
      }else if(m[4]||m[5])out+='<strong>'+inline(m[4]||m[5],depth+1)+'</strong>';
      else if(m[6])out+='<em>'+inline(m[6],depth+1)+'</em>';
      else if(m[7])out+='<del>'+inline(m[7],depth+1)+'</del>';
      else{
        const url=m[0].replace(/[.,;!，。；！]+$/,'');
        out+='<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(url)+'</a>'+escape(m[0].slice(url.length));
      }
    }
    return out+escape(value.slice(end));
  }
  const cells=s=>s.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
  const separator=s=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);
  const list=s=>s.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
  const heading=s=>s.match(/^ {0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
  const fence=s=>s.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
  const rule=s=>/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(s);
  function render(value,depth=0){
    if(depth>8)return '<p>'+escape(value)+'</p>';
    const rows=String(value??'').replace(/\r\n?/g,'\n').split('\n');
    let i=0,out='';
    while(i<rows.length){
      const row=rows[i],f=fence(row),h=heading(row),item=list(row);
      if(!row.trim()){i++;continue;}
      if(f){
        i++;const code=[];
        const close=new RegExp('^ {0,3}'+f[1][0]+'{'+f[1].length+',}\\s*$');
        while(i<rows.length&&!close.test(rows[i]))code.push(rows[i++]);
        if(i<rows.length)i++;
        const lang=f[2].trim().match(/^[\w+-]{1,32}$/)?.[0]||'代码';
        out+='<div class="code-block"><div class="code-language">'+escape(lang)+'</div><pre tabindex="0"><code>'+escape(code.join('\n'))+'</code></pre></div>';
      }else if(h){
        const level=Math.min(4,h[1].length+1);out+='<h'+level+'>'+inline(h[2])+'</h'+level+'>';i++;
      }else if(rule(row)){out+='<hr>';i++;}
      else if(i+1<rows.length&&row.includes('|')&&separator(rows[i+1])){
        const heads=cells(row),align=cells(rows[i+1]);i+=2;
        const classAt=n=>align[n]?.startsWith(':')&&align[n]?.endsWith(':')?'align-center':align[n]?.endsWith(':')?'align-end':'align-start';
        out+='<div class="table-scroll" role="region" aria-label="回复中的表格" tabindex="0"><table><caption class="visually-hidden">回复中的表格</caption><thead><tr>'+heads.map((x,n)=>'<th scope="col" class="'+classAt(n)+'">'+inline(x)+'</th>').join('')+'</tr></thead><tbody>';
        while(i<rows.length&&rows[i].trim()&&rows[i].includes('|')){
          const data=cells(rows[i++]);out+='<tr>'+heads.map((_,n)=>'<td class="'+classAt(n)+'">'+inline(data[n]||'')+'</td>').join('')+'</tr>';
        }
        out+='</tbody></table></div>';
      }else if(item){
        const ordered=/^\d/.test(item[1]),tag=ordered?'ol':'ul',start=ordered?parseInt(item[1],10):1;
        out+='<'+tag+(ordered&&start!==1?' start="'+start+'"':'')+'>';
        while(i<rows.length){
          const entry=list(rows[i]);if(!entry||/^\d/.test(entry[1])!==ordered)break;
          out+='<li>'+inline(entry[2])+'</li>';i++;
        }
        out+='</'+tag+'>';
      }else if(/^\s{0,3}>/.test(row)){
        const quote=[];while(i<rows.length&&/^\s{0,3}>/.test(rows[i]))quote.push(rows[i++].replace(/^\s{0,3}>\s?/,''));
        out+='<blockquote>'+render(quote.join('\n'),depth+1)+'</blockquote>';
      }else{
        const para=[row];i++;
        while(i<rows.length&&rows[i].trim()&&!fence(rows[i])&&!heading(rows[i])&&!list(rows[i])&&!rule(rows[i])&&!/^\s{0,3}>/.test(rows[i])&&!(i+1<rows.length&&rows[i].includes('|')&&separator(rows[i+1])))para.push(rows[i++]);
        out+='<p>'+para.map(x=>inline(x)).join('<br>')+'</p>';
      }
    }
    return out;
  }
  return {render,safeUrl};
})();
// End safe chat formatting.


const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null,data=null,list=[],selected=new Set(),busy=false,uploading=false,pendingDelete=null,lastSignature='',manualSelection=false,viewState='loading',generation=0;
let listGeneration=0,scrollToLatest=true,botOptions=[],selectedBotId='general';
function showBots(){const panel=$('#bot-list');if(!panel)return;panel.innerHTML=botOptions.filter(b=>b.enabled||b.id===selectedBotId).map(b=>{const running=list.some(c=>(c.botId||'general')===b.id&&c.running),selected=b.id===selectedBotId;return '<button type="button" class="bot-tile '+(selected?'selected ':'')+(running?'is-running':'')+'" data-bot-id="'+esc(b.id)+'" aria-pressed="'+selected+'" aria-label="'+esc(b.name)+'，'+(running?'正在运行':'空闲')+'"><span class="bot-avatar" aria-hidden="true"><span>'+esc([...b.name].slice(0,2).join(''))+'</span></span><span class="bot-caption"><strong>'+esc(b.name)+'</strong><small>'+(running?'正在运行':esc(b.description||'随时开始'))+'</small></span><span class="bot-state" aria-hidden="true"></span></button>';}).join('');$('#bot-folder').textContent='打开'+(botOptions.find(b=>b.id===selectedBotId)?.name||'助理')+'文件夹';}
async function loadBotOptions(){const value=await api('/api/bots');botOptions=value.bots;const select=$('#bot-select');select.innerHTML=botOptions.filter(b=>b.enabled||b.id===(data?.bot?.id||selectedBotId)).map(b=>'<option value="'+esc(b.id)+'" '+(!b.enabled?'disabled':'')+'>'+esc(b.name)+(!b.enabled?'（已停用）':'')+'</option>').join('');if(!botOptions.some(b=>b.id===selectedBotId))selectedBotId='general';select.value=selectedBotId;showBots();return value;}
const uploads=new Map(),notices=new Map(),selections=new Map(),sending=new Set();
async function api(url,options={}){const res=await fetch(url,{...options,headers:{'X-V8-Client':'web',...(options.body&&typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});const body=await res.json();if(!res.ok)throw Error(body.error||'请求失败');return body;}
const localFileFeedback=new Map(),pendingLocalFiles=new Set();
function localFileActionUrl(url,action){
 if(typeof url!=='string'||!['open','reveal'].includes(action))return null;
 const route=/^\/api\/(?:conversations\/[a-f0-9-]+\/turns\/[a-f0-9-]+\/files\/[a-f0-9-]+|workspace\/resources\/[a-f0-9-]+)\/(open|reveal)(?:\?revision=[a-f0-9]+)?$/;
 return url.match(route)?.[1]===action?url:null;
}
function localFileMarkup(file){
 const reveal=localFileActionUrl(file.revealUrl,'reveal'),open=file.canOpen&&localFileActionUrl(file.openUrl,'open');
 const available=file.available===true&&!!reveal,key=reveal||String(file.id||file.name),feedback=localFileFeedback.get(key),pending=pendingLocalFiles.has(key);
 const action=open?'open':'reveal',url=open||reveal,name=file.name||file.title||'文件',localPath=feedback?.path||file.path;
 const control=(label,target,kind,primary=false)=>`<button type="button" class="${primary?'local-file-link':'local-file-action'}" data-local-file-action="${kind}" data-local-file-url="${esc(target)}" aria-label="${kind==='open'?'打开本地文件':'在文件夹中显示'} ${esc(name)}" ${pending?'disabled':''}>${esc(label)}</button>`;
 return `<div class="local-file-row" data-local-file-key="${esc(key)}" ${pending?'aria-busy="true"':''}><div class="local-file-heading">${available?control(name,url,action,true):`<span class="local-file-unavailable">${esc(name)}</span>`}${available?control('在文件夹中显示',reveal,'reveal'):''}</div>${localPath?`<span class="local-file-path">${esc(localPath)}</span>`:''}<span class="local-file-status ${feedback?.error?'local-file-error':''}" role="status" aria-atomic="true">${esc(pending?'正在'+(feedback?.action==='open'?'打开文件':'定位文件')+'…':feedback?.message||(!available?file.reason||'文件暂不可用':''))}</span></div>`;
}
function renderLocalFiles(files){return files?.length?`<div class="local-files" aria-label="已保存到本地的文件"><span class="local-files-label">本地文件</span>${files.map(localFileMarkup).join('')}</div>`:'';}
function updateLocalFileFeedback(key){
 const pending=pendingLocalFiles.has(key),feedback=localFileFeedback.get(key);
 for(const row of document.querySelectorAll('[data-local-file-key]'))if(row.dataset.localFileKey===key){
  row.setAttribute('aria-busy',String(pending));for(const button of row.querySelectorAll('[data-local-file-action]'))button.disabled=pending;
  if(feedback?.path){let path=row.querySelector('.local-file-path');if(!path){path=document.createElement('span');path.className='local-file-path';row.querySelector('.local-file-heading').after(path);}path.textContent=feedback.path;}
  const status=row.querySelector('.local-file-status');status.textContent=pending?'正在'+(feedback?.action==='open'?'打开文件':'定位文件')+'…':feedback?.message||'';status.classList.toggle('local-file-error',!!feedback?.error);
 }
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-local-file-action]');if(!button)return;e.preventDefault();
 const row=button.closest('[data-local-file-key]'),key=row?.dataset.localFileKey,action=button.dataset.localFileAction,url=localFileActionUrl(button.dataset.localFileUrl,action);
 if(!key||pendingLocalFiles.has(key))return;
 if(!url){localFileFeedback.set(key,{error:true,message:'本地文件链接无效，请刷新页面'});updateLocalFileFeedback(key);return;}
 const previousPath=localFileFeedback.get(key)?.path;
 pendingLocalFiles.add(key);localFileFeedback.set(key,{action,message:'',path:previousPath});updateLocalFileFeedback(key);
 try{const result=await api(url,{method:'POST'});localFileFeedback.set(key,{path:result.path||previousPath,message:result.message||(action==='open'?'已请求打开文件':'已请求在文件夹中显示')});}
 catch(error){localFileFeedback.set(key,{path:previousPath,error:true,message:error.message||'无法打开本地文件'});}
 finally{pendingLocalFiles.delete(key);updateLocalFileFeedback(key);}
});
function formError(e){$('#form-error').textContent=e?.message||e||'';}
function controls(){busy=!!data?.turns.some(t=>t.status==='running');uploading=!!uploads.get(current);const ready=viewState==='ready';$('#composer').dataset.viewState=viewState;$('#composer').dataset.conversationId=ready?current||'':'';$('#send').hidden=busy;$('#stop').hidden=!busy;$('#send').disabled=!ready||uploading||sending.has(current)||!$('#message').value.trim();$('#add-files').disabled=!ready||busy||uploading;$('#file-input').disabled=!ready||busy||uploading;$('#message').disabled=!ready||busy||uploading||sending.has(current);$('#new-chat').disabled=viewState==='creating';$('#bot-select').disabled=viewState==='creating';}
function showList(){const term=$('#search').value.trim().toLowerCase();const matches=list.filter(c=>(c.botId||'general')===selectedBotId&&c.title.toLowerCase().includes(term));showBots();$('#threads').innerHTML=matches.map(c=>{const date=new Date(c.createdAt);const stamp=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(date):'历史对话';return `<div class="thread ${c.id===current?'selected':''}"><button class="thread-link" data-thread="${c.id}" ${c.id===current?'aria-current="page"':''} title="${esc(c.title)}"><strong>${esc(c.title)}</strong><small>${c.unread?'新提醒 · '+stamp:c.running?'正在处理…':(c.botName?c.botName+' · ':'')+stamp}</small></button><button class="icon-button thread-delete" type="button" data-delete="${c.id}" aria-label="删除对话 ${esc(c.title)}" title="删除对话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button></div>`}).join('')+(term&&!matches.length?'<p class="search-empty">没有找到相关对话</p>':'');}
async function refreshList(){const ticket=++listGeneration;const next=await api('/api/conversations');if(ticket===listGeneration){list=next;showList();const unread=list.filter(c=>c.unread);$('#proactive-alert').hidden=!unread.length;$('#proactive-count').textContent=String(unread.length);}}
function beginView(id,state){generation++;current=id;data=null;viewState=state;selected=new Set();manualSelection=false;lastSignature='';formError('');$('#upload-status').textContent='';$('#current-result').hidden=true;$('#materials-panel').hidden=true;$('#materials').innerHTML='';scrollToLatest=true;$('#jump-latest').hidden=true;$('#conversation').textContent=state==='creating'?'正在创建新对话…':'正在加载对话…';controls();return generation;}
async function loadView(id,ticket){const next=await api('/api/conversations/'+id);if(ticket!==generation)return;current=id;data=next;selectedBotId=next.bot?.id||'general';$('#bot-select').value=selectedBotId;$('#active-bot-label').textContent=next.bot?.name||'通用助理';viewState='ready';selected=selections.get(id)||new Set();selections.set(id,selected);localStorage.setItem('v8-current',id);history.replaceState(null,'','#'+id);render();showList();closeSidebar(false);if(next.unread){await api('/api/conversations/'+id+'/acknowledge',{method:'POST'});await refreshList();}}
async function open(id){const ticket=beginView(id,'loading');try{await loadView(id,ticket);}catch(e){if(ticket===generation){viewState='error';controls();formError(e);}}}
async function fresh(botId=selectedBotId){const ticket=beginView(null,'creating');try{const c=await api('/api/conversations',{method:'POST',body:JSON.stringify({botId})});await refreshList();if(ticket===generation){await loadView(c.id,ticket);$('#message').focus();}}catch(e){if(ticket===generation){viewState='error';controls();formError(e);}}}
const labels={answered:'已回答',needs_input:'需要补充材料',completed:'本轮处理结束',running:'正在处理你的要求',partial:'已有部分成果，仍有未完成项',failed:'这一步未完成',interrupted:'本轮执行已中断',cancelled:'本轮已停止'};
function visibleAnswer(t){return (t.answer||'').split('\n').filter(line=>!line.startsWith('SHA256:')&&!t.artifacts.some(a=>line===a.name||line===a.title)).join('\n').replace(/\n{3,}/g,'\n\n');}
function render(){if(!data)return;$('#active-bot-label').textContent=data.bot?.name||'通用助理';controls();const main=$('#chat-main'),near=main.scrollHeight-main.scrollTop-main.clientHeight<160;const signature=JSON.stringify(data.turns);if(signature!==lastSignature){const expanded=new Set([...$('#conversation').querySelectorAll('.trace[open]')].map(el=>el.closest('[data-turn]')?.dataset.turn));lastSignature=signature;$('#conversation').innerHTML=!data.turns.length?`<div class="empty-state"><span class="brand-symbol" aria-hidden="true"><i></i><i></i></span><h1>把一件事，交到结果。</h1><p>上传材料，告诉伴行你的目标。后续修改，接着说就好。</p><div class="suggestions"><button data-suggestion="比较这两份文件，整理关键变化并保留来源，导出报告。">比较文件</button><button data-suggestion="把这两份报表合起来，所有记录都保留，给我Excel。">整理报表</button><button data-suggestion="请阅读这些材料，整理要点和待确认事项，生成可下载的Markdown报告。">整理材料</button></div></div>`:data.turns.map(t=>`<article class="chat-message user"><div class="message-label">你 · ${esc(new Date(t.createdAt).toLocaleString('zh-CN',{hour12:false}))}</div><div class="message-body">${esc(t.request)}</div></article><article class="chat-message assistant" data-turn="${t.id}"><div class="product-stage"><span class="stage-dot ${t.status==='running'?'running':''}"></span>${esc(labels[t.status]||t.status)}</div>${['failed','partial','cancelled','interrupted'].includes(t.status)?`<div class="run-notice"><p>${esc(t.error||t.termination?.error?.message||'已有材料、执行记录和成果已保留。')}</p>${t.canResume?`<button class="retry" data-retry="${t.id}">继续未完成的部分</button>`:''}</div>`:''}<div class="message-body reply-body">${replyText.render(visibleAnswer(t)||(t.status==='running'?(t.progress.steps.at(-1)?'正在处理：'+t.progress.steps.at(-1).tool:'正在读取本轮上下文，准备处理…'):'本轮没有返回正文，请查看执行详情。'))}</div>${renderLocalFiles(t.localFiles)}${t.resourceSelections?.length?`<details class="resource-selections"><summary>本轮选用的工作区资源 · ${t.resourceSelections.length} 项</summary><ul>${t.resourceSelections.map(r=>`<li>${esc(r.ref.resourceId)} · 版本 ${esc(r.ref.revisionId.slice(0,10))}<small>${esc(r.reason)}</small></li>`).join('')}</ul></details>`:''}${t.canSelect&&t.artifacts.length&&t.status!=='running'?`<button class="result-select" data-select-result="${t.id}">从这一轮成果继续修改</button>`:''}${t.answer&&t.status!=='running'?`<button type="button" class="copy-reply" data-copy-turn="${t.id}" aria-label="复制这条回复">复制回复</button>`:''}<details class="trace"><summary>查看处理过程 · ${t.progress.toolCalls} 次工具调用${t.progress.modelRequests?' · '+t.progress.modelRequests+' 次模型回执':''}</summary><ol>${t.progress.steps.map(s=>`<li class="${s.status==='error'?'tool-error':''}">${esc(s.tool)} <span class="badge">${s.status==='error'?'未完成':s.recovered?'已恢复回执':'已返回'}</span>${s.error?'<small>'+esc(s.error)+'</small>':''}</li>`).join('')}</ol><small>工具返回与文件保存状态可回查，不代表原文理解或业务判断已经完全核实。</small></details></article>`).join('');for(const el of $('#conversation').querySelectorAll('.trace'))if(expanded.has(el.closest('[data-turn]')?.dataset.turn))el.open=true;if(near||scrollToLatest)main.scrollTop=main.scrollHeight;scrollToLatest=false;updateScrollButton();}
 $('#workspace-context').textContent=(data.workspace?.name||'个人工作空间')+' · 可自动查找已有文件';$('#materials-panel').hidden=!data.files.length;$('#materials-summary').textContent=`本对话材料 · ${data.files.length} 份可用${selected.size?' · 本轮选中 '+selected.size+' 份':''}`;$('#materials').innerHTML=data.files.map(f=>`<div class="material"><label><input type="checkbox" data-file="${f.id}" ${selected.has(f.id)?'checked':''} ${busy?'disabled':''}><span>${esc(f.name)} <small>(${Math.max(1,Math.round(f.bytes/1024))} KB)</small></span></label><button data-remove-file="${f.id}" aria-label="移除材料 ${esc(f.name)}" ${busy?'disabled':''}>×</button></div>`).join('');const hasResult=data.currentResult?.status==='available';$('#current-result').hidden=!hasResult;$('#current-result').innerHTML=hasResult?'<span>已关联本对话成果，可直接描述修改要求</span>'+(data.currentResult.downloadable?'<button id="fetch-delivery">查看本地文件</button>':''):'';$('#upload-status').textContent=notices.get(current)||'';controls();}
async function poll(){if(!current||viewState!=='ready')return;const id=current,ticket=generation;try{const next=await api('/api/conversations/'+id);if(current!==id||generation!==ticket||viewState!=='ready')return;const wasBusy=busy;data=next;render();if(wasBusy&&!busy){await refreshList();if(current===id&&generation===ticket)$('#message').focus();}}catch(e){if(current===id&&generation===ticket)formError(e);}}
async function send(message,extra={}){if(viewState!=='ready'){formError('对话尚未就绪，请稍候再发送');return;}if(busy||uploading||sending.has(current))return;const id=current,ticket=generation;sending.add(id);formError('');controls();try{await api('/api/conversations/'+id+'/messages',{method:'POST',body:JSON.stringify({message,fileIds:[...selected],useConversationFiles:!manualSelection,...extra})});if(id===current&&ticket===generation){$('#message').value='';$('#message').style.height='auto';selected.clear();scrollToLatest=true;await poll();}await refreshList();}catch(e){if(id===current&&ticket===generation)formError(e);}finally{sending.delete(id);if(id===current&&ticket===generation)controls();}}
async function upload(files){if(viewState!=='ready'){formError('对话尚未就绪，请等待创建或加载完成后上传');return;}if(!files.length||busy||uploads.get(current))return;const id=current,ticket=generation,requestId=crypto.randomUUID();uploads.set(id,requestId);$('#file-input').value='';formError('');controls();try{for(let i=0;i<files.length;i++){const f=files[i];notices.set(id,'正在保存 '+(i+1)+'/'+files.length+'：'+f.name);if(current===id&&generation===ticket)$('#upload-status').textContent=notices.get(id);const next=await api('/api/conversations/'+id+'/files',{method:'POST',headers:{'X-File-Name':encodeURIComponent(f.name),'X-Upload-Request-Id':requestId},body:await f.arrayBuffer()});if(next.id!==id||next.targetConversationId!==id)throw Error('上传回执目标不匹配');const set=selections.get(id)||new Set();set.add(next.files.at(-1).id);selections.set(id,set);if(current===id&&generation===ticket){data=next;selected=set;render();}}notices.set(id,'已保存 '+files.length+' 份文件，请描述你的要求。');}catch(e){notices.set(id,'上传未完成：'+e.message);if(current===id&&generation===ticket)formError(e);}finally{uploads.delete(id);if(current===id){if(generation===ticket){$('#materials-panel').open=true;$('#upload-status').textContent=notices.get(id)||'';}await poll();controls();}}}
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();const message=$('#message').value.trim();if(message)send(message).catch(formError);});$('#message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});$('#message').addEventListener('input',()=>{$('#message').style.height='auto';$('#message').style.height=Math.min($('#message').scrollHeight,180)+'px';controls();});$('#add-files').onclick=()=>$('#file-input').click();$('#file-input').onchange=()=>upload([...$('#file-input').files]);$('#new-chat').onclick=()=>fresh().catch(formError);$('#search-toggle').onclick=()=>{$('#search').hidden=!$('#search').hidden;if(!$('#search').hidden)$('#search').focus();};$('#search').oninput=showList;$('#mobile-menu').onclick=()=>setSidebar(!$('#sidebar').classList.contains('open'));$('#stop').onclick=()=>api('/api/conversations/'+current+'/cancel',{method:'POST'}).then(poll).catch(formError);
document.addEventListener('change',e=>{if(e.target.matches('[data-file]')){manualSelection=true;e.target.checked?selected.add(e.target.dataset.file):selected.delete(e.target.dataset.file);render();}});
document.addEventListener('click',async e=>{const actionId=current,actionGeneration=generation;try{const b=e.target.closest('button');if(!b)return;if(b.dataset.copyTurn){const turn=data?.turns.find(t=>t.id===b.dataset.copyTurn);if(turn){try{await navigator.clipboard.writeText(visibleAnswer(turn));b.textContent='已复制';b.setAttribute('aria-label','回复已复制');}catch{b.textContent='复制失败，请选中文字';}}return;}if(b.dataset.thread)await open(b.dataset.thread);if(b.dataset.suggestion){$('#message').value=b.dataset.suggestion;$('#message').focus();}if(b.dataset.removeFile){const id=current,ticket=generation;const next=await api('/api/conversations/'+id+'/files/'+b.dataset.removeFile,{method:'DELETE'});if(current===id&&generation===ticket){data=next;selected.delete(b.dataset.removeFile);render();}}if(b.dataset.retry)await send('继续处理未完成的部分',{mode:'resume',retryTurnId:b.dataset.retry,fileIds:[]});if(b.dataset.selectResult){const id=current,ticket=generation;await api('/api/conversations/'+id+'/select-result',{method:'POST',body:JSON.stringify({turnId:b.dataset.selectResult})});notices.set(id,'已选择这一轮成果，接下来可描述修改要求。');if(current===id&&generation===ticket){await poll();}}if(b.id==='fetch-delivery')await send('查看本地文件',{mode:'rebuild_delivery',fileIds:[]});if(b.dataset.delete){pendingDelete=b.dataset.delete;$('#delete-dialog').showModal();}}catch(e){if(current===actionId&&generation===actionGeneration)formError(e);}});
$('#delete-cancel').onclick=()=>$('#delete-dialog').close();$('#delete-confirm').onclick=async()=>{try{await api('/api/conversations/'+pendingDelete,{method:'DELETE'});$('#delete-dialog').close();if(current===pendingDelete){current=null;data=null;await refreshList();list.length?await open(list[0].id):await fresh();}else await refreshList();}catch(e){$('#delete-dialog').close();formError(e);}};
for(const event of ['dragover','drop'])$('#composer').addEventListener(event,e=>{e.preventDefault();$('#composer').classList.toggle('dragging',event==='dragover');if(event==='drop')upload([...e.dataTransfer.files]);});$('#composer').addEventListener('dragleave',()=>$('#composer').classList.remove('dragging'));
async function health(){try{const h=await api('/api/health');$('#health-text').textContent=h.connected?'服务已连接':'服务暂不可达';$('#health').classList.toggle('offline',!h.connected);}catch{$('#health-text').textContent='服务连接中断';$('#health').classList.add('offline');}}$('#health').onclick=health;$('#bot-folder').onclick=()=>api('/api/bots/'+selectedBotId+'/folder',{method:'POST'}).catch(formError);$('#bot-list').onclick=async e=>{const b=e.target.closest('[data-bot-id]');if(!b)return;const id=b.dataset.botId;if(viewState!=='ready')return;try{const previous=list.find(c=>(c.botId||'general')===id&&c.running)||list.find(c=>(c.botId||'general')===id);previous?await open(previous.id):await fresh(id);}catch(e){formError(e);}};$('#bot-select').onchange=()=>fresh($('#bot-select').value).catch(formError);$('#proactive-alert').onclick=()=>{const target=list.find(c=>c.unread);if(target)open(target.id).catch(formError);};
function fileType(name){return ({docx:'Word',xlsx:'Excel',pdf:'PDF',md:'MD',txt:'TXT',zip:'ZIP',json:'JSON',csv:'CSV'})[String(name||'').split('.').pop().toLowerCase()]||'文件';}
function updateScrollButton(){const main=$('#chat-main');$('#jump-latest').hidden=!data?.turns.length||main.scrollHeight-main.scrollTop-main.clientHeight<160;}
function setSidebar(open){const mobile=matchMedia('(max-width:700px)').matches;open=mobile&&open;$('#sidebar').classList.toggle('open',open);$('#sidebar').inert=mobile&&!open;$('#sidebar-backdrop').hidden=!open;$('#mobile-menu').setAttribute('aria-expanded',String(open));if(open)$('#sidebar').querySelector('button')?.focus();}
function closeSidebar(restoreFocus=true){const wasOpen=$('#sidebar').classList.contains('open');setSidebar(false);if(wasOpen&&restoreFocus)$('#mobile-menu').focus();}
$('#sidebar-backdrop').onclick=()=>closeSidebar();
document.addEventListener('keydown',e=>{if(!$('#sidebar').classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();closeSidebar();}if(e.key==='Tab'){const focusable=[...$('#sidebar').querySelectorAll('button,input,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
matchMedia('(max-width:700px)').addEventListener('change',()=>setSidebar(false));setSidebar(false);
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id&&id!==current&&list.some(c=>c.id===id))open(id).catch(formError);});
$('#chat-main').addEventListener('scroll',updateScrollButton,{passive:true});
$('#jump-latest').onclick=()=>{$('#chat-main').scrollTop=$('#chat-main').scrollHeight;updateScrollButton();};
new ResizeObserver(entries=>{document.documentElement.style.setProperty('--composer-height',Math.ceil(entries[0].borderBoxSize?.[0]?.blockSize||entries[0].contentRect.height)+'px');}).observe($('.composer-wrap'));
(async()=>{await health();await loadBotOptions();await refreshList();const id=location.hash.slice(1)||localStorage.getItem('v8-current');if(list.some(c=>c.id===id))await open(id);else if(list.length)await open(list[0].id);else await fresh();setInterval(poll,1400);setInterval(()=>refreshList().catch(()=>{}),5000);setInterval(health,30000);})().catch(formError);
