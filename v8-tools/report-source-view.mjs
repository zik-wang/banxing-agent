import{createHash}from'node:crypto';
// A representation adapter, not a replacement original or a completeness claim.
export function reportSourceView(source,text){
 if(!/\.json$/i.test(source.name||''))return{text};let records;try{records=JSON.parse(text)}catch{return{text}}
 if(!Array.isArray(records)||!records.length||!records.every(x=>x&&typeof x.tag_name==='string'&&typeof x.body==='string'&&typeof x.published_at==='string'&&(!x.assets||Array.isArray(x.assets))))return{text};
 const projected=records.map((x,index)=>({sourcePointer:'/'+index,tag_name:x.tag_name,name:x.name,published_at:x.published_at,created_at:x.created_at,prerelease:x.prerelease,draft:x.draft,author:{login:x.author?.login},body:x.body,assets:x.assets?.map((a,i)=>({sourcePointer:'/'+index+'/assets/'+i,name:a.name,digest:a.digest,size:a.size}))}));
 const body=JSON.stringify(projected);return{text:body,representation:{kind:'github_release_core_v1',originalCharacters:text.length,modelCharacters:body.length,records:records.length,fields:['tag_name','name','published_at','created_at','prerelease','draft','author.login','body','assets.name','assets.digest','assets.size'],sha256:createHash('sha256').update(body).digest('hex'),scope:'Original was read and retained; model sees these fields only. Unprojected metadata is not reviewed.'}};
}
