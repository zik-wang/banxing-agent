export function referenceInput(documents,maxCharacters=280){
 if(!Number.isInteger(maxCharacters)||maxCharacters<1)throw Error('来源片段预算无效');
 let number=0;const units=[];
 const input=documents.map(document=>{const text=String(document.text||''),sourceUnits=[];for(let start=0;start<text.length;){let end=Math.min(text.length,start+maxCharacters);if(end<text.length){const newline=text.lastIndexOf('\n',end-1);if(newline>=start+Math.floor(maxCharacters/2))end=newline+1;}const unit={id:'E'+(++number),sourceId:document.id,start,end,text:text.slice(start,end)};units.push(unit);sourceUnits.push(unit);start=end;}return {...document,text:undefined,units:sourceUnits};});
 return {documents:input,units};
}
export function restoreReferences(result,units){
 const original=structuredClone(result),byId=new Map(units.map(u=>[u.id,u])),errors=[];
 if(Array.isArray(result.items))for(const [index,item]of result.items.entries())for(const field of ['basis','evidence'])if(Array.isArray(item[field]))item[field]=item[field].flatMap(ref=>{
  if(!ref||!Object.hasOwn(ref,'unitIds'))return [ref];
  if(!Array.isArray(ref.unitIds)||!ref.unitIds.length||ref.unitIds.some(id=>!byId.has(id)||ref.sourceId&&byId.get(id).sourceId!==ref.sourceId||ref.quote&&!byId.get(id).text.includes(ref.quote))){errors.push({index,field,ref,reason:'invalid_or_conflicting_unit_reference'});return [{sourceId:'unresolved-reference',quote:'',unitIds:ref.unitIds}];}
  return ref.unitIds.map(id=>{const u=byId.get(id);return {sourceId:u.sourceId,unitId:u.id,quote:u.text,start:u.start,end:u.end};});
 });
 result.referenceResolution={version:'v7-evidence-id-1',originalModelResult:original,units,errors,limit:'程序恢复原文引用，不代表整条语义正确；无效引用保留在待核候选。'};return result;
}
