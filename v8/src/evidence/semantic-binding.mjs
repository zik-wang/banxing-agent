// Restore a model's whitespace-normalized quote to a unique, exact source span.
// Only whitespace is ignored. Digits, signs, order, punctuation and words must
// still match. The original response is preserved in the call artifact.
export function bindLiteralSpan(ref,units){
 const u=units.find(u=>u.id===ref?.unitId);if(!u||typeof ref.quote!=='string'||!ref.quote.trim())return null;
 const compact=s=>s.replace(/\s/g,''),needle=compact(ref.quote);if(!needle)return null;
 const offsets=[],chars=[];for(let i=0;i<u.text.length;i++)if(!/\s/.test(u.text[i])){chars.push(u.text[i]);offsets.push(i);}
 const hay=chars.join(''),at=hay.indexOf(needle);if(at<0||hay.indexOf(needle,at+1)>=0)return null;
 const start=offsets[at],end=offsets[at+needle.length-1]+1,quote=u.text.slice(start,end);
 return {unitId:u.id,sourceId:u.sourceId,page:u.page??null,start,end,quote,modelQuote:ref.quote,bindingMethod:quote===ref.quote?'exact':'unique_whitespace_alignment',semanticProof:false};
}
