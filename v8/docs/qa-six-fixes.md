# V7-QA-001—006 development handoff

Scope: `dev/qa-supervisor-20261026`, based on independent QA commit `2b1e4263e9afa36eb32c1717d85da4da2b89adc8`. No changes to main, QA worktree/evidence, invoice 09 handlers, or services 8814/8826. Independent QA acceptance remains required.

## Confirmed causes and changes

- **001:** The captured group call put `金额` in `metric`, later adding `operator: sum`, without `column`. Seven model rounds contained one describe and six failed edit calls. The tool schema previously accepted arbitrary strings. The schema now uses the Harness-supported `oneOf` and explicit metric enums, requires a column for numeric aggregation, and forbids the filter operator in aggregate steps. Executor errors explain how to correct the arguments. No round-limit increase and no hardcoded department answers.
- **002:** The first invoice result was a general export with no invoice ledger or source-filename column. The edit path only imported ledger buyer-role records and matched by filename. It never consulted cached original `Recipient:` lines. The new adapter checks original access and hash, reads only explicit labels, retains file/hash/line references, and joins by an unambiguous invoice identifier when filename is unavailable. Multiple recipients or duplicate identities remain unresolved. Bill To/buyer is not treated as Recipient. No new OCR or changes to 09.
- **003:** `算一下总金额` missed the calculation parser and went through general chat, which repeated the previous delivery. It now routes to the existing deterministic amount aggregation with currency separation and nonnumeric-value refusal; the result is a new workbook retaining details and recipient columns.
- **004:** `把之前的 Excel 也给我` was not recognized as retrieval. It now finds a permitted, verified prior artifact of the requested format and exposes the same ID, without model inference or regeneration. Export filename construction also removes existing office extensions before appending the requested extension.
- **005:** `planOffice` chose the latest result before attachment resolution; its automatically injected file IDs overrode “second file”. Positional and latest-file references now bypass that implicit result selection. Explicit picker selection still has priority. Unknown/unavailable ordinals ask for selection rather than substitute another file.
- **006:** The exclusion regex accepted `不要用` but not `不要第一个文件`. The latter now follows the deterministic selection path and persists exclusion. Ordinals retain their original upload positions after exclusion; subsequent edits must stay within active sources.

## Reproducible checks

`node --test tests/v7-qa-001.test.mjs tests/v7-qa-addendum.test.mjs`

Seven named regression tests cover captured invalid tool calls, all supported metrics, currency/unknown-value guards, real XLSX round trips, the three original synthetic invoice PDFs, the captured first export, 636 CNY, prior artifact identity, duplicate extensions, Recipient ambiguity/access/hash gates, A/B/C/D selection, exclusion, and explicit picker priority. These are deterministic/unit/integration checks, not model calls.

`node scripts/qa-run.mjs regression` runs the complete repository suite. `node scripts/qa-run.mjs build` checks syntax. Current actual results are in ignored `qa-output/supervisor/`, including raw TAP and archived attempts.

## Browser and model reproduction

Prepare a fresh isolated developer namespace using `node scripts/qa-bugfix-smoke.mjs --prepare`. It refuses to overwrite existing state. This seeds only the captured initial invoice export with the original synthetic PDFs; it does **not** claim a new first-round model extraction.

Start `scripts/start-qa.mjs` with `QA_NAMESPACE=dev-six-fixes`, an unused `PORT` (this round 8843), and an explicitly authorized `V7_DEPLOYMENT_CONFIG`. Set `QA_URL`, `QA_PLAYWRIGHT_MODULE`, and `QA_CHROMIUM`, then run `node scripts/qa-bugfix-smoke.mjs`.

The script uses actual page controls for recipient, total, Word, prior Excel, A/B/C/D uploads, ordinal/latest selection, exclusion and next edit. It downloads the exact artifact ID and checks SHA256 and workbook contents. Department merge/dedup is deterministic; `按部门汇总。` then uses the real configured Qwen and production Harness with its existing seven-round cap. This is a development-side retest, not independent QA acceptance. First merge wording in the browser test is `合并表格`; the original `这俩合起来` failure context is covered by QA records and captured-call replay.

Evidence: `qa-output/six-fixes/browser-results.json`, per-run downloaded files, screenshots, `live-group-events.json`, and original model sessions under `.qa-runtime/dev-six-fixes/harness-sessions/`. Prior browser attempts are retained. Earlier script failures included a port collision caught by version validation before task submission, awaiting upload completion, and selecting the exact current artifact instead of a same-name historical link. These are not hidden as passing attempts.

## Limits

The changes do not establish general semantic accuracy or cover arbitrary Recipient layouts. Cached text with no unambiguous explicit label stays unresolved; OCR accuracy is not newly verified. Real calendar account coverage is unchanged. Independent QA's 24-request gate is not a service outage and is not reused by this developer namespace. No PDF false-positive ticket is included.
