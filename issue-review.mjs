import {createHash} from 'node:crypto';
export const REVIEW_VERSION='v7-p1-review-5';
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const arr=v=>Array.isArray(v)?v:[];
const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Normalisation changes whitespace only. Every recovered span points to exact
// original characters. Ambiguous occurrences are never silently disambiguated.
export function locateCitation(ref,units){
 const selected=units.filter(u=>(!ref.sourceId||u.sourceId===ref.sourceId)&&(!ref.unitId||u.id===ref.unitId||u.alias===ref.unitId));
 if(!selected.length)return {status:'needs_source_review',reason:'source_id_not_found',spans:[]};
 const hits=[];
 for(const u of selected){
  if(!ref.quote)continue;
  const add=(from,to,method)=>hits.push({sourceId:u.sourceId,unitId:u.id,start:u.start+from,end:u.start+to,text:u.text.slice(from,to),method});
  if(Number.isInteger(ref.start)&&Number.isInteger(ref.end)&&u.text.slice(ref.start-u.start,ref.end-u.start)===ref.quote&&ref.start>=u.start&&ref.end<=u.end){add(ref.start-u.start,ref.end-u.start,'exact_offset');continue;}
  let at=u.text.indexOf(ref.quote);
  if(at>=0){while(at>=0){add(at,at+ref.quote.length,'exact_search');at=u.text.indexOf(ref.quote,at+1);}continue;}
  const mapped=[],chars=[];let whitespace=false;
  for(let i=0;i<u.text.length;i++){const c=u.text[i];if(/\s/.test(c)){if(!whitespace){chars.push(' ');mapped.push(i);}whitespace=true;}else{chars.push(c);mapped.push(i);whitespace=false;}}
  const q=compact(ref.quote),normal=chars.join('');if(!q)continue;
  let k=normal.indexOf(q);while(k>=0){add(mapped[k],mapped[k+q.length-1]+1,'whitespace_only');k=normal.indexOf(q,k+1);}
 }
 const spans=[...new Map(hits.map(s=>[s.unitId+':'+s.start+':'+s.end,s])).values()];
 return {status:spans.length===1?'source_supported':'needs_source_review',reason:spans.length===1?'exact_original_span':spans.length?'ambiguous_occurrences':'citation_not_found',spans};
}

