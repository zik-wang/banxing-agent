// Content-only helper. Frozen expected is supplied independently, never sent to a model.
// Usage: node check-s08-synthetic-content.mjs EXPECTED_JSON ACTUAL_TEXT
// An end-to-end PASS still requires actual final reply, downloaded bytes and run binding.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [expectedFile,textFile]=process.argv.slice(2);
if(!expectedFile||!textFile)throw Error('Provide independent expected JSON and actual text');
const e=JSON.parse(fs.readFileSync(expectedFile,'utf8')),text=fs.readFileSync(textFile,'utf8');
assert.equal(e.case_id,'S08-001');assert.equal(e.synthetic,true);
const normalize=s=>s.normalize('NFKC').replace(/[，,]/g,'').replace(/\s+/g,'');
const s=normalize(text);
const changes=e.changes.map(c=>({field:c.field,before:c.before,after:c.after,valuesPresent:s.includes(normalize(c.before))&&s.includes(normalize(c.after))}));
const unchanged=e.unchanged.map(c=>({field:c.field,value:c.value,present:s.includes(c.field)&&s.includes(normalize(c.value))&&/未变|不变|保持/.test(s)}));
const added=e.added.map(c=>({field:c.field,value:c.value,present:s.includes(normalize(c.value))&&/新增|增加/.test(s)}));
const allRequiredContentFound=changes.every(c=>c.valuesPresent)&&unchanged.every(c=>c.present)&&added.every(c=>c.present);
console.log(JSON.stringify({caseId:e.case_id,allRequiredContentFound,changes,unchanged,added,casePass:false,
 qualification:'Presence helper only. Independently check old/new direction, unsupported claims and actual same-run final reply/download/version evidence before assigning case PASS.'}));
if(!allRequiredContentFound)process.exitCode=1;
