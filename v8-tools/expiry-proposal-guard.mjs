import {isDeepStrictEqual} from 'node:util';

// Candidate boundary: the host-owned ledger supplies trusted fields. This module
// does not read documents, invoke models, validate prose or prove parser recall.
const scope = 'Known source-ledger fields only; source recall and free prose remain unverified.';
const getters = version => ({
  category: f => f.category,
  ...(version === 2 ? {application_name: f => f.applicationName.originalValue} : {}),
  application_supplier: f => f.applicationSupplier.originalValue,
  contract_supplier: f => f.contractSupplier.originalValue,
  agreement_name: f => f.agreementName.normalizedValue,
  expiry: f => f.expiry.originalValue,
  precision: f => f.expiry.precision,
  pairing: f => f.pairing,
  timezone: f => f.timezone.value,
  renewal: f => f.renewal.value
});

function ledgerValid(ledger, fields) {
  if (!Array.isArray(ledger?.facts)) return false;
  const ids = new Set();
  for (const fact of ledger.facts) {
    if (!fact || typeof fact.id !== 'string' || !fact.id || ids.has(fact.id)) return false;
    ids.add(fact.id);
    try { if (Object.values(fields).some(get => get(fact) === undefined)) return false; }
    catch { return false; }
  }
  return true;
}

export function canonicalExpiryProposal(ledger, {schemaVersion = 2} = {}) {
  if (![1, 2].includes(schemaVersion)) throw new TypeError('Unsupported proposal schema');
  const fields = getters(schemaVersion);
  if (!ledgerValid(ledger, fields)) throw new TypeError('Invalid host expiry ledger');
  return structuredClone({facts: ledger.facts.map(f => ({
    fact_id: f.id, ...Object.fromEntries(Object.entries(fields).map(([key, get]) => [key, get(f)]))
  }))});
}

export function validateExpiryProposal(ledger, proposal, {schemaVersion = 2} = {}) {
  const issues = [], reject = code => ({accepted: false, issues: [{code}], scope});
  if (![1, 2].includes(schemaVersion)) return reject('SCHEMA_VERSION_UNSUPPORTED');
  const fields = getters(schemaVersion);
  if (!ledgerValid(ledger, fields)) return reject('LEDGER_INVALID');
  if (!proposal || !Array.isArray(proposal.facts)) return reject('FACT_ARRAY_REQUIRED');
  if (Object.keys(proposal).some(k => k !== 'facts')) issues.push({code: 'UNVERIFIED_EXTRA_ROOT_FIELD'});
  const expected = new Map(ledger.facts.map(f => [f.id, f])), seen = new Set();
  for (const [index, candidate] of proposal.facts.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({index, code: 'FACT_OBJECT_REQUIRED'}); continue;
    }
    if (Object.keys(candidate).some(k => k !== 'fact_id' && !Object.hasOwn(fields, k)))
      issues.push({index, code: 'UNVERIFIED_EXTRA_FACT_FIELD'});
    const fact = expected.get(candidate.fact_id);
    if (!fact) { issues.push({index, code: 'UNKNOWN_FACT_ID'}); continue; }
    if (seen.has(fact.id)) issues.push({index, factId: fact.id, code: 'DUPLICATE_FACT_ID'});
    seen.add(fact.id);
    for (const [field, get] of Object.entries(fields)) {
      const value = get(fact), actual = candidate[field];
      const matches = Object.hasOwn(candidate, field) && (value === null
        ? actual === null || actual === '' : isDeepStrictEqual(actual, value));
      if (!matches) issues.push({index, factId: fact.id, field, code:
        value === null ? 'UNSUPPORTED_SOURCE_VALUE' : field === 'precision' ? 'DATE_PRECISION_CHANGED'
          : field === 'pairing' ? 'UNSUPPORTED_PAIRING' : 'SOURCE_FIELD_ROLE_OR_VALUE_CHANGED'});
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) issues.push({factId: id, code: 'KNOWN_FACT_OMITTED'});
  const accepted = issues.length === 0;
  return {accepted, issues, knownFactGroups: expected.size, submittedFacts: proposal.facts.length,
    scope, ...(accepted ? {trustedProposal: canonicalExpiryProposal(ledger, {schemaVersion})} : {})};
}
