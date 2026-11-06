// Some compatible providers serialize an array twice. Decode only schema-declared
// array fields, then run the original complete schema and authorization checks.
export function normalizeToolArguments(schema,args){
 if(!args||typeof args!=='object'||Array.isArray(args))return {arguments:args,changes:[]};
 const changes=[];let normalized=args;
 for(const [field,definition] of Object.entries(schema?.properties||{})){
  const value=args[field];if(definition.type!=='array'||typeof value!=='string'||!value.trim().startsWith('['))continue;
  let parsed;try{parsed=JSON.parse(value);}catch{continue;}if(!Array.isArray(parsed))continue;
  if(normalized===args)normalized={...args};normalized[field]=parsed;changes.push({field,from:'json_string',to:'array'});
 }
 return {arguments:normalized,changes};
}
