import {createHash} from 'node:crypto';
const uniq=a=>[...new Set(a)],hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16);
function mechanism(f){
 const text=[f.title,f.explanation].join(' ');
 const vocab=[['payment_discharge',/(?:付款|支付).{0,8}义务.{0,10}(?:完成|履行|免除|时点)/,/(?:到账|收款|实际支付)/],['acceptance_default',/(?:验收|签收)/,/(?:默认|视为|自动合格)/],['warranty_start',/(?:质保|保修)/,/(?:起算|起点|开始)/],['confidential_disclosure',/保密/,/披露|例外/]];
 return vocab.find(([,a,b])=>a.test(text)&&b.test(text))?.[0]||null;
}
const explicitSubjects=f=>uniq(([f.title,f.explanation].join(' ').match(/(?:甲|乙|丙|丁)方|债权人[甲乙丙A-Z]|债务人[甲乙丙A-Z]/g)||[])).sort().join('|');
const explicitTriggers=f=>uniq(([f.title].join(' ').match(/(?:若|如果|仅在|除非|只在)[^，。；\n]{1,25}/g)||[])).sort().join('|');
export function evidenceRole(unit,previous){
 const text=unit?.raw_text||'';
 if(/不是完整|测试载体|节录范围|未重建省略/.test(text))return 'scope_limit';
 if(/未经独立核实|履约事实|公开.{0,10}叙述/.test(text+' '+(previous?.raw_text||'')))return 'reported_context';
 return 'support';
}
export function groupReportIssues(findings,units=[]){
 const index=new Map(units.map((u,i)=>[u.id,{u,previous:units[i-1]}])),groups=[];
 for(const f of findings){
  const feature={mechanism:mechanism(f),subjects:explicitSubjects(f),trigger:explicitTriggers(f)},refs=(f.evidence_refs||[]).map(r=>r.unit_id);
  const anchor=(f.evidence||[]).filter(e=>{const u=index.get(e.unit_id);return evidenceRole(u?.u,u?.previous)==='support';}).map(e=>e.unit_id);
  // Compare every member against the new member. No transitive union A-B-C.
  const candidate=feature.mechanism&&groups.find(g=>g._features.every(p=>p.mechanism===feature.mechanism&&p.subjects===feature.subjects&&p.trigger===feature.trigger)&&g._anchors.every(a=>a.some(id=>anchor.includes(id)))&&anchor.length);
  let g=candidate;
  if(!g){g={groupId:'G'+hash([f.finding_id]),title:f.title,memberFindingIds:[],topicIds:[],subIssues:[],evidenceLinks:[],unresolvedQuestions:[],groupingMethod:'conservative deterministic mechanism + subjects + trigger + common source; all-pairs',groupingReason:'未能证明与其他发现同一机制时保持独立。',_features:[],_anchors:[]};groups.push(g);}
  const first=g.memberFindingIds.length===0;
  g.memberFindingIds.push(f.finding_id);g.topicIds=uniq([...g.topicIds,...(f.check_ids||[])]);
  g._features.push(feature);g._anchors.push(anchor);
  const status=f.counter_review?.decision||'unverified';
  g.subIssues.push({findingIds:[f.finding_id],kind:first?'related_issue':(g.subIssues[0].status!==status?'conflicting_view':g.subIssues[0].summary===f.explanation&&g.subIssues[0].suggestion===f.suggestion?'duplicate_expression':'related_issue'),summary:f.explanation,status,interpretationSpace:f.interpretation_space,suggestion:f.suggestion,businessParameters:f.business_parameters||[],category:f.category});
  for(const ref of refs){const u=index.get(ref),role=evidenceRole(u?.u,u?.previous);if(!g.evidenceLinks.some(e=>e.evidenceId===ref&&e.role===role))g.evidenceLinks.push({evidenceId:ref,role});}
  for(const ref of f.counter_review?.counter_evidence_refs||[]){const u=index.get(ref.unit_id),sourceRole=evidenceRole(u?.u,u?.previous),role=sourceRole==='support'?'counter':sourceRole;if(!g.evidenceLinks.some(e=>e.evidenceId===ref.unit_id&&e.role===role))g.evidenceLinks.push({evidenceId:ref.unit_id,role});}
  g.unresolvedQuestions=uniq([...g.unresolvedQuestions,...(f.unresolved_questions||[])]);
  if(!first)g.groupingReason='主体与触发范围未见不同、存在共同支持原文且风险机制一致；仅归组呈现。每个成员的条件、建议与待核状态独立保留，未确认等价或法律正确。';
 }
 return groups.map(({_features,_anchors,...g})=>g);
}
