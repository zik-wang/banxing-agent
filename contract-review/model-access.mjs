import fs from 'node:fs';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export const contextFingerprint = context => hash(JSON.stringify(context));

// This configuration is owned by the operator, never by document text or web input.
// External access is an exception for an explicitly approved, immutable test corpus.
export function authorizeModelInput(config, context) {
  const chat = config.chat || {};
  if (chat.provider === 'intranet' && /^https?:\/\/10\.\d+\.\d+\.\d+(?::\d+)?\/v1\/?$/.test(chat.baseUrl || '')) {
    return {destination: 'intranet', approval_id: null};
  }
  const approval = config.externalApproval;
  if (!approval) throw Error('CONTRACT_PRIVATE_INPUT_REQUIRES_APPROVED_INTRANET');
  const url = new URL(chat.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname)) throw Error('EXTERNAL_DESTINATION_NOT_APPROVED');
  if (!approval.approval_id || approval.provider !== chat.provider || approval.base_url !== chat.baseUrl || approval.model !== chat.model) throw Error('EXTERNAL_DESTINATION_NOT_APPROVED');
  if(approval.material_classification==='temporary_user_test'&&(!config.temporaryCloudGrant||config.temporaryCloudGrant.id!==approval.temporary_grant_id||Date.parse(approval.expires_at)<=Date.now()||!Number.isFinite(Date.parse(approval.expires_at))))throw Error('TEMPORARY_TEST_GRANT_INVALID_OR_EXPIRED');
  if (!['synthetic', 'public',...(config.temporaryCloudGrant?['temporary_user_test']:[])].includes(approval.material_classification)) throw Error('EXTERNAL_PRIVATE_MATERIAL_NOT_ALLOWED');
  if (approval.context_sha256 !== contextFingerprint(context)) throw Error('EXTERNAL_CONTEXT_NOT_APPROVED');
  const hashes = config.inputs?.map(input => hash(fs.readFileSync(input.path))) || [];
  const allowed = approval.input_sha256;
  if (!hashes.length || !Array.isArray(allowed) || hashes.length !== allowed.length || allowed.some(x => !/^[a-f0-9]{64}$/.test(x)) || [...hashes].sort().some((x, i) => x !== [...allowed].sort()[i])) throw Error('EXTERNAL_INPUT_HASH_NOT_APPROVED');
  const policyHash = config.policyFile ? hash(fs.readFileSync(config.policyFile)) : null;
  if (approval.policy_sha256 !== policyHash) throw Error('EXTERNAL_POLICY_NOT_APPROVED');
  return {destination: 'approved_external_test', approval_id: approval.approval_id, material_classification: approval.material_classification, input_sha256: hashes, context_sha256: approval.context_sha256, policy_sha256: policyHash};
}

export function loadModelCredentials(chat) {
  let apiKey = chat.apiKey;
  if (chat.apiKeyEnv) apiKey = process.env[chat.apiKeyEnv];
  if (chat.apiKeyFile) {
    const stored = fs.readFileSync(chat.apiKeyFile, 'utf8').replace(/^\uFEFF/, '').trim();
    apiKey = stored.startsWith('{') ? JSON.parse(stored).apiKey : stored;
    if (typeof apiKey !== 'string') throw Error('MODEL_CREDENTIAL_INVALID');
    apiKey = apiKey.trim();
  }
  if ((chat.apiKeyEnv || chat.apiKeyFile) && !apiKey) throw Error('MODEL_CREDENTIAL_MISSING');
  return {...chat, ...(apiKey ? {apiKey} : {})};
}
