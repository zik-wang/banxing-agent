// Presentation of persisted review evidence, never a new model review or a legal verdict.
export function reviewHighlights(run){
 const groups=run.report_groups||[],findings=new Map((run.findings||[]).map(f=>[f.finding_id,f])),units=new Map((run.evidence_units||[]).concat((run.documents||[]).flatMap(d=>d.units||[])).map(u=>[u.id,u]));
 const chosen=groups.slice(0,3),lines=['报告已生成。优先核对以下候选问题（节选；完整条件和替代建议见报告）：'],citations=new Map(),clip=(s,n)=>{s=String(s||'');return Array.from(s).length>n?Array.from(s).slice(0,n).join('')+'…':s;};
 for(const [i,g] of chosen.entries()){
  const members=g.memberFindingIds.map(id=>findings.get(id)).filter(Boolean),first=g.subIssues[0],evidence=members.flatMap(f=>f.evidence||[]),quote=evidence.find(e=>e.quote||e.raw_text),loc=g.evidenceLinks.filter(e=>e.role==='support').map(e=>e.evidenceId);
  const raw=quote?.quote||quote?.raw_text||loc.map(id=>units.get(id)?.raw_text).find(Boolean);
  const topics=(run.checks||[]).filter(c=>g.topicIds?.includes(c.id)).map(c=>c.title).filter(Boolean);
  lines.push(`${i+1}. ${topics[0]||g.title}`+'\n关注点：'+clip(first?.summary||g.title,160)+'\n下一步：'+clip(first?.suggestion||g.unresolvedQuestions[0]||'结合完整条款和附件核实后再决定是否修改。',140)+(first?.interpretationSpace?'\n解释空间：'+first.interpretationSpace:'')+'\n依据位置：'+(loc.join('、')||'须回查报告，不能据标题确认风险。'));
  if(raw){const key=loc.join('|')||raw;if(!citations.has(key))citations.set(key,{loc,raw});}
 }
 if(!chosen.length)lines.push('现有证据不足以归纳重要风险；不据此认定没有风险或合同可签。');
 if(citations.size)lines.push('原文节选：\n'+[...citations.values()].map(c=>(c.loc.join('、')||'报告原文')+'：「'+clip(c.raw,140)+'」').join('\n'));
 lines.push('材料限制：仅按本次实际提供的材料审核；公开节录不等于完整签署合同，未提供附件及履约事实未核实。法律依据尚未核验，候选问题及模型分歧保留待核；报告生成不代表合同可签。');
 return lines.join('\n\n');
}

export function reviewReadingCopy(fullText,run){
 if(!run)return fullText;
 return '阅读要点\n\n以下仅整理既有审核候选，未重新审核；完整原报告及全部限定保留在附录。\n\n'+reviewHighlights(run)+'\n\n附录：完整审核报告\n\n'+fullText;
}
