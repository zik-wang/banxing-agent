import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalExpiryProposal, validateExpiryProposal} from '../v8-tools/expiry-proposal-guard.mjs';

// Synthetic text only: no user documents or raw model requests belong in these tests.
const field = value => ({originalValue: value, normalizedValue: value});
const ledger = () => ({facts: [
  {id: 'printed-group', category: 'Finance', applicationName: field('Atlas & Ember'),
    applicationSupplier: field('Vendor A & Vendor B'), contractSupplier: field(null), agreementName: field(null),
    expiry: {...field('31/03/2032 & 30/11/2034'), precision: ['day', 'day']},
    pairing: 'unresolved', timezone: {value: null}, renewal: {value: null}},
  {id: 'narrative-agreement', category: 'Narrative expiry', applicationName: field(null),
    applicationSupplier: field(null), contractSupplier: field(null), agreementName: field('Nova Enterprise Agreement'),
    expiry: {...field('2035'), precision: ['year']}, pairing: 'explicit_predicate',
    timezone: {value: null}, renewal: {value: null}}
]});
const check = mutate => { const l = ledger(), p = canonicalExpiryProposal(l); mutate(p.facts, p); return validateExpiryProposal(l, p); };
test('trusted projection preserves grouped values and year precision without changing its ledger', () => {
  const l = ledger(), p = canonicalExpiryProposal(l), result = validateExpiryProposal(l, p);
  assert.equal(l.facts.length, 2); assert.equal(result.accepted, true);
  assert.equal(result.trustedProposal.facts[0].contract_supplier, null);
  result.trustedProposal.facts[1].precision[0] = 'day';
  assert.deepEqual(l.facts[1].expiry.precision, ['year']);
});
for (const [name, mutate, field] of [
  ['application supplier promoted to contract party', f => { f[0].contract_supplier = f[0].application_supplier; }, 'contract_supplier'],
  ['agreement name promoted to contract party', f => { f[1].contract_supplier = f[1].agreement_name; }, 'contract_supplier'],
  ['unsupported supplier inferred from a narrative brand', f => { f[1].application_supplier = 'Nova'; }, 'application_supplier'],
  ['product name promoted to agreement name', f => { f[0].agreement_name = f[0].application_name; }, 'agreement_name'],
  ['unconfirmed grouped dates assigned a pairing', f => { f[0].pairing = 'explicit_predicate'; }, 'pairing'],
  ['timezone inferred from location', f => { f[0].timezone = 'Europe/Example'; }, 'timezone'],
  ['year precision promoted to a day', f => { f[1].precision = ['day']; }, 'precision'],
  ['date components confused with finest precision', f => { f[1].precision = ['day', 'month', 'year']; }, 'precision'],
  ['source category changed', f => { f[0].category = 'Unrelated'; }, 'category']
]) test(name + ' is rejected', () => { const r = check(mutate); assert.equal(r.accepted, false); assert(r.issues.some(i => i.field === field)); assert(!Object.hasOwn(r, 'trustedProposal')); });
test('unknown, duplicated and omitted fact identities are rejected', () => {
  assert(check(f => { f[0].fact_id = 'another-source'; }).issues.some(i => i.code === 'UNKNOWN_FACT_ID'));
  assert(check(f => { f.push(structuredClone(f[0])); }).issues.some(i => i.code === 'DUPLICATE_FACT_ID'));
  assert(check(f => { f.pop(); }).issues.some(i => i.code === 'KNOWN_FACT_OMITTED'));
});
test('unverified extra assertions and missing unknown fields cannot enter trusted output', () => {
  assert.equal(check(f => { f[0].note = 'already renewed'; }).accepted, false);
  assert.equal(check((_f, p) => { p.summary = 'approved'; }).accepted, false);
  assert.equal(check(f => { delete f[0].contract_supplier; }).accepted, false);
});
test('legacy schema must be explicit and invalid host state fails closed', () => {
  const l = ledger(), p = canonicalExpiryProposal(l, {schemaVersion: 1});
  assert(validateExpiryProposal(l, p, {schemaVersion: 1}).accepted);
  assert(!validateExpiryProposal(l, p).accepted);
  assert.equal(validateExpiryProposal({facts: [null]}, p).issues[0].code, 'LEDGER_INVALID');
  assert.equal(validateExpiryProposal(l, null).accepted, false);
});
