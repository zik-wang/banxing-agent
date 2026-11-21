import {randomUUID} from 'node:crypto';
import {isApprovedWebCloud} from '../v8-tools/provider-config.mjs';
export function activeTemporaryPolicy(operator,chat,now=Date.now()){
 const p=operator?.temporaryCloudTest;
 return !!(p?.enabled===true&&p.authorizedBy==='local_user'&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now&&p.provider===chat?.provider&&p.baseUrl===chat?.baseUrl&&p.model===chat?.model&&isApprovedWebCloud(chat));
}
// Inspect provenance metadata only. No audio or transcript bytes are opened.
export function inspectTestSources(space,projectId,refs){
 const index=space.load(),seen=new Set();
 function visit(ref){const key=ref.resourceId+':'+ref.revisionId;if(seen.has(key))return;seen.add(key);if(seen.size>2000)throw Error('TEST_SOURCE_LINEAGE_LIMIT');const v=space.check(projectId,ref,new Set(),index),r=index.resources[ref.resourceId],m=v.metadata||{},name=m.name||m.asset?.name||'';
  if(m.asset?.kind==='audio'||m.asset?.kind==='video'||m.modality==='audio'||m.transcript===true||m.transcribed===true||m.protectedAudio===true||m.sourceKind==='audio'||/\.(?:m4a|mp3|wav|flac|ogg|aac|mp4|webm)$/i.test(name))throw Error('PROTECTED_AUDIO_LINEAGE');
  for(const p of v.parents||[])visit(p);
  return {resourceId:ref.resourceId,revisionId:ref.revisionId,sha256:v.hash,kind:r.kind,name,parents:v.parents||[]};
 }
 return refs.map(ref=>{const r=visit(ref);if(!r)throw Error('DUPLICATE_TEST_SOURCE');if(r.kind!=='original'||r.parents.length||! /\.(?:docx|pdf)$/i.test(r.name))throw Error('TEMPORARY_TEST_REQUIRES_SELECTED_ORIGINAL_CONTRACT');return {resourceId:r.resourceId,revisionId:r.revisionId,sha256:r.sha256};});
}
export function createTemporaryGrant(space,projectId,conversationId,refs,operator,chat){
 if(!activeTemporaryPolicy(operator,chat)||!refs.length)return null;
 const materials=inspectTestSources(space,projectId,refs);return {id:randomUUID(),policyId:operator.temporaryCloudTest.id,projectId,conversationId,materials,expiresAt:operator.temporaryCloudTest.expiresAt,omitPriorContext:true,createdAt:new Date().toISOString()};
}
export function validateTemporaryGrant(space,projectId,conversationId,refs,grant,operator,chat){
 if(!grant||!activeTemporaryPolicy(operator,chat)||grant.policyId!==operator.temporaryCloudTest.id||grant.projectId!==projectId||grant.conversationId!==conversationId||Date.parse(grant.expiresAt)<=Date.now()||grant.expiresAt!==operator.temporaryCloudTest.expiresAt)throw Error('TEMPORARY_TEST_GRANT_INVALID_OR_EXPIRED');
 const actual=inspectTestSources(space,projectId,refs),sort=a=>a.map(x=>JSON.stringify(x)).sort().join('\n');if(sort(actual)!==sort(grant.materials))throw Error('TEMPORARY_TEST_SOURCE_CHANGED');return true;
}
