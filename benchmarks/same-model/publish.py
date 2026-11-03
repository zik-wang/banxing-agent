"""Publish reviewed public-material experiment; raw API logs stay local.

Usage: python publish.py EXPERIMENT_ROOT REPOSITORY_PUBLICATION_DIR
Requires readback.py and an explicit developer assessment.json, never invents verdicts.
"""
import base64, hashlib, html, json, sys
from datetime import datetime
from pathlib import Path

root, destination = map(lambda x: Path(x).resolve(), sys.argv[1:3])
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
readback=json.loads((root/'readback.json').read_text(encoding='utf-8'))
assessment=json.loads((root/'assessment.json').read_text(encoding='utf-8'))
destination.mkdir(parents=True,exist_ok=True)
esc=lambda s:html.escape(str(s),quote=True)
load=lambda p:json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}
def jsonlines(p):
    return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()] if p.exists() else []
downloads=[]
def download(p,expected_hash,allowed_root,label=None):
    p=Path(p).resolve();assert p.is_relative_to(Path(allowed_root).resolve()),'Artifact outside authorized publication root'
    data=p.read_bytes();sha=hashlib.sha256(data).hexdigest()
    assert sha==expected_hash,'File changed after readback: '+p.name
    downloads.append({'name':p.name,'bytes':len(data),'sha256':sha})
    return '<a class="file" download="'+esc(p.name)+'" data-sha256="'+sha+'" href="data:application/octet-stream;base64,'+base64.b64encode(data).decode()+'"><b>'+esc(label or p.name)+'</b><small>'+str(len(data))+' bytes · SHA256 '+sha[:16]+'…</small></a>'

records=[];sections=[]
def sanitize(value):
    if isinstance(value,dict):return {k:sanitize(v) for k,v in value.items()}
    if isinstance(value,list):return [sanitize(v) for v in value]
    if isinstance(value,str):return value.replace(str(root),'[EXPERIMENT]').replace(str(root).replace('\\','/'),'[EXPERIMENT]')
    return value
