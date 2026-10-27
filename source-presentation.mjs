import {createHash} from 'node:crypto';
import {verificationForSources,verificationNotice} from './media-verification.mjs';
export const SOURCE_PRESENTATION_VERSION='source-presentation-1';
export const SOURCE_PRESENTATION_POLICY='默认面向大陆中文读者解释业务字段：业务/功能那一列写成“中文说明（原文全称及原有缩写）”，不要只填英文。应用、企业、供应商等专名保留原文，不强行翻译；首次保留原文全称及原有缩写。只知道缩写但不能可靠确定含义时不展开、不猜。企业/产品专名及原有&逐字保留。来源、引文、证据字段不得删全称、创造简称或将and改成&。展示简称须先建立全称对应，不能代替原文证据。材料读取回执中的fieldEvidence和verification是程序登记的实际字段值与覆盖，只有两侧非空且同记录同字段的原值相同才支持该字段文字一致；工具成功、两次调用、框架或第一张图片均不支持整份材料逐项核验完成。没有字段证据时仍可交付OCR/文字层有限结果，并明确未完成双重核验。';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const compact=v=>String(v).replace(/\s+/g,' ').trim();
const escape=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const tokenRegex=v=>new RegExp('(?<![A-Za-z0-9])'+escape(v).replace(/\s+/g,'\\s+')+'(?![A-Za-z0-9])','g');
const abbreviation=/\b[A-Z][A-Z0-9]{1,8}\b/g;
const formats=new Set(['PDF','OCR','ASR','JSON','CSV','DOCX','XLSX','UTC','API','HTML','GMT','BST','CNY','USD','GBP','EUR','DD','MM','YYYY']);
export function sourceTerms(files){
 const terms=[];
 for(const f of files){
  const texts=[['text',f.content],['ocr',f.ocrSupplement?.originalSha256===f.sha256?f.ocrSupplement.text:null]];
  for(const [reader,text]of texts){if(typeof text!=='string')continue;
   const add=(quote,start,kind)=>{
    const full=compact(quote);if(full.length<3||full.length>160||!/[A-Za-z]/.test(full)||/https?:|@|^Q\d\b|[?:。]/.test(full))return;
    if(terms.some(t=>t.fileId===f.id&&t.reader===reader&&t.full===full))return;
    const match=/^(.+?)\s*\(([A-Z][A-Z0-9]{1,9})\)$/.exec(full);
    const ambiguous=match&&/\s(?:&|\/|and)\s/i.test(match[1]);terms.push({id:'term-'+hash([f.id,f.sha256,reader,start,quote]).slice(0,20),fileId:f.id,inputHash:f.sha256,reader,kind,full,quote,span:{start,end:start+quote.length},aliases:match&&!ambiguous?[match[2]]:[],ambiguousAlias:ambiguous?match[2]:null,name:match?match[1].trim():full});
   };
   let offset=0;for(const line of text.split('\n')){const clean=line.trim(),heading=/^#{1,6}\s+(.+)$/.exec(clean),pair=/^([^:：]{1,70})[:：]\s*(.+)$/.exec(clean);
    if(heading)add(heading[1],offset+line.indexOf(heading[1]),'heading');
    else if(pair&&pair[2].length<160)add(pair[2].trim(),offset+line.indexOf(pair[2].trim()),'field_value');
    else if(clean&&clean.length<100&&clean.split(/\s+/).length<=9&&!/[.?!:：]/.test(clean))add(clean,offset+line.indexOf(clean),'heading');
    offset+=line.length+1;
   }
   // Capitalised proper-name phrases may wrap across a PDF text-layer line.
   for(const m of text.matchAll(/\b[A-Z][a-zA-Z0-9'-]+(?:[ \t\r\n]+[A-Z][a-zA-Z0-9'-]+){1,6}/g))add(m[0],m.index,'named_phrase');
  }
 }
 return terms;
}
function corrections(text,terms,vocabulary){
 const edits=[],issues=[];const normalized=compact(text);
 const add=(start,end,replacement,term,reason)=>{if(edits.some(e=>start<e.end&&end>e.start))return;edits.push({start,end,replacement});issues.push({type:reason,termId:term.id,source:term.quote,observed:text.slice(start,end),span:{start,end},status:'needs_confirmation',action:'restored_from_exact_source_term'});};
 const unique=terms.filter((t,i,a)=>a.findIndex(x=>x.full===t.full)===i).sort((a,b)=>b.full.length-a.full.length);
 for(const t of unique){
  if(t.ambiguousAlias&&tokenRegex(t.ambiguousAlias).test(text)&&!normalized.includes(t.full))issues.push({type:'ambiguous_alias_scope',termId:t.id,source:t.quote,observed:t.ambiguousAlias,status:'needs_confirmation',action:'preserved_group_without_inventing_alias_relation'});
  const variants=[];
  if(/\band\b/.test(t.name))variants.push({value:t.name.replace(/\band\b/g,'&'),reason:'source_conjunction_changed'});
  if(t.name.includes(' & '))variants.push({value:t.name.replace(/ & /g,' and '),reason:'source_conjunction_changed'});
  const words=t.name.split(/\s+/);if(words.length>=3&&words.length<=7&&words.every(w=>/^[A-Za-z][A-Za-z'-]*$/.test(w))){const suffix=words.slice(1).map(w=>w[0].toUpperCase()).join('');variants.push({value:words[0]+' '+suffix,reason:'new_abbreviation'});}
  for(const v of variants){if(unique.some(x=>x.full===v.value)||v.value===t.name)continue;
   // An explicitly introduced DISPLAY alias is permitted; evidence cells are handled below.
   if(new RegExp(escape(t.name).replace(/\s+/g,'\\s+')+'\\s*[（(](?:简称[:：]?\\s*)?'+escape(v.value)+'[）)]').test(text))continue;
   const possible=unique.filter(x=>{const w=x.name.split(/\s+/);return w.length>=3&&w.length<=7&&w.every(q=>/^[A-Za-z][A-Za-z'-]*$/.test(q))&&w[0]+' '+w.slice(1).map(q=>q[0].toUpperCase()).join('')===v.value;});
   if(new Set(possible.map(x=>x.name)).size>1){if(tokenRegex(v.value).test(text))issues.push({type:'ambiguous_abbreviation',observed:v.value,candidateTermIds:possible.map(x=>x.id),status:'needs_confirmation',action:'no_arbitrary_full_name_selected'});continue;}
   for(const m of text.matchAll(tokenRegex(v.value)))add(m.index,m.index+m[0].length,t.full,t,v.reason);
  }
  for(const alias of t.aliases){const first=[...text.matchAll(tokenRegex(alias))][0];if(!first)continue;
   const possible=unique.filter(x=>x.aliases.includes(alias));if(new Set(possible.map(x=>x.name)).size>1){issues.push({type:'ambiguous_abbreviation',observed:alias,candidateTermIds:possible.map(x=>x.id),status:'needs_confirmation',action:'no_arbitrary_full_name_selected'});continue;}
   const introduced=new RegExp(escape(t.name).replace(/\s+/g,'\\s+')).exec(text);
   if(!introduced||introduced.index>first.index)add(first.index,first.index+first[0].length,t.full,t,'full_name_not_introduced');
  }
 }
 let repaired=text;for(const e of edits.sort((a,b)=>b.start-a.start))repaired=repaired.slice(0,e.start)+e.replacement+repaired.slice(e.end);
 const sourceVocabulary=new Set([...vocabulary,...unique.flatMap(t=>[...(t.full.match(abbreviation)||[]),...t.aliases])]);
 const declared=new Set();for(const t of unique){const p=new RegExp(escape(t.name).replace(/\s+/g,'\\s+')+'\\s*[（(](?:简称[:：]?\\s*)?([^()（）]{2,60})[）)]','g');for(const m of repaired.matchAll(p))for(const a of m[1].match(abbreviation)||[])declared.add(a);}
 for(const alias of sourceVocabulary){if(formats.has(alias)||unique.some(t=>t.aliases.includes(alias)))continue;const pattern=new RegExp('([A-Za-z][A-Za-z -]{3,65}|[\\u3400-\\u9fff]{2,24})[（(]'+escape(alias)+'[）)]','g');for(const m of repaired.matchAll(pattern)){if(unique.some(t=>t.name===compact(m[1])))continue;issues.push({type:'expansion_without_source_definition',observed:m[0],status:'needs_confirmation',action:'kept_source_abbreviation_without_invented_expansion'});repaired=repaired.slice(0,m.index)+alias+'（原文仅含缩写，含义待核）'+repaired.slice(m.index+m[0].length);break;}}
 for(const a of new Set(text.match(abbreviation)||[]))if(!formats.has(a)&&!sourceVocabulary.has(a)&&!declared.has(a)&&!issues.some(x=>x.observed.includes(a)))issues.push({type:'unbound_abbreviation',observed:a,status:'needs_confirmation',action:'not_expanded_without_evidence'});
 for(const t of unique.filter(t=>t.kind==='heading'&&t.name.split(/\s+/).length>=2&&/^[A-Za-z '&()/-]+$/.test(t.name))){const m=tokenRegex(t.name).exec(repaired);if(!m)continue;const left=Math.max(repaired.lastIndexOf('\n',m.index),repaired.lastIndexOf('|',m.index))+1;let right=repaired.indexOf('|',m.index+t.name.length);const nl=repaired.indexOf('\n',m.index+t.name.length);if(right<0||nl>=0&&nl<right)right=nl;if(right<0)right=repaired.length;if(!/[\u3400-\u9fff]/.test(repaired.slice(left,right)))issues.push({type:'chinese_explanation_missing',termId:t.id,source:t.quote,observed:m[0],status:'needs_confirmation',action:'preserved_original_without_guessed_translation'});}
 return {text:repaired,issues};
}
function neutralizeVerificationClaims(text,visual,issues){
 if(!visual)return text;
 return text.split(/(\n|[。；;])/).map(part=>{
  const assertion=/(?:一致|吻合|相符|通过|完成|核实|无误|confirmed|verified|match(?:es|ed)?|agree(?:s|d)?)/i.test(part);
  const evidence=/(?:视觉|多模态|OCR|文字层|两遍|双路|双重|交叉|逐项|核验|比对|cross.?check|vision|every field|all fields)/i.test(part);
  const negated=/(?:未|没|尚未|不(?:能|得|代表|一致|等于)|无法|缺少|待|需)[^。；;.!\n]{0,12}(?:一致|核验|核实|确认|完成|通过|比对|匹配)|\b(?:not|never|cannot|unverified|not yet)\b/i.test(part);
  if(!assertion||!evidence||negated||/[?？]\s*$/.test(part))return part;
  issues.push({type:'unbound_verification_claim',observed:part,status:'needs_confirmation',action:'replaced_by_field_ledger_notice'});
  if(part.includes('|'))return part.split(/(?<!\\)\|/).map(cell=>/(?:一致|吻合|相符|通过|完成|核实|无误|verified|match|agree)/i.test(cell)?' 待核（原模型表述：'+cell.trim()+'） ':cell).join('|');
  if(/\d/.test(part))return '〔待核的模型表述，未作为核验结论〕「'+part+'」';
  return '〔该核验断言没有绑定逐字段凭据，已转为待核；实际状态见材料核验说明。〕';
 }).join('');
}
export function guardSourcePresentation(input,{run,files=[],previous=[]}={}){
 const value=structuredClone(input),terms=sourceTerms(files),issues=[];
 const vocabulary=new Set(files.flatMap(f=>[f.content,f.ocrSupplement?.originalSha256===f.sha256?f.ocrSupplement.text:''].filter(Boolean).flatMap(t=>String(t).match(abbreviation)||[])));
 const verification=verificationForSources(run||{},files,previous),visual=files.filter(f=>['.pdf','.png','.jpg','.jpeg'].includes(f.extension));
 const transform=text=>{if(!files.length)return String(text||'');const checked=corrections(String(text||''),terms,vocabulary);issues.push(...checked.issues);return neutralizeVerificationClaims(checked.text,visual.length,issues);};
 if(typeof value.content==='string')value.content=transform(value.content);
 if(typeof value.title==='string')value.title=transform(value.title);
 for(const sheet of value.sheets||[])for(const row of sheet.rows||[])for(let col=0;col<row.length;col++)if(typeof row[col]==='string'){
  row[col]=transform(row[col]);
  if(/原文|引文|证据|引用|verbatim|source|quote/i.test(String(sheet.headers?.[col]||''))){const possible=terms.filter(t=>t.aliases.includes(row[col]));if(new Set(possible.map(t=>t.name)).size===1){const t=possible[0];issues.push({type:'evidence_full_name_dropped',termId:t.id,observed:row[col],source:t.quote,status:'needs_confirmation'});row[col]=t.quote;}}
 }
 const used=terms.filter(t=>issues.some(i=>i.termId===t.id));
 const notice=verificationNotice(verification,visual);
 const appendix=used.length?'\n\n### 原文术语依据\n'+[...new Map(used.map(t=>[t.full,t])).values()].map(t=>'- '+t.quote+'（'+files.find(f=>f.id===t.fileId)?.name+'，'+t.reader+'原文）').join('\n'):'';
 if(notice||issues.length){const prefix=notice?'材料核验说明\n\n'+notice+'\n\n':'';value.content=(prefix&&!(value.content||'').startsWith(prefix)?prefix:'')+(value.content||'')+(appendix&&!(value.content||'').includes('### 原文术语依据')?appendix:'')+(issues.length&&!(value.content||'').includes('待核提示：已登记')?'\n\n待核提示：已登记'+issues.length+'处术语展示或核验表述偏差；原始模型文本与逐字来源保留在运行记录，不据此确认业务事实。':'');}
 const audit={version:SOURCE_PRESENTATION_VERSION,sourceHashes:files.map(f=>({id:f.id,sha256:f.sha256})),originalHash:hash(input),deliveredHash:hash(value),issues,terms:used,verification,semanticCorrectness:'not_established'};
 return {input:value,audit,changed:hash(input)!==hash(value)};
}
