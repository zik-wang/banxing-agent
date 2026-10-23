import {digest} from './workspace-files.mjs';import {embed,rerank} from './multimodal.mjs';
export async function indexFiles(store,harness,files,signal){
 store.state.knowledge||=[];const additions=[];for(const f of files)for(let at=0;at<f.content.length;at+=1200){const text=f.content.slice(at,at+1200),hash=digest(Buffer.from(text));if(!store.state.knowledge.some(e=>e.hash===hash)&&!additions.some(e=>e.hash===hash))additions.push({id:crypto.randomUUID(),fileId:f.id,name:f.name,hash,text,offset:at,createdAt:new Date().toISOString()});}
 if(store.state.knowledge.length+additions.length>500||additions.length>40)throw Error('知识库本轮最多40片、总计500片，请缩小输入');
 if(additions.length){const vectors=await embed(harness,additions.map(e=>e.text),signal);additions.forEach((e,i)=>e.vector=vectors[i]);store.state.knowledge.push(...additions);store.save();}return {added:additions.length,total:store.state.knowledge.length};
}
export async function searchKnowledge(store,harness,query,signal){
 if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('检索问题需1–500字');const entries=store.state.knowledge||[];if(!entries.length)return {items:[],method:'知识库为空'};
 const [vector]=await embed(harness,[query],signal);const cosine=(a,b)=>{if(a.length!==b.length)return -1;const denom=Math.sqrt(a.reduce((s,x)=>s+x*x,0)*b.reduce((s,x)=>s+x*x,0));return denom?a.reduce((s,x,i)=>s+x*b[i],0)/denom:0;};
 const selected=entries.map(e=>({entry:e,score:cosine(vector,e.vector)})).filter(e=>e.score!==-1).sort((a,b)=>b.score-a.score).slice(0,12);const ranked=await rerank(harness,query,selected.map(e=>e.entry.text),signal);
 return {method:'内网图文向量模型（文本输入）→ Qwen重排序',items:ranked.filter(r=>Number.isInteger(r.index)&&selected[r.index]).slice(0,5).map(r=>{const {vector,...entry}=selected[r.index].entry;return {...entry,score:r.relevance_score};})};
}
