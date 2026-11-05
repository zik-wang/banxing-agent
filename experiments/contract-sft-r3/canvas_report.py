"""Render only finished, hash-verified results into a single offline Codex canvas."""
import argparse,json
from pathlib import Path

def build(root,target):
 data=json.loads((root/'report-data.json').read_text(encoding='utf-8'))
 samples=json.loads((root/'data-audit/sample-examples.json').read_text(encoding='utf-8'))
 errors=json.loads((root/'error-analysis.json').read_text(encoding='utf-8'))
 # Curves and validation summaries are actual logs. Raw source examples stay local.
 compact={'model':data['model'],'parameters':data['parameter_count'],'trainable':data['trainable_parameter_count'],'arms':data['arms'],'results':data['results'],'diagnostic':data['post_hoc_format_diagnostic'],'gates':data['release_gates'],'protocol':data['protocol'],'decisions':data['data_audit']['decision_event_counts'],'sample_examples':samples,'error_examples':errors[:12],'error_count':len(errors),'test_responses':data['raw_responses'],'seconds':data['elapsed_seconds']}
 script=r'''import {Stack,Row,H1,H2,Text,Table,Button,Callout,Stat,LineChart,useState,useHostTheme,useCanvasAction} from "cursor/canvas";
const d=__DATA__;
const root=__ROOT__;
const pct=(x:number|null)=>x===null?"不适用":(100*x).toFixed(1)+"%";
export default function SFTStudy(){
 const theme=useHostTheme(),action=useCanvasAction();
 const [tab,setTab]=useState("测试结论"),[arm,setArm]=useState<"small300"|"full1200">("full1200"),[sample,setSample]=useState(0);
 const a=d.arms[arm],s=d.sample_examples[sample];
 const open=(path:string)=>action({type:"openFile",path:root+"/"+path});
 const pre={whiteSpace:"pre-wrap" as const,overflowWrap:"anywhere" as const,fontSize:12,lineHeight:1.6,padding:14,margin:0,background:theme.fill.secondary,color:theme.text.primary,borderRadius:6};
 return <Stack gap={20} style={{padding:24,color:theme.text.primary,background:theme.bg.editor}}>
  <H1>1.5B合同证据提取 · 系统SFT实测</H1>
  <Text tone="secondary">真实本地训练，公开英文人工标注＋明确标识的中文合成。训练、验证、测试分离；生产8884未改变，未上传权重。</Text>
  <Callout tone="warning" title="本轮未证明整体可靠，参考质量问题同样保留">两组未过全部原始门槛。主组金额/期限各32/32；条件8/32、例外10/32是严格参考匹配。9/16非空输出均来自付款前提，题意未明确排除，不能称9次否定误读。原模格式0不等于语义0。不替换27B主审。</Callout>
  <Row gap={24} wrap><Stat label="主训练QA" value="1,200"/><Stat label="小样本对照QA" value="300"/><Stat label="验证QA" value="64"/><Stat label="测试QA × 3组" value={String(d.test_responses)}/></Row>
  <Row gap={8} wrap>{["测试结论","训练与loss","数据去留","真实QA","失败对照"].map(x=><Button key={x} variant={tab===x?"primary":"secondary"} onClick={()=>setTab(x)}>{x}</Button>)}</Row>
  {tab==="测试结论"&&<Stack gap={14}>
   <H2>原模型、300条、1,200条：同一192条冻结测试</H2>
   <Text>中文128条是构造参考，英文64条是CUAD原始人工跨度标注；不可混称独立中文法律Gold。下表是严格JSON口径，格式失败不按空答案计对。</Text>
   <Table headers={["模型组","中文严格匹配 /128","英文匹配 /64","JSON合法 /192","原文引文合法","禁止例外组非空 /16","反事实对匹配 /16"]} rows={Object.entries(d.results).map(([name,v])=>[name,pct(v.by_corpus.zh_synthetic.exact_match),pct(v.by_corpus.cuad_human_reference.exact_match),pct(v.overall.schema_rate),pct(v.overall.raw_quote_valid_rate),v.overall.valid_schema===0?"不可评估：结构非法":pct(v.forbidden_exception_false_fill_rate),pct(v.counterfactual_pair_exact_rate)])}/>
   <H2>同一格式兼容诊断：事后补充，不改主分数</H2>
   <Text>只剥完整代码围栏、把裸字符串数组包为answers，所有组规则相同；不修改答案字符，不作语义修补。原模型多数给数组而不是指定对象，不能拿严格格式0当理解能力0。</Text>
   <Table headers={["模型组","兼容后中文EM /128","兼容后英文EM /64","兼容后合法结构 /192"]} rows={Object.entries(d.diagnostic.results).map(([name,v])=>[name,pct(v.by_corpus.zh_synthetic.exact_match),pct(v.by_corpus.cuad_human_reference.exact_match),pct(v.overall.schema_rate)])}/>
   <H2>事前冻结的门槛：逐项保留通过或失败</H2>
   <Table headers={["组别","格式≥98%","引文≥98%","中文≥90%","禁例外≤5%","英文≥80%","英文无明显退化","全部门槛"]} rows={Object.entries(d.gates).map(([name,v])=>[name,...Object.values(v.checks).map(x=>x?"达到":"未达"),v.passed?"达到":"未达到"])}/>
   <Callout tone="warning" title="可靠性只限本轮实际任务">原文引用合法不等于字段选对；低loss不等于法律正确。测试是短片段证据提取，不是完整合同漏审测评，不是算术测试，也没有重跑27B。因此不能声称超过27B或可独立签约审查。</Callout>
   <Table headers={["组别","中文EM cluster 95%区间","英文EM cluster 95%区间"]} rows={(["small300","full1200"] as const).map(name=>{const i=d.results[name].cluster_intervals;return [name,pct(i.zh_synthetic.lower95)+"–"+pct(i.zh_synthetic.upper95),pct(i.cuad_human_reference.lower95)+"–"+pct(i.cuad_human_reference.upper95)]})}/>
   <Text size="small" tone="secondary">中文按仅4个留出句式家族、英文按原合同聚类重采样1,000次；人工类别采样、短窗口和家族数量限制推广范围。不能把区间当整合同准确率。</Text>
  </Stack>}
  {tab==="训练与loss"&&<Stack gap={14}>
   <H2>实际优化器更新与检查点选择</H2>
   <Text>{d.model}：约15亿参数，并非1.5亿；本轮总参数{d.parameters.toLocaleString()}，LoRA可训练{d.trainable.toLocaleString()}。BF16基座/FP32适配器，rank8，q/v投影，AdamW 1e-4，microbatch1×累积4；只监督答案及结束符。</Text>
   <Row gap={8}>{(["small300","full1200"] as const).map(x=><Button key={x} variant={arm===x?"primary":"secondary"} onClick={()=>setArm(x)}>{x}</Button>)}</Row>
   <Table headers={["实际更新步","选中步","选中前呈现","唯一QA","最少/最多重复","选中dev loss","选中dev F1"]} rows={[[a.optimizer_steps,a.selected_step,a.selected_presentations,a.selected_distinct_rows,a.selected_min_repeats+"/"+a.selected_max_repeats,a.selection.validation_loss.toFixed(5),a.selection.dev_mean_corpus_f1.toFixed(4)]]}/>
   <H2>{arm}训练答案交叉熵</H2>
   <Text size="small">横轴：优化器更新step；纵轴：无单位交叉熵。来源：本轮training-log.jsonl，{a.raw_curve.length}个实际点；MA20为后向已有窗口均值。</Text>
   <LineChart categories={a.raw_curve.map(x=>String(x.step))} series={[{name:"每步4条答案loss均值",data:a.raw_curve.map(x=>x.loss),tone:"neutral"},{name:"后向20步均值",data:a.moving_average_20,tone:"info"}]} height={260} yMin={0} showValues={false}/>
   <H2>{arm}验证答案loss</H2>
   <Text size="small">横轴：每100个更新step；纵轴：64条验证QA的平均答案交叉熵。只有{a.history.length}个实际验证点，点间连线只作引导。</Text>
   <LineChart categories={a.history.map(x=>String(x.step))} series={[{name:"验证loss",data:a.history.map(x=>x.teacher_forced_loss),tone:"info"}]} height={220} yMin={0}/>
   <Table headers={["step","dev loss","中英等权F1","是否有选择资格","已见唯一QA"]} rows={a.history.map(x=>[x.step,x.teacher_forced_loss.toFixed(5),x.dev_mean_corpus_f1.toFixed(4),x.eligible_for_selection?"是":"否",x.distinct_rows_seen])}/>
   <Text>检查点只看验证F1，平手看loss；须已见全部训练行。最多600步/组，3次无改善早停。最大更新预算相同，实际选择步及重复次数可不同，不能说计算量完全匹配。两组选定后才运行测试，未按测试结果再调参。</Text>
   <Text>实际小组600步、主组384步：主组出现约116分钟原因未核实的执行/时钟间隙，触发组内一小时时间预算；未延长。两组均选300步。含间隙墙钟不是GPU活跃训练时长。</Text>
   <Row gap={8} wrap><Button onClick={()=>open(arm+"/training-log.jsonl")}>逐步sample ID与梯度日志</Button><Button onClick={()=>open("loss-curves.png")}>导出PNG曲线</Button><Button onClick={()=>open("training-code-freeze.json")}>数据与执行代码冻结SHA</Button></Row>
  </Stack>}
  {tab==="数据去留"&&<Stack gap={14}>
   <H2>增加的是新监督任务，排除理由逐条可查</H2>
   <Table headers={["集合","QA数","中文合成","英文人工跨度","文档ID数","有答案QA"]} rows={Object.entries(d.protocol.splits).map(([name,v])=>[name,v.rows,v.by_corpus.zh_synthetic,v.by_corpus.cuad_human_reference,v.documents,v.answerable])}/>
   <Text>主训练：480条中文QA来自120段构造条款，覆盖金额、付款条件、期限和允许/禁止暂缓付款；720条CUAD QA来自公开真实合同人工标注。300条是比例分层子集。旧R2的334条不复用，因为风险分类标签与本次摘录任务不同，旧测试也已暴露，不是根据模型答错删题。</Text>
   <Table headers={["去留理由","窗口×问题事件数"]} rows={Object.entries(d.decisions).map(([reason,count])=>[reason,count.toLocaleString()])}/>
   <Text>总事件不是训练样本数。CUAD源20,910个问题中，3,060个属于预先选定6类，17,850个其他类本轮不学；预算未选中不等于坏数据。跨窗口真答案排除，避免当负例；长答案范围受限，不能宣称覆盖复杂长条款。</Text>
   <H2>质量控制与修订边界</H2>
   <Text>23项数据检查＋7项协议测试：JSON/跨度/长度、合同ID/内容hash/句式家族无跨集交叉、原CUAD跨度重建、格式非法与空答案区分。训练10、验证2、测试4个中文句式家族；测试核心条件与否定措辞另行留出。没有独立中文法务双人标注或仲裁。</Text>
   <Callout tone="warning" title="机械QA通过不等于参考语义无争议">事后发现例外题未明确排除付款先决条件：训练90/120、验证6/8、测试24/32例外QA存在概念范围歧义。主组9条禁止例外组非空输出均引用先决条件。原分数/原数据保留，不事后删题提高成绩；下一轮先明确任务定义、独立审核参考，再训练。</Callout>
   <Button onClick={()=>open("reference-ambiguity-audit.json")}>逐ID参考歧义与9条实际输出</Button>
   <Text>v0→v1修订全部在训练前：300条按比例而非强行一半正例；留出核心措辞；修正小组排除不能污染主组处置账。主训练hash不变。训练中不动态加删样本、改标签、看错题后改测试。</Text>
   <Row gap={8} wrap><Button onClick={()=>open("data-decisions.jsonl")}>逐候选去留账</Button><Button onClick={()=>open("data-audit/summary.json")}>版本新增/移除ID</Button><Button onClick={()=>open("quality-checks.json")}>数据QA记录</Button></Row>
  </Stack>}
  {tab==="真实QA"&&<Stack gap={14}>
   <H2>保存的真实Q/A记录</H2>
   <Row gap={6} wrap>{d.sample_examples.map((x,i)=><Button key={x.id} variant={sample===i?"primary":"secondary"} onClick={()=>setSample(i)}>{x.split+" / "+x.corpus+" / "+(x.answers.length?"有答案":"空答案")}</Button>)}</Row>
   <Text size="small" tone="secondary">{s.id}；query={s.query_type}；SHA={s.context_sha256}</Text>
   <Text weight="semibold">Q：实际用户输入</Text><pre style={pre}>{s.messages[1].content}</pre>
   <Text weight="semibold">A：实际监督目标</Text><pre style={pre}>{s.messages[2].content}</pre>
   <details><summary>来源与跨度</summary><pre style={pre}>{JSON.stringify(s.source,null,2)}</pre></details>
   <Callout tone="info" title="样本含义">中文是程序构造的原文摘录答案，不是法律专家裁决；英文保留CUAD原作者答案和全局位置。空数组只指给定窗口未有相应标注。</Callout>
  </Stack>}
  {tab==="失败对照"&&<Stack gap={14}>
   <H2>至少一组不匹配的测试QA：{d.error_count}条，全部保存</H2>
   <Text>这里显示前12条，完整error-analysis.json保留每个错误及三组原始输出，没有删除失败样本或重定义参考。</Text>
   {d.error_examples.map(e=><details key={e.id}><summary>{e.id+" / "+e.corpus+" / "+e.query_type}</summary><pre style={pre}>{JSON.stringify(e,null,2)}</pre></details>)}
   <Button onClick={()=>open("error-analysis.json")}>打开完整错误对照</Button>
  </Stack>}
  <Row gap={8} wrap><Button onClick={()=>open("系统SFT实验报告.html")}>离线完整HTML</Button><Button onClick={()=>open("完整SFT过程与质量报告.md")}>完整文字报告</Button><Button onClick={()=>open("report-verification.json")}>交付一致性检查</Button></Row>
 </Stack>;
}
'''
 script=script.replace('__DATA__',json.dumps(compact,ensure_ascii=False,separators=(',',':'))).replace('__ROOT__',json.dumps(str(root).replace('\\','/')))
 target.write_text(script,encoding='utf-8');print(str(target))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--target',type=Path,required=True);a=p.parse_args();build(a.root,a.target)
