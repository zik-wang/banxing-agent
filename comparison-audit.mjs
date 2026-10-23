import {diffArrays} from 'diff';
import {createHash} from 'node:crypto';
export function auditComparisonText(before,after){
 const old=before.split('\n'),next=after.split('\n'),parts=diffArrays(old,next,{timeout:4000});
 if(!parts)return {version:'v7-p2-text-audit-1',status:'blocked',reason:'deterministic_diff_timeout'};
 const added=[],removed=[],unchanged=[];let a=0,b=0;
 for(const p of parts)for(const text of p.value){if(p.removed)removed.push({line:++a,text});else if(p.added)added.push({line:++b,text});else unchanged.push({oldLine:++a,newLine:++b,text});}
 const relocated=removed.filter(r=>r.text.trim()&&old.filter(t=>t===r.text).length===1&&next.filter(t=>t===r.text).length===1&&added.some(n=>n.text===r.text)).map(r=>({text:r.text,oldLine:r.line,newLine:added.find(n=>n.text===r.text).line,classification:'exact_text_relocated_candidate',scopeVerified:false,limit:'Text equal at new location; heading, condition and business scope require review.'}));
 const taxonomy={amount:/\d[\d,.]*\s*(?:万元|元|人民币|USD)/,date:/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}/,numeric:/[≥≤><=]?\s*\d+(?:\.\d+)?\s*(?:MB|GB|TB|颗|个|年|天)/i,condition:/如果|若|仅|适用|条件|进口/,exception:/除外|除非|例外|不适用/,negation:/不得|不能|无需|不予|禁止/,heading:/^(?:第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+、)/,table:/\t|\|/};
 const audit=Object.entries(taxonomy).map(([category,pattern])=>({category,status:'checked_textually',matches:[...removed.filter(r=>pattern.test(r.text)).map(r=>({side:'before',...r})),...added.filter(r=>pattern.test(r.text)).map(r=>({side:'after',...r}))],semanticStatus:'not_verified',method:'literal-patterns-over-complete-line-diff'}));
 return {version:'v7-p2-text-audit-1',status:'text_diff_audited',inputHashes:{before:createHash('sha256').update(before).digest('hex'),after:createHash('sha256').update(after).digest('hex')},added,removed,unchanged,relocated,audit,limit:'Literal audit only. Annexes, OCR, paraphrases, layout, applicability and business impact are not certified. In amendment mode omitted old text is not proof of business deletion.'};
}
