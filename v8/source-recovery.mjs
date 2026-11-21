import {contentHash,canonical} from './reliability.mjs';
import {resolveArtifact} from './artifacts.mjs';
import {modelConfigFingerprint} from './inference-config.mjs';
import {readRecovery,validateTaskResume} from './task-recovery.mjs';
import {SOURCE_JSON_PROTOCOL} from './analysis-protocol.mjs';
export function sourceRecoveryIdentity(ctx,inventory,instruction=''){return {scopeHash:contentHash({scenario:ctx.job.scenarioId,rules:ctx.job.rules||'',files:inventory.files}),unitsHash:contentHash(inventory.units),modelConfigFingerprint:modelConfigFingerprint(ctx.harness?.modelStatus?.()||{}),promptVersions:{extract:SOURCE_JSON_PROTOCOL+'|'+contentHash(instruction),audit:SOURCE_JSON_PROTOCOL+'|independent-audit|'+contentHash(instruction)}};}
export function restoreSourceRecovery(ctx,inventory,identity){
 const from=ctx.job.options?.executionResumeFrom;if(!from)return null;
 const previous=validateTaskResume(ctx.store,{scenarioId:ctx.job.scenarioId,from,conversationId:ctx.job.conversationId,rules:ctx.job.rules,files:ctx.job.dataScope||ctx.files,currentTaskId:ctx.job.id});
 const checkpoint=readRecovery(ctx.store,previous);let payload,adopted;
 if(checkpoint){payload=structuredClone(checkpoint.payload);adopted={};}
 else{
  const artifact=previous.artifacts.find(a=>a.name==='来源覆盖与候选账本.json');if(!artifact)throw Error('缺少可核查的来源恢复账本');
  const bytes=resolveArtifact(ctx.store,previous.id,artifact.id).bytes;if(contentHash(bytes)!==artifact.sha256)throw Error('历史来源账本哈希不一致');
  const ledger=JSON.parse(bytes);
  if(previous.reliability?.modelName!==(ctx.harness?.modelStatus?.()?.modelName||'configured-model'))throw Error('历史模型已改变，不能冒充同配置恢复');
  payload={inventory:ledger.inventory,candidates:ledger.candidates,dispositions:ledger.dispositions,receipts:ledger.receipts,pending:ledger.unresolved.filter(r=>r.kind==='pass_failure'),legacyLedgerSha256:artifact.sha256,legacyPromptProtocol:ledger.encodingProtocol||'unknown',legacyModelConfiguration:'only client settings observed in P1; backend/quantization remain unknown'};
  adopted={checkpointSha256:artifact.sha256,dispositions:payload.dispositions,receipts:payload.receipts,providerRequests:previous.reliability?.providerRequests||ledger.coverage.calls,analysisCalls:ledger.coverage.calls,wallMs:Date.parse(previous.finishedAt)-Date.parse(previous.startedAt)};
 }
 if(contentHash(payload.inventory.units)!==identity.unitsHash||canonical(payload.inventory.files)!==canonical(inventory.files))throw Error('历史来源片段、顺序或正文已改变');
 for(const field of ['candidates','dispositions','receipts','pending'])if(!Array.isArray(payload[field]))throw Error('来源恢复数据不完整');
 const known=new Map(inventory.units.map(u=>[u.id,u])),candidateIds=new Set(payload.candidates.map(c=>c.id));
 if(candidateIds.size!==payload.candidates.length||payload.dispositions.some(d=>!known.has(d.unitId)||!['extract','audit'].includes(d.pass)||d.candidateId&&!candidateIds.has(d.candidateId)))throw Error('历史候选身份或片段处置无效');
 for(const candidate of payload.candidates)for(const ref of [...candidate.basis,...candidate.evidence]){const u=known.get(ref.unitId);if(!u||u.sourceId!==ref.sourceId||u.text!==ref.quote)throw Error('历史候选证据已改变');}
 return {...payload,previous,adopted};
}
