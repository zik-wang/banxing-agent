"""Build the result from preserved logs; never generates, trains, or repairs answers."""
import argparse,base64,collections,hashlib,html,json,statistics
from datetime import datetime,timezone
from pathlib import Path
from metrics import parse,score,aggregate

def load(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def pct(x):return '不适用' if x is None else f'{x:.1%}'
def false_fill_display(s):return '不可评估：结构非法' if s['overall']['valid_schema']==0 else pct(s['forbidden_exception_false_fill_rate'])
def table(head,data):return '\n'.join(['| '+' | '.join(head)+' |','|'+'|'.join(['---']*len(head))+'|']+['| '+' | '.join(str(x).replace('|','\\|').replace('\n',' ') for x in row)+' |' for row in data])
def render_markdown(text):
 lines=text.splitlines();out=[];paragraph=[];in_table=False
 def flush():
  if paragraph:out.append('<p>'+html.escape(' '.join(paragraph))+'</p>');paragraph.clear()
 for line in lines:
  if line.startswith('|'):
   flush()
   if set(line.replace('|','').replace('-','').strip())<=set(': '):continue
   cells=[html.escape(x.strip()) for x in line.strip('|').split('|')]
   if not in_table:out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+x+'</th>' for x in cells)+'</tr></thead><tbody>');in_table=True
   else:out.append('<tr>'+''.join('<td>'+x+'</td>' for x in cells)+'</tr>')
   continue
  if in_table:out.append('</tbody></table></div>');in_table=False
  if line.startswith('### '):flush();out.append('<h3>'+html.escape(line[4:])+'</h3>')
  elif line.startswith('## '):flush();out.append('<h2>'+html.escape(line[3:])+'</h2>')
  elif line.startswith('# '):flush();out.append('<h2>'+html.escape(line[2:])+'</h2>')
  elif not line.strip():flush()
  else:paragraph.append(line)
 flush()
 if in_table:out.append('</tbody></table></div>')
 return ''.join(out)

