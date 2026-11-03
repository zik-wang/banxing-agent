// Presentation of persisted review evidence, never a new model review or a legal verdict.
export function reviewHighlights(run){
 const groups=run.report_groups||[],findings=new Map((run.findings||[]).map(f=>[f.finding_id,f])),units=new Map((run.evidence_units||[]).concat((run.documents||[]).flatMap(d=>d.units||[])).map(u=>[u.id,u]));
 const chosen=groups.slice(0,3),lines=['报告已生成。以下是本次材料中需要优先核对的候选问题：'];
 for(const [i,g] of chosen.entries()){
  const members=g.memberFindingIds.map(id=>findings.get(id)).filter(Boolean),first=g.subIssues[0],evidence=members.flatMap(f=>f.evidence||[]),quote=evidence.find(e=>e.quote||e.raw_text),loc=g.evidenceLinks.filter(e=>e.role==='support').map(e=>e.evidenceId);
  const raw=quote?.quote||quote?.raw_text||loc.map(id=>units.get(id)?.raw_text).find(Boolean);
  lines.push(`${i+1}. ${g.title}。${first?.summary||''}`+(raw?'\n依据：'+raw.slice(0,180):loc.length?'\n依据位置：'+loc.join('、'):'\n依据范围须在报告中回查，不能据标题确认风险。')+'\n下一步：'+(first?.suggestion||g.unresolvedQuestions[0]||'结合完整条款和附件核实后再决定是否修改。')+(first?.interpretationSpace?'\n解释空间：'+first.interpretationSpace:''));
 }
 if(!chosen.length)lines.push('现有证据不足以归纳重要风险；不据此认定没有风险或合同可签。');
 lines.push('材料限制：仅按本次实际提供的材料审核；公开节录不等于完整签署合同，未提供附件及履约事实未核实。法律依据尚未核验，候选问题及模型分歧保留待核；报告生成不代表合同可签。');
 return lines.join('\n\n');
}
