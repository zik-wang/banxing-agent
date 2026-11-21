import {contentHash} from '../recovery/reliability.mjs';
export const ATOM_VERSION='v7-p3-atoms-2';
const risky=/应当|必须|不得|不少于|不超过|至少|至多|支持|提供|需|提交|负责|截止|验收|如果|进口|除外|除非|仅限|[≥≤<>]|\d/;
const types=t=>/如果|若|当.*时|进口产品|进口设备/.test(t)?'condition':/除外|除非|但不|不适用|不包括/.test(t)?'exception':/仅限|适用于|范围/.test(t)?'scope':/\d{4}[年\/-]\d/.test(t)?'date':/负责|责任人|成员/.test(t)?'responsibility':/调整为|改为|删除|新增/.test(t)?'change':/≥|≤|不少于|不超过|不得|至少|至多/.test(t)?'constraint':/支持|提供|应|须|需/.test(t)?'requirement':'other';
// All offsets are UTF-16 string offsets in the preserved parsed text. They are
// not PDF geometry and never imply a recovered cell grid.
export function extractAtoms(units){
 const atoms=[],evidence=[],audit=[];
 for(const u of units){
  if(typeof u.text!=='string')continue;
  const table=/:R\d+$/.test(u.id)||!!u.tableRef,issues=[];
  if(table&&!u.cells)issues.push('table_grid_unavailable','merged_cells_unknown','trailing_yes_no_column_unbound');
  if(!u.parentSectionId&&!u.heading)issues.push('heading_inheritance_unresolved');
  let offset=0,condition=null,exception=null,sentenceStart=0,emitted=0;
  // Enumerated objects retain their parent clause. Splitting conjunctions only
  // before an explicit new action avoids treating every list noun as a rule.
  const delimiter=/[，；。！？]|(?:并且|并|同时|还)(?=(?:支持|提供|需|应|不得|提交))/g;
  const segments=[];let m;while((m=delimiter.exec(u.text))){if(m.index>offset)segments.push([offset,m.index]);offset=m.index+m[0].length;if(/[。！？]/.test(m[0]))segments.push([offset,offset,'sentence']);}if(offset<u.text.length)segments.push([offset,u.text.length]);
  for(const [a,b,reset]of segments){if(reset){condition=null;exception=null;sentenceStart=a;continue;}
   const raw=u.text.slice(a,b),trim=raw.trim(),start=a+raw.indexOf(trim),end=start+trim.length;if(!trim||!risky.test(trim))continue;
   const localCondition=trim.match(/(?:如果|若|当)([^，；。]+?)(?:时|则|需|应|还)|(?:进口(?:产品|设备))/)?.[0]||null;
   const localException=trim.match(/(?:除非|除外|但不|不适用|不包括)[^，；。]*/)?.[0]||null;
   if(localCondition)condition=localCondition;if(localException)exception=localException;
   const eid='E'+contentHash({id:u.id,source:u.sourceId,start,end,text:trim}).slice(0,24),ref={id:eid,sourceUnitId:u.id,sourceFileId:u.sourceId||null,sourceName:u.name||u.sourceName||null,page:u.page??null,parentUnitId:u.parentUnitId||u.id,start,end,parentStart:(u.parentStart||0)+start,text:trim,textHash:contentHash(u.text),fileHash:u.fileHash||null,tableRef:u.tableRef||null,rowId:table?u.id:null,columnId:null,geometryVerified:false};evidence.push(ref);
   const num=trim.match(/(≥|≤|>|<|不少于|不超过|至少|至多)?\s*(\d+(?:\.\d+)?)\s*(MB|GB|TB|GHz|MHz|元|万元|年|天|个月|台|个|%)/i),localIssues=[...issues];
   if(/、|\b和\b|和|及|或/.test(trim))localIssues.push('enumeration_requires_atomic_review');
   if(table&&/\s否\s*$/.test(trim))localIssues.push('do_not_interpret_trailing_no_as_feature_negation');
   const atom={atomId:'A'+contentHash({version:ATOM_VERSION,eid}).slice(0,24),sourceUnitIds:[u.id],atomType:types(trim),subject:null,predicate:null,object:trim,operator:num?.[1]||null,value:num?.[2]||null,unit:num?.[3]||null,condition,exception,exactEvidenceRefs:[eid],parentSectionId:u.parentSectionId||null,headingContext:u.heading||null,extractionMethod:'deterministic-clause-discovery-v1',validationStatus:'literal_verified',semanticStatus:'needs_review',issues:localIssues,table:{rowId:table?u.id:null,cellId:null,headerRef:u.headerRef||null,gridKnown:!!u.cells},limits:['literal_verified proves only exact span; not semantic completeness or requirement correctness']};
   atoms.push(atom);emitted++;
   if(trim.includes('、')){
    let pos=0;for(const item of trim.split(/、|和(?=(?:删除|新增|修改|创建))/)){const i=trim.indexOf(item,pos);pos=i+item.length;const part=item.trim();if(!part)continue;const localStart=start+i+item.indexOf(part),localEnd=localStart+part.length,childRef={...ref,id:'E'+contentHash({id:u.id,start:localStart,end:localEnd}).slice(0,24),start:localStart,end:localEnd,parentStart:(u.parentStart||0)+localStart,text:part};evidence.push(childRef);atoms.push({...atom,atomId:'A'+contentHash({version:ATOM_VERSION,eid:childRef.id}).slice(0,24),object:part,parentAtomId:atom.atomId,exactEvidenceRefs:[childRef.id],extractionMethod:'enumeration-split-with-parent-context',validationStatus:'candidate',issues:[...localIssues,'shared_predicate_or_object_inheritance_needs_review'],parentClause:trim});emitted++;}
   }
   if(localCondition&&atom.atomType==='condition'&&/提交|提供|需|应/.test(trim))atoms.push({...atom,atomId:atom.atomId+'-requirement',atomType:'requirement',issues:[...localIssues,'condition_and_required_action_binding_needs_review']});
   if(sentenceStart>start)throw Error('invalid sentence offset');
  }
  audit.push({sourceUnitId:u.id,identifiedAtoms:emitted,tableGrid:table?(u.cells?'available':'unavailable'):'not_applicable',status:emitted?'identified_not_exhaustive':'no_rule_hit_not_checked',issues});
 }
 return {version:ATOM_VERSION,atoms,evidence,audit,coverageMeaning:'identified atoms only; denominator is not the true requirement set; not semantic Recall'};
}