for case in manifest['cases']:
    cid=case['id'];parts=[];display_title=assessment.get('displayTitles',{}).get(cid,case['title'])
    for framework in ['harness','codex']:
        folder=root/framework/('s'+cid);inv=load(folder/'invocation.json')
        assert inv.get('finishedAt'),'Run has not settled; refusing final publication: '+framework+'/'+cid
        receipts=[load(p) for p in (root/'api'/framework/('s'+cid)).glob('*.receipt.json')]
        receipts.sort(key=lambda r:r.get('startedAt',''))
        posts=[r for r in receipts if r.get('networkRequestAttempted')]
        current=[r for r in posts if r.get('startedAt','')>=inv.get('startedAt','~')]
        archives=[{'archive':p.name,**load(p/'invocation.json')} for p in sorted((root/framework).glob('s'+cid+'-*')) if p.is_dir() and (p/'invocation.json').exists()]
        prior=next((x for x in archives if 'rate-limit' in x['archive']),{})
        legacy=next((x for x in archives if 'legacy-sandbox' in x['archive']),{})
        elapsed=lambda x:(x.get('elapsedMs',0)/1000)
        rb=next(x for x in readback['runs'] if x['case']==cid and x['framework']==framework)
        verdict=next(x for x in assessment['runs'] if x['case']==cid and x['framework']==framework)
        tools=jsonlines(folder/'run/tool-calls.jsonl') if framework=='harness' else jsonlines(folder/'events.jsonl')
        trace=([{'tool':t['tool'],'status':t['status'],'arguments':t.get('arguments')} for t in tools] if framework=='harness' else [{'tool':t['item']['type'],'status':t['item'].get('status'),'exitCode':t['item'].get('exit_code'),'command':t['item'].get('command')} for t in tools if t.get('type')=='item.completed' and t.get('item',{}).get('type')=='command_execution'])
        trace=sanitize(trace)
        row={'case':cid,'framework':framework,'assessment':verdict,'invocation':{k:v for k,v in inv.items() if k not in ['args','codexHome']},'cumulativeActualPosts':len(posts),'currentAttemptPosts':len(current),'priorAttempts':{'rateLimited':prior,'legacyWindowsSandbox':legacy},'providerHttpFailures':[{'httpStatus':r.get('httpStatus'),'requestNumber':r.get('requestNumber'),'startedAt':r.get('startedAt')} for r in posts if r.get('httpStatus')!=200],'localBudgetRefusals':sum(bool(r.get('localBudgetRefusal')) for r in receipts),'usage':{k:sum(r.get('usage',{}).get(k,0) or 0 for r in posts) for k in ['prompt_tokens','completion_tokens','total_tokens']},'receiptElapsedSecondsExcludingPacing':round(sum(max(0,r.get('elapsedMs',0)-r.get('pacingWaitMs',0)) for r in posts)/1000,2),'cumulativePacingSeconds':round(sum(r.get('pacingWaitMs',0) for r in posts)/1000,2),'currentWallSeconds':round(elapsed(inv),2),'cumulativeKnownWallSeconds':round(elapsed(inv)+elapsed(prior)+elapsed(legacy),2),'cost':'unknown: API did not return a billed amount','toolTrace':trace,'finalAnswer':rb['finalAnswer'],'artifacts':[{k:v for k,v in a.items() if k not in ['path']} for a in rb['artifacts']]}
        records.append(row)
        row['priorAttempts']=[{k:v for k,v in x.items() if k not in ['args','codexHome']} for x in archives]
        row['cumulativeKnownWallSeconds']=round(elapsed(inv)+sum(elapsed(x) for x in archives),2)
        row['requestReceipts']=[{k:r.get(k) for k in ['id','requestNumber','startedAt','httpStatus','networkRequestAttempted','localBudgetRefusal','error','usage','finishReason','elapsedMs','pacingWaitMs','estimatedTokens','providerModel']} for r in receipts]
        row['gatewayAttempts']=len([r for r in receipts if r.get('requestNumber') is not None])
        row['postsWithoutReturnedUsage']=sum(not bool(r.get('usage')) for r in posts)
        artifact_links=''.join(download(a['path'],a['sha256'],folder/('run/outputs' if framework=='harness' else 'outputs')) for a in rb['artifacts']) or '<p class="muted">未生成可下载成果；没有占位链接。</p>'
        notes=''.join('<li>'+esc(x)+'</li>' for x in verdict['findings'])
        parts.append('<article><h3>'+('伴行 Harness' if framework=='harness' else '原生 Codex CLI')+'</h3><p class="verdict">'+esc(verdict['verdict'])+'</p><ul>'+notes+'</ul><dl><dt>当前 / 累计实际POST</dt><dd>'+str(len(current))+' / '+str(len(posts))+'</dd><dt>当前 / 累计已知墙钟</dt><dd>'+str(row['currentWallSeconds'])+' / '+str(row['cumulativeKnownWallSeconds'])+' 秒</dd><dt>累计网关节流等待</dt><dd>'+str(row['cumulativePacingSeconds'])+' 秒</dd><dt>已返回的 token / 账单</dt><dd>'+str(row['usage']['total_tokens'])+' / unknown</dd></dl>'+artifact_links+'<details><summary>原始最终回复</summary><pre>'+esc(rb['finalAnswer'] or '没有最终回复')+'</pre></details><details><summary>实际工具执行轨迹（非手写计划）</summary><pre>'+esc(json.dumps(trace,ensure_ascii=False,indent=2))+'</pre></details><details><summary>保存后独立回读</summary><pre>'+esc(json.dumps(row['artifacts'],ensure_ascii=False,indent=2))+'</pre></details></article>')
        parts[-1]=parts[-1].replace('</article>','<details><summary>逐次API回执元数据</summary><pre>'+esc(json.dumps(row['requestReceipts'],ensure_ascii=False,indent=2))+'</pre></details></article>')
    inputs=''.join(download(i['source'],i['sha256'],Path(i['source']).parent,i['name']) for i in case['inputs'])
    sections.append('<section id="s'+cid+'"><div class="section-title"><span>'+cid+'</span><h2>'+esc(display_title)+'</h2></div><details><summary>原样请求、原件下载及输入SHA</summary><pre>'+esc(case['originalRequest'])+'</pre>'+inputs+'<pre>'+esc(json.dumps([{k:v for k,v in i.items() if k!='source'} for i in case['inputs']],ensure_ascii=False,indent=2))+'</pre></details><div class="compare">'+''.join(parts)+'</div></section>')

result={'kind':'DEVELOPER_OBSERVED_SAME_MODEL_COMPARISON_NOT_INDEPENDENT_GOLD','createdAt':datetime.now().astimezone().isoformat(),'model':manifest['settings'],'productCommit':assessment['productCommit'],'method':assessment['method'],'summary':assessment['summary'],'runs':records,'downloads':downloads,'inputHashChecks':readback['inputs'],'inputHashesPreserved':all(i['originalShaMatches'] and all(i['copiesUnchanged'].values()) for i in readback['inputs']),'limitations':assessment['limitations']}
# Remove absolute local paths from publishing metadata; API logs and full prompts remain local.
for r in result['runs']:
    for t in r['toolTrace']:
        for key in ['command','arguments']:
            if key in t:
                text=json.dumps(t[key],ensure_ascii=False) if isinstance(t[key],dict) else str(t[key]);text=text.replace(str(root),'[EXPERIMENT]').replace(str(root).replace('\\','/'),'[EXPERIMENT]');t[key]=text
