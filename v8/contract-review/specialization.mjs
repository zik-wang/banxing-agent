// Operator-owned work allocation. Small-model signals never certify a topic.
export const SPECIALIZATION_VERSION='local-signals-context-review-1';
const supported=['范围与义务风险','支付与财务风险','责任与救济风险'];
export function specializationPlan(profile,config={},local={}){
 const requested=config.collaboration?.mode;
 if(requested&&requested!=='specialized-v1')throw Error('UNKNOWN_REVIEW_COLLABORATION_MODE');
 const all=profile.checks.map(c=>c.id),fallback=reason=>({version:SPECIALIZATION_VERSION,requested:requested||'legacy',applied:false,reason,mainCheckIds:all,specialistCheckIds:[],localRole:'three-category local candidate signals only',mainRole:'all configured checks; no small-model result substitutes for review'});
 if(!requested)return fallback('not_requested');
 if(!config.localReview?.enabled)return fallback('local_plugin_disabled');
 if(local.status!=='completed'||local.uninspectedIds?.length||!local.rows?.length||local.rows.some(r=>r.status!=='candidate_only'))return fallback('local_coverage_incomplete');
 const specialist=[...new Set(supported.map(k=>profile.local_signal_checks?.[k]).filter(id=>all.includes(id)))];
 if(!specialist.length||specialist.length===all.length)return fallback('profile_has_no_safe_separate_allocation');
 return {version:SPECIALIZATION_VERSION,requested,applied:true,reason:'complete_local_signals_with_mandatory_full_context_review',mainCheckIds:all.filter(id=>!specialist.includes(id)),specialistCheckIds:specialist,localRole:'independent short-clause candidate screening in three trained categories; no explanation or legal decision',mainRole:'independent remaining topics, full-context specialist adjudication, all cross-clause relations and counter-evidence',negativePolicy:'A negative local signal does not waive any mandatory topic or source range.',independence:'The main discovery stage does not see local signals. Specialist adjudication sees both positive and negative signals as untrusted data.'};
}
export function specialistObservations(local,units){
 const allowed=new Set(units.map(u=>u.id));
 return (local.rows||[]).filter(r=>allowed.has(r.unitId)&&r.status==='candidate_only').map(r=>({row_id:r.id,unit_id:r.unitId,start:r.start,end:r.end,risk:r.signal.risk,category:r.signal.category,meaning:'local signal, not a validated claim'}));
}