export function numericValue(value){
 const m=String(value).trim().match(/^(≥|≤|>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|元|万元|天|日|年|%)?$/i);
 if(!m)return null;const unit=(m[3]||'').toUpperCase(),factors={KB:1,MB:1024,GB:1048576,TB:1073741824,'万元':10000};
 return {operator:m[1]||'=',value:Number(m[2])*(factors[unit]||1),dimension:/[KMGT]B/.test(unit)?'storage':/元/.test(unit)?'money':unit,unit};
}
export function compareNumeric(a,b,{storagePolicy}={}){const x=numericValue(a),y=numericValue(b);if(!x||!y||x.dimension!==y.dimension||x.operator!==y.operator)return {status:'needs_semantic_review',reason:'incompatible_or_ambiguous_units'};if(x.dimension==='storage'&&x.unit!==y.unit&&!['binary','decimal'].includes(storagePolicy))return {status:'needs_semantic_review',reason:'cross_storage_unit_requires_explicit_1000_or_1024_policy'};const decimal=v=>{const exponent=['KB','MB','GB','TB'].indexOf(v.unit);return v.value/(1024**exponent)*(1000**exponent);};const xv=storagePolicy==='decimal'&&x.dimension==='storage'?decimal(x):x.value,yv=storagePolicy==='decimal'&&y.dimension==='storage'?decimal(y):y.value;if(!Number.isFinite(xv)||!Number.isFinite(yv)||Math.max(Math.abs(xv),Math.abs(yv))>Number.MAX_SAFE_INTEGER)return {status:'needs_semantic_review',reason:'numeric_precision_limit'};return {status:'deterministically_verified',change:yv===xv?'unchanged':yv<xv?'decrease':'increase',before:x,after:y,storagePolicy:storagePolicy||'same-unit-only',method:'numeric-unit-v1',limit:'只验证数值/阈值，不推断实际性能、成本或工期'};}
export function parseExplicitDate(value){
 const m=String(value).match(/^(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);if(!m)return null;
 const a=m.slice(1).map(x=>x===undefined?0:Number(x)),d=new Date(Date.UTC(a[0],a[1]-1,a[2],a[3],a[4],a[5]));
 if(d.getUTCFullYear()!==a[0]||d.getUTCMonth()!==a[1]-1||d.getUTCDate()!==a[2]||a[3]>23||a[4]>59||a[5]>59)return null;
 return {civilDate:[a[0],String(a[1]).padStart(2,'0'),String(a[2]).padStart(2,'0')].join('-'),time:m[4]===undefined?null:a.slice(3).map(x=>String(x).padStart(2,'0')).join(':'),timezone:null};
}

function spanFor(u,value){const i=u.text.indexOf(value);if(i<0||u.text.indexOf(value,i+1)>=0)return null;return {sourceId:u.sourceId,unitId:u.id,start:u.start+i,end:u.start+i+value.length,text:value};}
export function validateRelation(relation,units){
 const result={...clone(relation),validationStatus:'unsupported',verifierMethod:'explicit-local-relation-v1',reason:'没有明确的同句关系证据'};
 const candidates=units.filter(u=>arr(relation.sourceUnitIds).includes(u.id));
 for(const name of ['subjectSpan','predicateSpan','objectSpan'])if(relation[name]){const s=relation[name],u=units.find(u=>u.id===s.unitId&&u.sourceId===s.sourceId);if(!u||u.text.slice(s.start-u.start,s.end-u.start)!==s.text||s.start<u.start||s.end>u.end)return {...result,reason:'invalid_span:'+name};}
 if(!relation.subject||!relation.object)return {...result,reason:'主体或对象为空'};
 const patterns={responsible_for:[['负责',new RegExp('^'+esc(relation.subject)+'(?:负责|承担)'+esc(relation.object)+'[。.!！]?$')]],member_of:[['成员',new RegExp('^'+esc(relation.object)+'(?:成员包括|成员为|成员：|成员:)'+esc(relation.subject)+'[。.!！]?$')]],depends_on:[['依赖',new RegExp('^'+esc(relation.subject)+'(?:依赖|取决于)'+esc(relation.object)+'[。.!！]?$')]],completed_on:[['完成日期',new RegExp('^'+esc(relation.subject)+'(?:完成日期为|完成于|验收日期为)'+esc(relation.object)+'[。.!！]?$')]],due_on:[['截止',new RegExp('^'+esc(relation.subject)+'(?:截止时间为|截止日期为|须于|应于)'+esc(relation.object)+'(?:前完成|前提交)?[。.!！]?$')]],scheduled_on:[['定于',new RegExp('^'+esc(relation.subject)+'(?:定于|计划于)'+esc(relation.object)+'[。.!！]?$')]]};
 for(const u of candidates){
  if(!u.text.includes(relation.subject)||!u.text.includes(relation.object))continue;
  const clauses=u.text.split(/[；;\n]/).map(s=>s.trim());
  for(const clause of clauses){
   if(!clause.includes(relation.subject)||!clause.includes(relation.object))continue;
   if(/并非|不是|不由|不负责|不适用|除非|除外|仅限|如果|但|尚未|不得/.test(clause))return {...result,validationStatus:'ambiguous',reason:'存在否定、条件、例外或限定范围，禁止扩大关系'};
   if(relation.predicate==='responsible_for'&&/验收组|成员|联系人|联络人/.test(clause)&&!new RegExp(esc(relation.subject)+'负责'+esc(relation.object)).test(clause))return {...result,validationStatus:'ambiguous',reason:'成员/联系人不能证明执行责任'};
   if(relation.predicate==='due_on'&&/验收日期|完成日期|开票日期|发布日期/.test(clause))return {...result,validationStatus:'contradicted',reason:'事件发生日期不能证明截止日期'};
   if(relation.predicate==='responsible_for'){
    const keyed=new RegExp('^'+esc(relation.object)+'\\s+(?:'+esc(relation.subject)+'负责[^，,。；;]+|[^，,。；;]+由'+esc(relation.subject)+'负责)[。.]?$');
    if(keyed.test(clause)){const subjectSpan=spanFor(u,relation.subject),objectSpan=spanFor(u,relation.object),predicateSpan=spanFor(u,'负责');if(subjectSpan&&objectSpan&&predicateSpan)return {...result,subjectSpan,objectSpan,predicateSpan,validationStatus:'supported',reason:'明确任务编号与同句负责关系；仅source_supported'};}
   }
   for(const [predicate,re]of patterns[relation.predicate]||[])if(re.test(clause)){
    const subjectSpan=spanFor(u,relation.subject),objectSpan=spanFor(u,relation.object);let predicateSpan=spanFor(u,predicate);
    if(!predicateSpan){const between=u.text.slice(subjectSpan?.end-u.start,objectSpan?.start-u.start);if(between)predicateSpan=spanFor(u,between);}
    if(!subjectSpan||!objectSpan||!predicateSpan)continue;
    return {...result,subjectSpan,predicateSpan,objectSpan,validationStatus:'supported',reason:'明确同句主体-关系-对象且无检测到的限定；仅source_supported，不证明全文语义完整'};
   }
  }
 }
 return result;
}

export function validateMissingScope({status,requirement,inScope,required,inspectionComplete,absenceEvidence}){
 if(status!=='missing')return {status,reason:'not_a_missing_claim'};
 if(inScope===false)return {status:'out_of_scope',reason:'明确不属于当前任务范围'};
 if(required===false)return {status:'not_applicable',reason:'明确无需交付'};
 if(inScope!==true||required!==true||!requirement||!inspectionComplete||!absenceEvidence)return {status:'pending_confirmation',reason:'missing缺少适用范围、明确要求、完整检查或缺失证据'};
 return {status:'missing',reason:'明确要求和当前完整检查范围内存在缺失依据；不代表外部材料不存在'};
}

function classify(record,claim){
 const s=[record.reason,claim?.summary,claim?.title].filter(Boolean).join(' '),secondary=[];
 if(claim?.owner)secondary.push('attribution_ambiguous');if(claim?.dueText)secondary.push('date_role_ambiguous');
 if(/除外|除非|例外|但不|不包括/.test(s))secondary.push('exception_ambiguous');if(/范围|适用|其他内容不变|未提及.*变更/.test(s))secondary.push('scope_ambiguous');
 let primaryReason='other';
 if(record.kind==='uncertain'&&/模型声称无变化，尚未独立核验/.test(s))primaryReason='change_unverified';
 else if(record.kind==='unprocessed'||record.kind==='risk_context_only'||record.kind==='uncertain')primaryReason='source_missing';
 else if(record.kind==='source')primaryReason=/截断/.test(s)?'source_truncated':'source_parse_failed';
 else if(record.kind==='citation')primaryReason='citation_invalid';
 else if(record.kind==='pass_failure')primaryReason=/超时|timeout/i.test(s)?'model_timeout':'validation_failed';
 else if(/成本|工期|性能|合规|兼容|风险|可能影响|采购影响|实施影响|将导致/.test(s))primaryReason='business_inference';
 else if(secondary.length)primaryReason=secondary.shift();
 else if(/调整|更正|变更|移除|删除|新增|不变|一致/.test(s))primaryReason='change_unverified';
 else if(claim)primaryReason='relation_unverified';
 return {primaryReason,secondaryReasons:secondary,basis:{recordKind:record.kind,text:record.reason||'',claimId:claim?.id||null,method:'explicit-reason-rules-v1'}};
}
function transitionProof(issue,claim,ledger){
 if(issue.basis?.recordKind==='uncertain'||!claim||!['change_unverified','date_role_ambiguous'].includes(issue.primaryReason)||claim.owner||arr(claim.dependsOn).length)return null;
 const refs=arr(claim.refs),ids=[...new Set(refs.map(r=>r.unitId))];if(ids.length!==1)return null;
 const proof=arr(ledger.programFactProofs).find(p=>{const g=arr(ledger._programItems).find(i=>i.key===p.key)?.programComparison;return g?.kind==='explicit_inline'&&g.allIds.length===1&&g.allIds[0]===ids[0];});
 const item=arr(ledger._programItems).find(i=>i.key===proof?.key),g=item?.programComparison;if(!g||g.removed.length!==1||g.added.length!==1)return null;
 if(hash(g)!==proof.comparisonHash||!g.title.includes(claim.title))return null;
 const old=g.removed[0].text,newValue=g.added[0].text;
 if(claim.dueText&&(claim.dueText!==newValue||!/截止|期限/.test(g.title)))return null;
 const original=arr(ledger.inventory?.units).find(u=>u.id===ids[0]);if(!original||!original.text.includes(old)||!original.text.includes(newValue))return null;
 // Whole-claim grammar: no trailing business inference or multi-event summary.
 const m=compact(claim.summary).match(/^(.+?)(?:由|从)(.+?)(?:更正为|调整为|改为)(.+?)[。.]?$/);
 if(!m||m[2]!==old||m[3]!==newValue||!g.title.includes(m[1])||!/时间|日期/.test(g.title))return null;
 return {status:'deterministically_verified',rule:'explicit-inline-date-transition-v1',programId:g.id,comparisonHash:proof.comparisonHash,evidence:refs,reason:'同一明确条款、单一事件、完整前后值与程序回执相同；不含业务影响'};
}

export function reviewLedger(ledger,{taskId='not_recorded',runId='not_recorded',model='not_recorded',promptVersion='not_recorded',createdAt='not_recorded',items=[]}={}){
 const {p1Review:derivedReview,...originalLedger}=ledger;
 const snapshotHash=hash(originalLedger),units=arr(ledger.inventory?.units),candidates=arr(ledger.candidates),dispositions=arr(ledger.candidateDispositions);
 const claims=candidates.map(c=>({id:c.id,taskId,runId,stage:c.pass,raw:clone(c.raw),title:c.raw.title||'',summary:c.raw.summary||'',owner:c.raw.owner||'',dueText:c.raw.dueText||'',dependsOn:arr(c.raw.dependsOn),refs:clone([...arr(c.basis),...arr(c.evidence)]),issues:clone(arr(c.issues)),model,promptVersion,modelCallId:c.modelCallId||'not_recorded'}));
 const rawRecords=arr(ledger.unresolved).map((r,index)=>({id:r.id||'R-'+hash({taskId,snapshotHash,index}).slice(0,20),originalId:r.id||null,index,taskId,runId,stage:r.pass||'ledger-finalization',createdAt:r.at||createdAt,model,promptVersion,original:clone(r),candidateId:r.candidateId||(typeof r.key==='string'&&r.key?dispositions.find(d=>typeof d.formalKey==='string'&&d.formalKey===r.key)?.candidateId:null)||null,sourceUnitIds:r.unitId?[r.unitId]:arr(r.unitIds)}));
 const issues=[],byIdentity=new Map();
 for(const r of rawRecords){const claim=claims.find(c=>c.id===r.candidateId),classification=classify(r.original,claim);
  const sourceUnitIds=[...new Set([...r.sourceUnitIds,...arr(claim?.refs).map(x=>x.unitId)].filter(Boolean))].sort();
  // Exact payload equality is the only automatic merge. Similar titles, IDs,
  // shared units, equivalent-looking prose and program groups do not suffice.
  const identity=hash({scenario:ledger.coverage?.scenarioId||'unknown',classification:classification.primaryReason,record:r.original,claim:claim?{...claim,id:null,stage:null,modelCallId:null}:null,sourceUnitIds});
  let issue=byIdentity.get(identity);if(!issue){issue={id:'I-'+hash({taskId,identity}).slice(0,20),taskId,runId,...classification,rawRecordIds:[],relatedClaimIds:[],sourceUnitIds,sourceEvidence:units.filter(u=>sourceUnitIds.includes(u.id)).map(u=>({sourceId:u.sourceId,unitId:u.id,start:u.start,end:u.end,text:u.text})),status:'needs_semantic_review',verification:[],question:r.original.reason||'需核对原始记录',mergeMethod:'exact-payload-only-v1'};issues.push(issue);byIdentity.set(identity,issue);}
  issue.rawRecordIds.push(r.id);if(claim&&!issue.relatedClaimIds.includes(claim.id))issue.relatedClaimIds.push(claim.id);
 }
 const programSubclaims=[];
 for(const item of items){const group=item.programComparison,proof=arr(ledger.programFactProofs).find(p=>p.key===item.key);if(!group||!proof||hash(group)!==proof.comparisonHash)continue;
  const pattern=/^(.*?)(≥|≤|>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)([^\r\n]*)$/i;
  for(const before of group.removed){const a=before.text.match(pattern);if(!a)continue;const matches=group.added.map(u=>({u,m:u.text.match(pattern)})).filter(x=>x.m&&x.m[1]===a[1]&&x.m[5]===a[5]);if(matches.length!==1)continue;const b=matches[0];const checked=compareNumeric(a[2]+a[3]+a[4],b.m[2]+b.m[3]+b.m[4]);programSubclaims.push({id:'N-'+hash({programId:item.key,before:before.text,after:b.u.text}).slice(0,16),programId:item.key,subject:a[1],before:before.text,after:b.u.text,beforeUnitId:before.id,afterUnitId:b.u.id,...checked,verifierVersion:REVIEW_VERSION,reason:'同一属性、同一后续表格列的明确前后数值核验；只核子事实，模型解释仍保留'});}
 }
 const results=[];
 for(const issue of issues){
  const claim=claims.find(c=>issue.relatedClaimIds.includes(c.id));let result;
  if(['source_missing','source_truncated','source_parse_failed','model_timeout','validation_failed'].includes(issue.primaryReason))result={status:'needs_source_review',rule:'source-disposition-v1',reason:'需补读、解析或重试；存在文本不等于两遍有效处置已完成'};
  else if(issue.primaryReason==='business_inference')result={status:'needs_business_review',rule:'business-boundary-v1',reason:'没有业务规则或实测依据，不能将文字变化推广为性能/成本/工期结论'};
  else result=transitionProof(issue,claim,{...ledger,_programItems:items})||{status:'needs_semantic_review',rule:'conservative-semantic-boundary-v1',reason:'引用可定位不能证明整条语义，继续保留原候选'};
  const relations=[];
  if(claim){
   if(claim.owner)relations.push(validateRelation({subject:claim.owner,predicate:'responsible_for',object:claim.title,sourceUnitIds:issue.sourceUnitIds},units));
   if(claim.dueText)relations.push(validateRelation({subject:claim.title,predicate:'due_on',object:claim.dueText,sourceUnitIds:issue.sourceUnitIds},units));
   for(const dep of claim.dependsOn)relations.push(validateRelation({subject:claim.raw.key||claim.title,predicate:'depends_on',object:dep,sourceUnitIds:issue.sourceUnitIds},units));
   if(issue.primaryReason==='citation_invalid'){const located=arr(claim.raw.basis).map(ref=>locateCitation(ref,units));result={status:'needs_source_review',rule:'citation-locator-v1',reason:'保留候选；定位修复不自动确认语义',located};}
  }
  const human=result.status==='needs_business_review'||result.status==='needs_semantic_review';
  const question=result.status==='needs_business_review'?'请提供明确业务规则或实测依据，判断这项变化实际影响哪个组件、成本或工期。':result.status==='needs_semantic_review'?'请核对这条候选的主体、事件、范围、条件和例外是否被原文完整支持。':'请补齐指定来源/处置；无需把重复调用回执逐条当作业务判断。';
  const receipt={id:'V-'+hash({issueId:issue.id,result}).slice(0,20),issueId:issue.id,rawRecordIds:[...issue.rawRecordIds],verifierVersion:REVIEW_VERSION,...result,relations,programSubclaims:programSubclaims.filter(s=>issue.sourceUnitIds.includes(s.beforeUnitId)||issue.sourceUnitIds.includes(s.afterUnitId)),humanReviewRequired:human,automaticCandidate:!human,question,permittedTransition:result.status==='deterministically_verified'?'narrow textual fact only; suggestions and business effects are not certified':'no promotion to confirmed',verifiedAt:createdAt};
  issue.status=result.status;issue.verification.push(receipt.id);issue.question=question;results.push(receipt);
 }
 const count=p=>issues.filter(p).length,stats={rawRecordCount:rawRecords.length,canonicalIssueCount:issues.length,provenDuplicateRecords:rawRecords.length-issues.length,automaticCandidateCount:results.filter(r=>r.automaticCandidate&&r.status!=='deterministically_verified').length,automaticallyVerifiedCount:count(i=>i.status==='deterministically_verified'),sourceIssueCount:count(i=>i.status==='needs_source_review'),relationIssueCount:count(i=>['relation_unverified','attribution_ambiguous','date_role_ambiguous','scope_ambiguous','exception_ambiguous'].includes(i.primaryReason)),businessInferenceCount:count(i=>i.primaryReason==='business_inference'),humanReviewCount:results.filter(r=>r.humanReviewRequired).length,unclassifiedCount:count(i=>i.primaryReason==='other'),reasonCounts:Object.fromEntries([...new Set(issues.map(i=>i.primaryReason))].sort().map(reason=>[reason,count(i=>i.primaryReason===reason)]))};
 stats.programSubclaimsVerified=programSubclaims.filter(s=>s.status==='deterministically_verified').length;
 return {version:REVIEW_VERSION,taskId,runId,inputLedgerHash:snapshotHash,rawRecords,claims,canonicalIssues:issues,verificationResults:results,programSubclaims,stats,limits:['CanonicalIssue仅为保守工作队列，不能证明真实独立问题全集。','未发现严格重复时不强行合并；分类统计可能重叠。','自动核验只覆盖规则注明的窄文本事实，不自动移除原始模型解释或认证建议。']};
}

export function reviewMarkdown(review){const s=review.stats;return '# 待核分类与核验\n\n原始记录 '+s.rawRecordCount+'；保守独立问题 '+s.canonicalIssueCount+'；可证明重复 '+s.provenDuplicateRecords+'；自动已核验 '+s.automaticallyVerifiedCount+'；来源补读 '+s.sourceIssueCount+'；人工语义/业务 '+s.humanReviewCount+'。\n\n'+review.limits.join('\n\n')+'\n\n'+review.canonicalIssues.map(i=>'## '+i.id+' ['+i.status+']\n\n原因：'+i.primaryReason+'\n\n原始记录：'+i.rawRecordIds.join('、')+'\n\n'+i.question+'\n\n'+i.sourceEvidence.map(e=>e.unitId+'：'+e.text).join('\n')).join('\n\n');}