def build(root,plot_deps):
 result=load(root/'final-results.json');freeze=load(root/'training-code-freeze.json');protocol=load(root/'experiment-protocol.json');diagnostic=load(root/'format-diagnostic.json')
 qa=load(root/'quality-checks.json');data_audit=load(root/'data-audit/summary.json');vocabulary=load(root/'data-audit/value-overlap.json');datasets={s:rows(root/(s+'.jsonl')) for s in ['train','train_small','dev','test']}
 assert all(sha(root/(s+'.jsonl'))==v for s,v in freeze['datasets'].items())
 assert all(sha(root/'executed-code'/n)==v for n,v in freeze['code_sha256'].items())
 assert sha(root/'experiment-protocol.json')==freeze['protocol_sha256']
 assert sha(root/'data-decisions.jsonl')==freeze['data_decisions_sha256']
 assert sha(root/'quality-checks.json')==freeze['quality_checks_sha256']
 test=datasets['test'];predictions={arm:rows(root/f'test-{arm}.jsonl') for arm in ['baseline','small300','full1200']}
 for arm,p in predictions.items():
  assert len(p)==len(test) and len({x['id'] for x in p})==len(test)
  assert score(test,p)=={k:v for k,v in result['results'][arm].items() if k!='cluster_intervals'}
  byid={x['id']:x for x in p}
  for r in test:
   expected=hashlib.sha256(json.dumps(r['messages'][:-1],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
   assert byid[r['id']]['input_sha256']==expected and byid[r['id']]['context_sha256']==r['context_sha256']
 arms={}
 for arm in ['small300','full1200']:
  log=rows(root/arm/'training-log.jsonl');history=load(root/arm/'validation-history.json');selection=load(root/arm/'selected-checkpoint.json');selectedlog=[x for x in log if x['step']<=selection['step']]
  all_ids=[m['id'] for x in selectedlog for m in x['sample_trace']];seen=collections.Counter(all_ids)
  expected_ids={r['id'] for r in datasets['train_small' if arm=='small300' else 'train']}
  assert set(seen)==expected_ids
  adapter=Path(selection['path'])/'adapter_model.safetensors';assert sha(adapter)==selection['sha256']
  gaps=[log[i]['elapsed_seconds']-log[i-1]['elapsed_seconds'] for i in range(1,len(log))]
  arms[arm]={'optimizer_steps':len(log),'selected_step':selection['step'],'selection':selection,'history':history,'raw_curve':[{'step':x['step'],'loss':x['loss']} for x in log],'moving_average_20':[statistics.mean(x['loss'] for x in log[max(0,i-19):i+1]) for i in range(len(log))],'selected_presentations':len(all_ids),'selected_distinct_rows':len(seen),'selected_min_repeats':min(seen.values()),'selected_max_repeats':max(seen.values()),'selected_prompt_tokens':sum(m['prompt_tokens'] for x in selectedlog for m in x['sample_trace']),'selected_target_tokens_with_eos':sum(m['target_tokens'] for x in selectedlog for m in x['sample_trace']),'first20_mean_loss':statistics.mean(x['loss'] for x in log[:20]),'last20_mean_loss':statistics.mean(x['loss'] for x in log[-20:]),'first_loss':log[0]['loss'],'last_loss':log[-1]['loss'],'total_training_presentations':4*len(log),'training_and_dev_seconds':max(log[-1]['elapsed_seconds'],history[-1]['elapsed_seconds']),'largest_between_update_seconds':max(gaps),'last_validation_seconds':history[-1]['elapsed_seconds'],'peak_cuda_gib':max(x['peak_cuda_allocated'] for x in log)/1024**3,'selected_adapter_sha256':selection['sha256']}
 errors=[];byarm={a:{p['id']:p for p in ps} for a,ps in predictions.items()};field_results={}
 for arm,p in byarm.items():
  expanded=[{**r,'raw':p[r['id']]['raw'],'predicted':parse(p[r['id']]['raw'])} for r in test]
  field_results[arm]={}
  for corpus,field in sorted({(r['corpus'],r['query_type']) for r in test}):
   selected=[r for r in expanded if (r['corpus'],r['query_type'])==(corpus,field)]
   groups={'all':selected,'nonempty':[r for r in selected if r['answers']],'empty':[r for r in selected if not r['answers']]}
   field_results[arm][corpus+'/'+field]={k:aggregate(v) for k,v in groups.items() if v}
 for r in test:
  values={a:parse(byarm[a][r['id']]['raw']) for a in byarm}
  correct={a:v is not None and set(v)==set(r['answers']) for a,v in values.items()}
  if not all(correct.values()):errors.append({'id':r['id'],'corpus':r['corpus'],'query_type':r['query_type'],'context':r['context'],'query':r['query'],'expected':r['answers'],'actual':values,'raw':{a:byarm[a][r['id']]['raw'] for a in byarm},'correct':correct,'source':r['source']})
 save(root/'error-analysis.json',errors)
 save(root/'field-results.json',field_results)
 report={'at':datetime.now(timezone.utc).isoformat(),'experiment_id':root.name,'model':protocol['base_model'],'parameter_count':load(root/'loaded-model-1.json')['total'],'trainable_parameter_count':load(root/'loaded-model-1.json')['trainable'],'protocol':protocol,'data_audit':data_audit,'data_qa':qa,'arms':arms,'results':result['results'],'field_results':field_results,'release_gates':result['release_gates'],'elapsed_seconds':result['elapsed_seconds'],'test_cases':192,'raw_responses':sum(len(v) for v in predictions.values()),'failures_saved':len(errors),'production_changed':False,'independent_chinese_legal_gold':False,'test_used_for_selection':False,'cloud_requests':0,'hashes_rechecked':True}
 report['post_hoc_format_diagnostic']=diagnostic
 report['post_test_reference_quality']=load(root/'reference-ambiguity-audit.json')
 save(root/'report-data.json',report)
 # Scientific figures use the actual optimizer logs; no invented interpolation points.
 import sys
 sys.path.insert(0,str(plot_deps))
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 from matplotlib.font_manager import FontProperties
 plt.rcParams['font.family']=FontProperties(fname='C:/Windows/Fonts/msyh.ttc').get_name();plt.rcParams['axes.unicode_minus']=False
 plt.rcParams.update({'axes.spines.top':False,'axes.spines.right':False,'font.size':10,'svg.fonttype':'none'})
 fig,axes=plt.subplots(2,2,figsize=(13,8))
 for col,arm in enumerate(['small300','full1200']):
  a=arms[arm];x=[r['step'] for r in a['raw_curve']];y=[r['loss'] for r in a['raw_curve']]
  axes[0,col].plot(x,y,color='#b5bbc1',lw=.7,label='每步4条答案loss均值');axes[0,col].plot(x,a['moving_average_20'],color='#285e87',lw=1.6,label='后向20步均值')
  axes[0,col].axvline(a['selected_step'],color='#555555',ls='--',lw=.9,label='验证集选定步')
  axes[0,col].set(title=f'{arm}：{len(x)}个实际更新点',xlabel='优化器更新步数（step）',ylabel='训练答案交叉熵（无单位）',ylim=(0,None));axes[0,col].legend(frameon=False,fontsize=8)
  h=a['history'];vx=[v['step'] for v in h];vy=[v['teacher_forced_loss'] for v in h]
  axes[1,col].plot(vx,vy,color='#285e87',marker='o',label='64条验证集loss')
  ax2=axes[1,col].twinx();ax2.plot(vx,[v['dev_mean_corpus_f1'] for v in h],color='#727575',marker='s',ls=':',label='中英等权F1');ax2.set_ylim(0,1);ax2.set_ylabel('精确答案集合F1（0–1）')
  axes[1,col].set(title=f'{arm}：{len(h)}次实际验证',xlabel='优化器更新步数（step）',ylabel='验证答案交叉熵（无单位）',ylim=(0,None));axes[1,col].set_xticks(vx)
  handles=axes[1,col].get_lines()+ax2.get_lines();axes[1,col].legend(handles,[line.get_label() for line in handles],frameon=False,loc='lower left',fontsize=8)
  for xx,yy in zip(vx,vy):axes[1,col].annotate(f'{yy:.3f}',(xx,yy),xytext=(0,7),textcoords='offset points',ha='center',fontsize=8)
 fig.suptitle('Qwen2.5-1.5B R3 · 真实SFT过程与验证',fontsize=15)
 fig.text(.02,.02,'来源：small300/full1200 training-log.jsonl与validation-history.json。训练仅监督答案及结束符；验证点间连线只作引导。低loss不等于法律审查正确率。',fontsize=8.5)
 fig.tight_layout(rect=[0,.045,1,.96]);fig.savefig(root/'loss-curves.png',dpi=155);fig.savefig(root/'loss-curves.svg');plt.close(fig)
 sections=[]
 sections.append('# Qwen1.5B 合同证据提取：系统SFT实测报告\n\n这是一轮真实完成的本地训练与留出测试；范围为合同片段的原文证据提取。没有训练完整法律裁决、算术或全文漏审检测。旧R2结果不覆盖，也不与本轮测试混成同一准确率。')
 gate_status='；'.join(a+'：'+('达到全部预注册门槛' if g['passed'] else '未达到全部预注册门槛') for a,g in result['release_gates'].items())
 sections.append('## 1. 可作出的结论\n\n'+gate_status+'。每个门槛的原始判定见下表。即使通过，也只支持此冻结片段测试，不支持独立中文法务可靠性、陌生整合同零漏项或超越27B。中文例外参考存在事后发现的任务边界歧义，以下是冻结构造参考匹配分数，不是可信法务准确率。\n\n'+table(['组别','中文精确匹配/128','英文精确匹配/64','合法JSON/192','引文确在原文','禁止例外参考组返回非空/16','反事实对同时匹配/16'],[[a,pct(s['by_corpus']['zh_synthetic']['exact_match']),pct(s['by_corpus']['cuad_human_reference']['exact_match']),pct(s['overall']['schema_rate']),pct(s['overall']['raw_quote_valid_rate']),false_fill_display(s),pct(s['counterfactual_pair_exact_rate'])] for a,s in result['results'].items()]))
 sections[1]+='\n\n本轮实际选择：不替换27B主审，不把新适配器用于自动确认条件或例外。1,200条组金额/付款期限各32/32，仅证明这些有限构造输入的表现；条件8/32、例外10/32是严格参考匹配，不全等于语义判断错误。禁止例外参考组9/16返回非空，经逐例核读，9条都引用付款前提，不能称九次否定读反。增加4倍数据只把严格总匹配数132/192变为133/192，英文52/64降为51/64；主组验证机会也较少，不支持数据量越大必然更好或小数据必然更优。\n\n### 必须分开的格式收益与提取收益\n\n原模型大量返回裸数组而不是约定的answers对象，严格协议下为0，不能解释为语义能力为0。为避免夸大SFT收益，测试后追加同一规则的兼容诊断：只剥完整代码围栏，并把裸字符串数组包成answers；不改任何答案字符、边界或含义。这个诊断是事后补充，不是预注册主分数；原始输出和门槛判定不变。\n\n'+table(['组别','兼容诊断中文EM/128','兼容诊断英文EM/64','兼容后合法结构/192'],[[a,pct(s['by_corpus']['zh_synthetic']['exact_match']),pct(s['by_corpus']['cuad_human_reference']['exact_match']),pct(s['overall']['schema_rate'])] for a,s in diagnostic['results'].items()])+'\n\n原始格式类型数量及逐字段诊断见format-diagnostic.json。不能拿严格口径的原模型0与兼容口径的微调结果比较。'
 sections.append('## 2. 数据为什么这样增加、删除\n\n旧R2全部334条未复用：旧任务是风险分类，部分负例依据弱、旧测试已暴露；不是答错才删。增加480条中文构造训练QA，专门区分金额/违约金、付款条件/期限、允许/禁止例外；增加720条CUAD训练QA，保留真实合同的人工原文标注。中文合成是构造oracle，英文是原作者专家指导的标注，二者不能混称本项目独立人工Gold。\n\n'+table(['集合','总QA数','中文合成','英文CUAD','文档ID数','非空答案数'],[[s,v['rows'],v['by_corpus']['zh_synthetic'],v['by_corpus']['cuad_human_reference'],v['documents'],v['answerable']] for s,v in protocol['splits'].items()])+'\n\n1,200条是QA数量，不是1,200份合同；480条中文来自120段训练条款。300条是主训练集的比例分层子集。重复epoch不算新增数据。\n\n'+table(['候选去留原因','事件数','解释'],[[k,n,{'excluded:bounded_budget_not_selected':'预算内分层选样，不能称为标注错误','excluded:answer_crosses_fixed_window_boundary':'不能把被切断的真答案当成无答案','excluded:reference_output_over300chars_or3spans':'固定短证据任务范围，牺牲复杂长答案覆盖','excluded:full_example_over768tokens_no_truncation':'不截断冒充完整读取','excluded:exact_normalized_duplicate_with_test_dev_priority':'防止完全相同输入跨集合泄漏','excluded:per_document_selection_cap':'避免单份合同支配有限训练集','included:frozen_stratified_selection':'最终主训练/验证/测试保留事件'}.get(k,'详见逐事件账')] for k,n in data_audit['decision_event_counts'].items()])+'\n\n上表单位是“窗口×问题的处置事件”，不是独立合同或训练样本。原CUAD共20,910个问题，其中3,060个属于预先选择的6类，17,850个其他类别不在本轮范围；窗口候选、源问题、最终QA不能相加。未选择的数据未删除原件。每项源问题范围决定、候选事件、旧R2排除ID及v0→v1变动ID均保留。')
 sections.append('## 3. 划分、QA与泄漏控制\n\nCUAD保留官方102份测试合同；408份官方训练合同中先按固定hash划40份做验证，其他用于训练候选。固定不重叠的700字符窗口不按答案位置挑选。中文训练10种、验证2种、测试4种句式家族，测试条件/否定措辞不同，另有16组允许/禁止反事实对。\n\n23项冻结前数据检查及7项协议单元测试通过：JSON目标、引文精确回源、长度、集合间文档/家族/内容hash隔离、原CUAD跨度独立重建、格式失败不能冒充空答案。没有独立中文法务双人标注/仲裁，未声称语义近重复全部排除。先固定两组检查点再打开测试生成。\n\n额外核对了答案词汇重合：\n\n'+table(['语料/字段','训练不同答案串','测试不同答案串','测试串已在训练出现'],[[r['corpus']+'/'+r['field'],r['train_distinct_answers'],r['test_distinct_answers'],r['test_answer_strings_seen_in_train']] for r in vocabulary['rows']])+'\n\n中文条件和例外各只有4种核心内容，测试仍用这4种；期限值也重合。句式家族隔离不等于业务概念/值域全新，因此不证明陌生复杂条件泛化。中文金额12种测试值未在训练出现，但也只是固定构造分布。公开CUAD可能被基础模型预训练见过，本轮无法排除。\n\nv0→v1只在训练前修订：300条改比例分层；留出条件/否定核心措辞隔离；修正小子集排除理由不能覆盖主集。主1,200条hash没变。训练中没有按loss删题、补答案或改测试。')
 sections.append('## 4. 实际训练过程\n\n基础模型是Qwen2.5-1.5B-Instruct（约15亿参数，并非1.5亿）。本轮实际总参数'+str(report['parameter_count'])+'；只更新'+str(report['trainable_parameter_count'])+'个LoRA参数。BF16基座、FP32适配器，rank8、alpha16、dropout0.05，作用于q_proj/v_proj。AdamW lr1e-4、weight_decay0.01、梯度裁剪1；microbatch1、累积4。仅assistant答案及结束符计算loss，提示词标签为-100。\n\n每epoch无放回打乱，保证见完所有行后才重复；固定seed61105。每100步对64条dev计算答案loss并实际生成，按中英等权的精确答案集合F1选权重，平手才比较loss。小组最早100步、主组最早300步且全部样本见过才有选择资格；连续3次无改善早停，最多600步/组。每组最多1小时，总任务3小时。\n\n'+table(['组别','实际更新步','选中步','选中前呈现数','唯一QA','每QA最少/最多次数','选中dev loss','选中dev F1','首20步平均loss','末20步平均loss'],[[a,v['optimizer_steps'],v['selected_step'],v['selected_presentations'],v['selected_distinct_rows'],str(v['selected_min_repeats'])+'/'+str(v['selected_max_repeats']),f"{v['selection']['validation_loss']:.6f}",f"{v['selection']['dev_mean_corpus_f1']:.4f}",f"{v['first20_mean_loss']:.6f}",f"{v['last20_mean_loss']:.6f}"] for a,v in arms.items()])+'\n\n最大更新预算相同，实际早停/选中步和重复次数可能不同。因此这是一组可复核数据量消融，不能声称所有计算量完全相等或精确因果。loss没有“必须降到多少”的硬目标；是否可靠以事前冻结的测试门槛判定。')
 sections.append('## 5. 测试定义与逐项门槛\n\n原模型、300条、1,200条全部使用相同系统/用户输入、greedy生成、最多160个新token。共192个QA×3组='+str(report['raw_responses'])+'条真实本地输出。每条输入hash、上下文hash、输出、耗时和终止原因均保存。严格JSON为主指标；剥除代码围栏的结果仅单列，不修正语义。\n\n精确匹配=预测答案集合与参考集合完全相同的例数/N；答案集合F1=2×交集数/(预测数+参考数)，双方空为1、格式非法为0。引文在原文只检查字面来源，不能证明取对字段。空窗口只说明此窗口没有标注答案，不说明全文没有对应条款。\n\n'+table(['组别','格式≥98%','引文≥98%','中文EM≥90%','禁止例外错填≤5%','英文EM≥80%','英文较原模下降≤2百分点','总门槛'],[[a,*[str(g['checks'][k]) for k in ['format','source_quote','chinese_exact','forbidden_exception','english_exact','english_no_regression']],g['passed']] for a,g in result['release_gates'].items()])+'\n\n置信区间按英文文档或中文句式家族做cluster bootstrap；中文只有4个测试家族，即使数字高也不能推断广泛语言泛化。类别分层采样的发生率是人为设计，不能当真实业务风险发生率。')
 sections.insert(5,'### 实际token量与时间\n\n'+table(['组别','选中步之前提示token呈现','受监督答案token呈现（含结束符）','组内日志累计秒数（含间隙）','完整训练呈现次数','最大相邻更新间隔秒'],[[a,v['selected_prompt_tokens'],v['selected_target_tokens_with_eos'],f"{v['training_and_dev_seconds']:.1f}",v['total_training_presentations'],f"{v['largest_between_update_seconds']:.1f}"] for a,v in arms.items()])+'\n\n主组有约116分钟执行/时钟间隙，原因未核实；触发原定一小时组内预算，在384步停止，未放宽限制。保留第300步权重；小组600步。不能把含间隙的墙钟当GPU活跃训练时长，也不能声称等时对照。两组被选中检查点均为300步时，各1,200条呈现，但唯一训练行和重复次数不同。\n\n主训练单次全量的输入＋答案共296,778 token，JSON答案15,129 token（这里不含chat结束符）；300条为74,624/3,655 token。上下文token和真正进入loss的答案token不能混称。重复呈现token不是新增语料。这是有限算力下的窄任务实验，不是大规模中文法务知识训练。整轮加载、训练、验证、三组测试共'+f"{result['elapsed_seconds']/60:.1f}"+'分钟（含上述间隙），公网API请求0。')
 sections.append('## 6. 失败与适用边界\n\n完整失败对照在error-analysis.json，包含实际原文、问题、参考、三组原始输出，不删除错误例。不能把格式改善当语义全面改善，也不能把金额原文摘录当作会算元/万元/亿元。\n\n'+table(['字段/范围','N','原模型EM','300条EM','1200条EM'],[[field,v['all']['n'],*[pct(field_results[a][field]['all']['exact_match']) for a in ['baseline','small300','full1200']]] for field,v in field_results['baseline'].items()])+'\n\n逐字段的非空/空答案分组见field-results.json，避免把全答空混成能力提升。字段分项是诊断数据，不是在看到结果后另设通过门槛。即使禁止例外错填0/16，也不能证明业务错填率≤5%：假设16例独立，零失败的95%单侧二项上界为1−0.05^(1/16)≈17.1%；实际句式还存在聚类相关。达到经验门槛不等于统计保证。\n\n本轮没有重跑27B，更没有用新测试成绩与旧27B不同任务成绩作公平排名。没有完整合同风险召回、跨条款法律冲突、OCR/批注解析和真实用户签收证明。生产8884未改变，模型权重未推GitHub。任何门槛没过都保留未过结论，不在看到测试后再改阈值或调参。只有一个训练seed，置信区间不包含重训随机性的估计，不能据此宣称训练收益稳定。')
 sections.append('## 7. 复现与证据\n\n入口：experiments/contract-sft-r3/prepare.py → finalize.py → train.py → audit_dataset.py → report.py。实际运行代码副本和SHA在executed-code/、training-code-freeze.json。运行时原始依赖版本见environment.json、loaded-model-*.json；完整安装版本另存dependency-versions.json。\n\n数据：train/train_small/dev/test.jsonl及freeze.json；去留：data-decisions.jsonl、data-audit/；优化：两组training-log.jsonl和validation-history.json；权重选择：selected-checkpoint.json及selection-seal.json；实际输出：test-*.jsonl；评分：final-results.json。每步保留4条sample ID/loss/token数，能重算呈现次数与覆盖。\n\nCUAD来源及许可：https://www.atticusprojectai.org/cuad/ ，CC BY4.0；论文：https://arxiv.org/abs/2103.06268 。中文条款由本轮程序构造并明确标识。所有结果局限于冻结版本；新训练须新目录，不能覆盖本轮。')
 ambiguity=report['post_test_reference_quality'];example=ambiguity['full_arm_forbidden_nonempty'][0]
 sections.insert(4,'### 事后发现的数据QA缺口：付款前提不等于明确例外槽\n\n先前23项检查和7项协议测试都是机械/结构检查，没有证明中文任务定义及参考语义充分。测试后逐例核读发现：问题问“允许暂缓付款的条件”，参考只追踪明确例外句；同一片段又写有付款义务尚未触发的先决条件，问题没有清楚排除这类答案。原始禁止例外计数不能直接解释为模型把否定读反。\n\n'+table(['集合','例外QA数','同时有付款前提、存在范围歧义','其中禁止例外参考组'],[[s,v['exception_qas'],v['potentially_ambiguous'],v['forbidden_subset_with_prerequisite']] for s,v in ambiguity['counts'].items()])+'\n\n主组9条禁止例外参考组非空输出，全部含付款前提的核心原文，未证实为9次法律判断错误。例如：\n\n原文：'+example['context']+'\n\n构造参考：[]；实际：'+json.dumps(example['actual'],ensure_ascii=False)+'。\n\n处理：标记问题定义/参考待仲裁，不擅自改Gold，不剔除这些题重算漂亮分数，不重训采样到成功。reference-ambiguity-audit.json保存逐ID及实际输出，原训练/测试/得分hash不变。下一轮须先明确只摘录“已触发付款义务后的显式暂缓权利”，或把先决条件与例外分成独立字段，再由独立标注审核后冻结新留出集。这些90条训练候选为何被加入、为何未来需要复核均可追溯；本轮没有事后删除它们。门槛中的english_no_regression以严格结构失败的原模0为基线，只是原协议布尔结果，不能独立证明语义不退化。')
 sections.insert(-1,'### 如何理解严格提取分数\n\n答案集合按完整字符串匹配，不是token重叠F1。不同摘录边界、额外冠词或日期标点差异也可能算不匹配；因此“错误对照”不是已经确认的法律错误清单。它保留原文与三组输出，供逐例判断。没有在看到测试后放宽标准、做语义修补或删除边界错误。')
 text='\n\n'.join(sections)+'\n';(root/'完整SFT过程与质量报告.md').write_text(text,encoding='utf-8')
 # Standalone HTML: local plots embedded, full result and representative Q/A inspectable offline.
 css='body{font:16px/1.8 system-ui,sans-serif;max-width:1160px;margin:40px auto;padding:0 24px;color:#20303d;background:#fafafa}h1{font-size:28px;line-height:1.4}h2{font-size:21px;margin-top:36px;line-height:1.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f2f3;padding:16px;font-size:13px}img{max-width:100%;height:auto}details{border-top:1px solid #ddd;padding:12px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:9px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th{background:#edf1f4}section{margin:28px 0}a{color:#285e87}.table-wrap{overflow:auto;margin:20px 0}p{overflow-wrap:anywhere}summary{cursor:pointer}nav{display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid #ddd;padding-bottom:16px}@media(max-width:640px){body{margin:20px auto;padding:0 14px}h1{font-size:23px}td,th{min-width:90px}}'
 # Deliberately minimal Markdown renderer: escape all dataset/model values, tables rendered independently.
 body=['<h1>Qwen1.5B 系统SFT：真实过程与质量</h1>',f'<p>{html.escape(gate_status)}。本报告可离线打开；不是法律意见或生产验收。</p>','<p><strong>结论：有局部提取收益，未证明整体可靠，不替换27B主审。</strong><br>1,200条组：金额32/32、付款期限32/32。例外题存在参考歧义：9/16非空输出都取自付款前提，不能直接认定为否定误读。576条真实测试输出和原始分数全部保留，不删题提高成绩。</p>','<img alt="实际训练和验证loss曲线" src="data:image/png;base64,'+base64.b64encode((root/'loss-curves.png').read_bytes()).decode()+'">']
 body.append('<nav>'+''.join('<a href="#s'+str(i)+'">'+html.escape(section.splitlines()[0].lstrip('# '))+'</a>' for i,section in enumerate(sections[1:],1))+'</nav>')
 for i,section in enumerate(sections):body.append('<section id="s'+str(i)+'">'+render_markdown(section)+'</section>')
 for sample in load(root/'data-audit/sample-examples.json'):
  body.append('<details><summary>真实QA样本：'+html.escape(sample['split']+' / '+sample['corpus']+' / '+sample['query_type'])+'</summary><pre>'+html.escape(json.dumps({'id':sample['id'],'Q':sample['messages'][1]['content'],'A':sample['messages'][2]['content'],'source':sample['source']},ensure_ascii=False,indent=2))+'</pre></details>')
 for error in errors:
  body.append('<details><summary>错误对照 '+html.escape(error['id']+' / '+error['query_type'])+'</summary><pre>'+html.escape(json.dumps(error,ensure_ascii=False,indent=2))+'</pre></details>')
 body.append('<details><summary>完整指标和冻结参数</summary><pre>'+html.escape(json.dumps(report,ensure_ascii=False,indent=2))+'</pre></details>')
 (root/'系统SFT实验报告.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qwen1.5B 系统SFT实测</title><style>'+css+'</style>'+''.join(body)+'</html>',encoding='utf-8')
 save(root/'report-verification.json',{'at':datetime.now(timezone.utc).isoformat(),'test_outputs_recomputed':True,'test_input_hashes_all_576_checked':True,'frozen_data_protocol_executed_code_hashes_unchanged':True,'selected_adapters_hashes_unchanged':True,'selected_coverage_recomputed':True,'prediction_count':report['raw_responses'],'report_contains_every_failure':len(errors),'independent_qa_performed':False,'html_plot_standalone':True})
 # Safe summary contains no source text, raw prediction text, credentials or local model weights.
 save(root/'sanitized-summary.json',{'experiment_id':root.name,'model':report['model'],'trainable_parameters':report['trainable_parameter_count'],'dataset_sizes':{s:len(v) for s,v in datasets.items()},'selected_steps':{a:v['selected_step'] for a,v in arms.items()},'actual_optimizer_steps':{a:v['optimizer_steps'] for a,v in arms.items()},'results':result['results'],'post_hoc_format_diagnostic':diagnostic,'reference_quality':{'stage':ambiguity['stage'],'counts':ambiguity['counts'],'all_nonempty_are_alternative_prerequisites':ambiguity['all_nonempty_are_alternative_prerequisites'],'decision':ambiguity['decision']},'release_gates':result['release_gates'],'limitations':['excerpt extraction only','synthetic Chinese, no independent Chinese legal gold','exception reference question scope is underspecified','not 27B comparison','no production deployment','unexplained execution gap, full arm budget-stopped'],'weights_in_git':False})
 print(json.dumps({'report':str(root/'系统SFT实验报告.html'),'gates':result['release_gates'],'responses':report['raw_responses']},ensure_ascii=True))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--plot-deps',type=Path,required=True);a=p.parse_args();build(a.root,a.plot_deps)
