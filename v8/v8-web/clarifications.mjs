import fs from 'node:fs';import path from 'node:path';
import {candidateChoices} from '../v8-tools/user-decision.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const legacyCache=new Map();
export function pendingClarification(turn){
 if(turn.clarification)return turn.clarification;
 if(turn.status!=='failed'||turn.termination?.reason!=='requested_delivery_missing'||turn.artifacts?.length||!/(?:请|需要).{0,20}(?:确认|选择)|哪一份/u.test(turn.answer||'')||!turn.directory)return null;
 const file=path.join(turn.directory,'tool-calls.jsonl');try{const stat=fs.statSync(file),key=file+':'+stat.mtimeMs+':'+stat.size;if(legacyCache.has(key))return legacyCache.get(key);const calls=fs.readFileSync(file,'utf8').trim().split('\n').map(x=>JSON.parse(x)),last=[...calls].reverse().find(x=>x.tool==='list_materials'&&x.status==='ok'&&x.data?.resources?.length),choices=candidateChoices(last?.data.resources||[]);if(!choices.length)return null;const decision={id:'legacy-'+turn.id,state:'pending',kind:'file_selection',title:'需要你确认处理范围',question:'请确认要处理的材料和输出要求。',choices,hasMore:!!last.data.nextCursor,originalRequest:turn.request,derivedFromLegacy:true};legacyCache.set(key,decision);return decision;}catch{return null;}
}
export function resolveClarification(workspace,c,body){
 let reply=body.clarification;if(!reply){const parent=[...c.turns].reverse().find(t=>pendingClarification(t)?.state==='pending'&&!t.inherited);const d=parent&&pendingClarification(parent),message=String(body.message||'').trim();if(!d||body.mode||body.fileIds?.length||!message)return null;const ordinal=message.match(/^(?:用|选|选择|就用)?第?([一二三四五六七八九十0-9]+)(?:份|个|项)(?:吧|就行|，.*|,.*|。.*)?$/u);const n=ordinal?({一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[ordinal[1]]||Number(ordinal[1])):null;const named=d.choices.filter(x=>message===x.name||message==='用'+x.name);const choice=n?d.choices[n-1]:named.length===1?named[0]:null;if(!choice)return null;reply={turnId:parent.id,choiceIds:[choice.id],details:ordinal&&!/[，,]/.test(message)?'':message};body.clarification=reply;}
 const parent=c.turns.find(t=>t.id===reply.turnId&&!t.inherited);
 const decision=parent&&pendingClarification(parent);
 if(!parent||!decision||decision.state!=='pending')fail(409,'这个选择已经处理或不属于本对话，请刷新后继续');
 const ids=reply.choiceIds||[],details=String(reply.details||'').trim();
 if(!Array.isArray(ids)||ids.length>12||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length||details.length>4000)fail(400,'请选择有效文件，补充要求不超过4000字');
 if(!ids.length&&!details)fail(400,'请至少选一份文件，或补充你希望完成的具体工作');
 const excluded=[...c.files.filter(f=>f.removed).map(f=>f.ref.resourceId),...workspace.space.work(c.workspaceId,c.workItemId).excluded.map(r=>r.resourceId)];
 const choices=ids.map(id=>{const choice=decision.choices.find(x=>x.id===id);if(!choice)fail(403,'所选文件不在本次候选范围');const ref=workspace.managed.ref(choice.ref.resourceId,choice.ref.revisionId,excluded),v=workspace.space.check(c.workspaceId,ref);if(v.hash!==choice.sha256)fail(409,'文件内容已改变，请重新选择');return {...choice,ref};});
 const request=parent.request+'\n\n用户确认：'+(choices.length?'处理 '+choices.map(c=>c.name+'（'+c.createdAt+'）').join('、')+'。':'')+(details?'\n补充要求：'+details:'');
 const inherited=!choices.length&&parent.runId?workspace.space.load().runs[parent.runId]?.snapshot.selected||[]:[];
 for(const ref of inherited){if(excluded.includes(ref.resourceId))fail(403,'原任务材料已移除，请重新选择');workspace.space.read(c.workspaceId,ref);}
 return {parent,request,refs:choices.length?choices.map(c=>c.ref):inherited,plan:{...decision,autoAttempted:false,choices,hasMore:false,details,approvedAt:new Date().toISOString()}};
}