html_doc='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同一公网27B：伴行Harness与原生Codex真实交付对照</title><style>
:root{color-scheme:light;--ink:#18322d;--muted:#60716b;--line:#dce4df;--bg:#f4f7f4;--accent:#265d4c}*{box-sizing:border-box}body{font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif;overflow-wrap:anywhere;color:var(--ink);background:var(--bg);margin:0}main{max-width:1400px;padding:40px 28px;margin:auto}header{padding-bottom:25px;border-bottom:1px solid var(--line)}h1{font-size:30px;line-height:1.4;margin:10px 0}h2{font-size:23px;margin:0}h3{font-size:20px;margin-top:0}.eyebrow,small,.muted{color:var(--muted)}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}a{color:var(--accent)}section{padding:32px 0;border-bottom:1px solid var(--line);scroll-margin-top:15px}.section-title{display:flex;gap:15px;align-items:center;margin-bottom:18px}.section-title span{font-size:28px;color:var(--muted)}.compare{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:22px}article{min-width:0;background:white;border:1px solid var(--line);border-radius:16px;padding:25px}.verdict{font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,Consolas,monospace;background:#f4f6f3;padding:15px;border-radius:8px;max-height:600px;overflow:auto}details{margin:16px 0}summary{cursor:pointer;font-weight:550}dl{display:grid;grid-template-columns:minmax(130px,1fr) 1.4fr;font-size:14px;gap:6px}dd{margin:0;overflow-wrap:anywhere}dt{color:var(--muted)}.file{display:block;border:1px solid var(--line);border-radius:10px;margin:10px 0;padding:13px 16px;text-decoration:none;overflow-wrap:anywhere}.file:hover{background:var(--bg)}.file small{display:block;font-size:12px}.summary{font-size:18px;max-width:1080px}.notice{border-left:3px solid var(--accent);padding:10px 20px;margin:20px 0}li{margin:8px 0}@media(max-width:850px){.compare{grid-template-columns:1fr}main{padding:24px 16px}h1{font-size:24px}article{padding:18px}}
</style><main><header><div class="eyebrow">伴行 V8 / 2026-11-03 / 真实服务运行 / 私有仓库评审材料</div><h1>同一个公网27B，换框架能交付多少？</h1><p class="summary">'''+esc(assessment['summary'])+'''</p><p>模型：Qwen/Qwen3.8-27B · SiliconFlow · temperature 0.1 · top_p 0.95 · max_tokens 8192 · thinking=false</p><nav><a href="#s19">源码修复</a><a href="#s11">发布简报</a><a href="#s15">合同到期清单</a><a href="#method">公平性与限制</a></nav><div class="notice">开发侧复测与原件回读；不是独立人工Gold、盲测或整体准确率。原始回答和产物原封保留，问题在外部标注。以下下载均嵌入HTML，离线可用。</div></header>'''+''.join(sections)+'''<section id="method"><h2>方法、失败与可解释的边界</h2><ul>'''+''.join('<li>'+esc(x)+'</li>' for x in assessment['method']+assessment['limitations'])+'''</ul><p>工程回归：342项，336通过、0失败、6跳过。它验证代码行为，不替代合同语义验收。</p><p>代码基线：'''+esc(assessment['productCommit'])+'''。</p><p>协议参考：<a href="https://learn.chatgpt.com/docs/config-file/config-reference">Codex模型接入</a> · <a href="https://learn.chatgpt.com/docs/windows/windows-sandbox">Windows MXC隔离</a> · <a href="https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation">SiliconFlow限流说明</a></p></section></main></html>'''
overview=f"3项任务 · 6组对照 · {sum(r['cumulativeActualPosts'] for r in records)}次实际公网POST · {sum(len(r['artifacts']) for r in records)}份真实成果 · 4份原件。以上不是通过率。"
html_doc=html_doc.replace('<nav>','<p class="muted">'+overview+'</p><nav>',1)
(destination/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
(destination/'index.html').write_text(html_doc,encoding='utf-8')
(root/'result.json').write_text(json.dumps({'status':'DEVELOPER_COMPARISON_COMPLETE','publication':str(destination),'model':manifest['settings']['model'],'runs':len(records),'downloads':len(downloads),'summary':assessment['summary'],'independentQa':'not performed'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'publication':str(destination),'runs':len(records),'downloads':len(downloads),'htmlBytes':len(html_doc.encode())}))
