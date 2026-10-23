import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {contentHash,atomicJson} from './reliability.mjs';
import {loadSemanticSnapshot,semanticFolder} from './semantic-audit.mjs';
import {recordAnnotation,adjudicateReference,GOLD_VERSION} from './gold-benchmark.mjs';
export const REVIEW_VERSION='v7-p3-human-review-1';
const grants=new Map(),decisions=['accepted','rejected','corrected','insufficient_evidence','irrelevant'];
export function resolveReviewActor(store,input){
 if(input.reviewToken){const g=grants.get(input.reviewToken);if(!g||g.expires<Date.now())throw Error('人工核查授权失效');return g.actor;}
 if(input.reviewerKey){const file=path.join(store.directory,'semantic-reviewers.json'),reviewers=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).reviewers:[],r=reviewers.find(r=>r.enabled&&r.credentialHash===contentHash(String(input.reviewerKey)));if(!r)throw Error('审核者凭据无效');return {id:r.id,role:'reviewer',taskIds:r.taskIds||[],independentOfDevelopment:r.independentOfDevelopment===true,identityAssurance:'administrator-provisioned bearer credential'};}
 return {id:'local-workspace-owner',role:'reviewer',taskIds:store.state.jobs.filter(j=>!j.conversationId&&['08','24','21'].includes(j.scenarioId)).map(j=>j.id),independentOfDevelopment:false,identityAssurance:'local same-origin session'};
}
export function grantReview(store,input,actor){
 if(actor?.role!=='reviewer'||!actor.id||!actor.taskIds?.includes(input.taskId)||input.authorized!==true)throw Error('没有此任务的人工核查授权');
 const snap=loadSemanticSnapshot(store,input.taskId);if(!snap)throw Error('请先建立审计快照');
 const token=randomBytes(32).toString('hex');grants.set(token,{actorId:actor.id,actor:structuredClone(actor),taskId:input.taskId,snapshotHash:snap.snapshotHash,expires:Date.now()+30*60*1000});return {token,taskId:input.taskId,reviewerId:actor.id,identityAssurance:actor.identityAssurance||'local same-origin session authorization; not independently authenticated organizational identity'};
}
function authorized(store,input,actor){const g=grants.get(input.reviewToken);if(!g||g.expires<Date.now()||g.taskId!==input.taskId||g.actorId!==actor?.id||actor?.role!=='reviewer'||!actor.taskIds?.includes(input.taskId))throw Error('人工核查授权失效或不属于此任务');const s=loadSemanticSnapshot(store,input.taskId);if(!s||s.snapshotHash!==g.snapshotHash)throw Error('审计快照变化，请重新授权');return s;}
export function readReviews(store,taskId){const root=path.join(semanticFolder(store,taskId),'reviews');const rows=fs.existsSync(root)?fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'))):[];for(const r of rows){const {recordHash,...v}=r;if(contentHash(v)!==recordHash)throw Error('人工历史记录哈希不一致');}return rows.sort((a,b)=>(a.sequence??0)-(b.sequence??0)||a.reviewedAt.localeCompare(b.reviewedAt)||a.id.localeCompare(b.id));}
export function submitReview(store,input,actor){
 const s=authorized(store,input,actor),c=s.candidates.find(c=>c.candidateId===input.candidateId);
 if(!c||!decisions.includes(input.decision)||typeof input.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.idempotencyKey))throw Error('候选、人工决定或幂等标识非法');
 const reason=String(input.reason||'').trim(),correction=String(input.correction||'').trim();if(!reason||reason.length>4000||correction.length>8000||input.decision==='corrected'&&!correction)throw Error('请填写核查依据；修正必须有修正内容');
 const refs=input.evidenceRefs;if(!Array.isArray(refs)||!refs.length||refs.some(id=>!c.sourceUnitIds.includes(id)))throw Error('核验依据必须指向本候选授权来源');
 const content={taskId:input.taskId,candidateId:c.candidateId,decision:input.decision,correction:correction||null,reason,evidenceRefs:refs,reviewerId:actor.id,snapshotHash:s.snapshotHash};
 const file=path.join(semanticFolder(store,input.taskId),'reviews',contentHash({actor:actor.id,key:input.idempotencyKey})+'.json');
 if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.requestHash!==contentHash(content))throw Error('重复提交内容不同，原审核保留；请使用新操作标识');return old;}
 const history=readReviews(store,input.taskId),record={version:REVIEW_VERSION,id:randomUUID(),sequence:Math.max(0,...history.map(r=>r.sequence||0))+1,...content,requestHash:contentHash(content),reviewedAt:new Date().toISOString(),originalClaim:c.originalClaim,originalCandidateHash:contentHash(c.originalCandidate),snapshotHash:s.snapshotHash,model:c.modelTrace,originalModelPrompt:{hash:c.modelTrace?.promptHash||c.originalCandidate.promptHash||null,version:'unknown'},verificationPromptVersion:s.version,fileHashes:s.sourceFiles,reviewerAuthorization:'local_same_origin_task_capability',independentGold:false,previousRecordHashes:history.map(r=>r.recordHash)};
 const result={...record,recordHash:contentHash(record)};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});return result;
}
export function reviewMetrics(snapshot,records){
 const latest=new Map();for(const r of records)if(!snapshot.snapshotHash||r.snapshotHash===snapshot.snapshotHash)latest.set(r.candidateId,r);const rows=[...latest.values()],resolved=rows.filter(r=>['accepted','rejected','corrected','irrelevant'].includes(r.decision));
 const groups=new Set(snapshot.candidates.map(c=>c.potentialDuplicateOf||c.candidateId));
 return {rawPendingRecords:snapshot.candidates.length,conservativeProblemGroups:groups.size,independentHumanProblemCount:null,independentProblemCountStatus:'not_established_by_human',humanReviewed:rows.length,deterministicallyLiteralSupported:snapshot.candidates.filter(c=>c.semanticStatus==='directly_supported').length,deterministicallySemanticallyVerified:0,falsePositives:rows.filter(r=>r.decision==='rejected').length,humanCorrected:rows.filter(r=>r.decision==='corrected').length,remainingUnresolved:snapshot.candidates.length-resolved.length,reviewRecordCount:records.length,groupingDoesNotReduceRawQueue:true};
}
export function saveGoldAnnotation(store,input,actor){const s=authorized(store,input,actor),packet=input.packet;if(actor.independentOfDevelopment!==true||packet?.annotator?.id!==actor.id||packet.caseId!==s.taskId)throw Error('Gold需要管理员预置的独立审核者身份及正确任务，普通本机授权不充当独立标注');for(const f of packet.facts||[]){const unit=s.sourceUnits.find(u=>u.id===f.source_location?.unit_id&&s.sourceFiles.find(sf=>sf.id===u.sourceId)?.name===f.source_file);if(!unit||unit.text.slice(f.source_location.start,f.source_location.end)!==f.expected_fact)throw Error('Gold需要逐字原文片段、真实位置和独立人工语义字段');}return recordAnnotation(packet,path.join(semanticFolder(store,input.taskId),'gold-annotations'));}
export function adjudicateGold(store,input,actor){const s=authorized(store,input,actor),root=semanticFolder(store,input.taskId),annotations=(input.annotationIds||[]).map(id=>{if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw Error('标注ID非法');return JSON.parse(fs.readFileSync(path.join(root,'gold-annotations',id+'.json'),'utf8'));});if(actor.independentOfDevelopment!==true||input.resolution?.adjudicatorId!==actor.id)throw Error('需要管理员预置的独立裁定者身份');
 const result=adjudicateReference({id:s.taskId,scenarioId:s.scenarioId,familyId:'p2-known-regression',usedInDevelopment:true,split:'development'},annotations,input.resolution);const file=path.join(root,'gold-adjudications',randomUUID()+'.json');atomicJson(file,result);return {file: path.basename(file),reference:result.reference,blindEligible:false,reason:'Known development material is never held-out blind evaluation'};
}
export {GOLD_VERSION};
