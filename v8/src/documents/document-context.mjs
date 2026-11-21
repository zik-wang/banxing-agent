import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
// Candidate heading inheritance only. Text patterns cannot certify legal or
// business scope; retain exact source units and expose omitted context.
export function documentContext(units,targets,{eligibleUnitIds=units.map(u=>u.id),maxCharacters=scaledLimit(2800)}={}){
 const eligible=new Set(eligibleUnitIds),targetIds=new Set(targets.map(u=>u.id)),wanted=new Map(),headings=[],omitted=[];
 for(const target of targets){
  const index=units.findIndex(u=>u.id===target.id),prior=units.slice(0,index).filter(u=>u.sourceId===target.sourceId&&eligible.has(u.id));
  const candidates=[];
  for(const unit of prior)for(const line of unit.text.split('\n')){
   const text=line.trim();if(text.length<=100&&/^(?:第[一二三四五六七八九十百\d]+[章节篇部]|[一二三四五六七八九十]+、\S)/.test(text))candidates.push({unitId:unit.id,sourceId:unit.sourceId,page:unit.page,text,classification:'heading_candidate_requires_scope_verification'});
  }
  for(const h of candidates.slice(-2)){headings.push(h);const unit=units.find(u=>u.id===h.unitId);if(!targetIds.has(unit.id))wanted.set(unit.id,unit);}
  const neighbour=prior.at(-1);if(neighbour&&!targetIds.has(neighbour.id))wanted.set(neighbour.id,neighbour);
 }
 let budget=maxCharacters;const context=[];
 for(const unit of wanted.values()){if(unit.text.length<=budget){context.push({...unit,contextOnly:true});budget-=unit.text.length;}else omitted.push(unit.id);}
 return {units:context,headingCandidates:[...new Map(headings.map(h=>[h.unitId+'\0'+h.text,h])).values()],omittedContextUnitIds:omitted,limit:'Heading inheritance is a text heuristic; conditions/exception scope remains unverified. Ineligible OCR units are excluded.'};
}
