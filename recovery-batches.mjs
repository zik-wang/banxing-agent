export function recoveryBatches(units,session,phase,{maxCharacters=6200,maxUnits=12}={}){
 const remaining=new Set(session.remaining(phase)),batches=[];let group=[],characters=0,groupCharacterLimit=maxCharacters,groupUnitLimit=maxUnits;
 for(const unit of units.filter(u=>remaining.has(u.id))){
  const attempts=session.byId.get(unit.id)?.stages[phase]?.attemptCount||0;
  const scale=2**Math.min(attempts,2),characterLimit=Math.max(1400,Math.floor(maxCharacters/scale)),unitLimit=Math.max(1,Math.floor(maxUnits/scale));
  const nextCharacters=Math.min(groupCharacterLimit,characterLimit),nextUnits=Math.min(groupUnitLimit,unitLimit);
  if(group.length&&(characters+unit.text.length>nextCharacters||group.length>=nextUnits)){batches.push(group);group=[];characters=0;groupCharacterLimit=maxCharacters;groupUnitLimit=maxUnits;}
  groupCharacterLimit=Math.min(groupCharacterLimit,characterLimit);groupUnitLimit=Math.min(groupUnitLimit,unitLimit);group.push(unit);characters+=unit.text.length;
 }
 if(group.length)batches.push(group);return batches;
}
