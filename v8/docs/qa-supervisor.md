# Development / independent QA handoff

This branch adds observability and reproducible QA entry points. It does not declare independent acceptance or fix every historical business bug. Keep the private repository private. Do not merge into main or replace the mentor service automatically.

## Isolated checkout and startup

Use Node >=22.19, `npm ci`, then `npx playwright install chromium`. Dependencies and Playwright version are locked. Each QA run should use its own checkout and namespace. Do not point two processes at the same state directory.

```powershell
git fetch origin
git worktree add -b qa/my-evaluation ../banxing-qa origin/dev/qa-supervisor-20261026
cd ../banxing-qa
npm ci
npx playwright install chromium
$env:QA_NAMESPACE='qa-evaluation-001'
$env:PORT='8835'
npm run qa:start
```

In another terminal use `QA_URL=http://127.0.0.1:8835`. Run `npm run qa:fixtures`, `qa:build`, `qa:preflight`, `qa:smoke`, `qa:regression`, `qa:report`. Commands fail nonzero on actual failures. Smoke uses an isolated browser context and real upload, chat, conversion, registry, readback and download routes; it performs deterministic XLSX→Word→XLSX conversion without calling a model. Unit suites include explicitly named mocks and fault injection; neither counts as real Qwen evidence. `qa:regression` runs every existing `tests/*.test.mjs`, including 09, without weakening assertions.

If using a preinstalled browser, optional `QA_CHROMIUM` points to its executable. `QA_PLAYWRIGHT_MODULE` is an optional absolute path to Playwright's `index.mjs`; normally the locked local dev dependency is used.

`qa:start` creates `.qa-runtime/<namespace>` and refuses a conflicting `DEMO_DATA_DIR`. Production data, calendars, conversations and historical artifacts are not copied. There is no cleanup API: retain or archive the entire explicitly selected namespace, never use broad deletion. Synthetic fixtures are generated under `qa-output/supervisor/fixtures` with input hashes and fixed expected answers: four PDF invoices, different-field workbooks, a 14-column workbook, A/B context text and isolated-calendar settings. They are not real-document gold answers. Timeout and missing-file cases are unit fault injections, not external service failures.

Model defaults to unconfigured. Set `V7_DEPLOYMENT_CONFIG` to an authorized local private profile to enable real Qwen; do not commit it. `qa:preflight` distinguishes service availability from model configuration. No public-model credential or permission is implied by launching QA. Real model tests are a separate phase and must state input authorization, provider, elapsed time, failures and usage actually returned.

## Read-only diagnostics

Endpoints require loopback Host/same-origin checks and `x-csrf-token` obtained from `/api/state`; enabled only with `QA_NAMESPACE`. This is the existing single-user local app boundary, not multi-user RBAC.

- `GET /api/qa/version`: startup commit/branch/source hashes, current disk fingerprint, actual loaded module hashes, telemetry error status. Changes after startup are observable; restart only the isolated QA service when loaded and disk hashes differ. A dirty worktree is explicitly recorded.
- `GET /api/qa/conversation?conversationId=...`: persisted current work state, latest operation, failed-operation candidates and ambiguity, resolved input IDs, task links, artifacts and current identity checks. No chat content is guessed as backend state. Missing IDs return 404. It does not call the model or mutate state.
- `GET /api/qa/events?conversationId=...&after=0&limit=500`: monotonic cursor, at most 1000 events. Page until empty. Raw append-only journal: `.qa-runtime/<namespace>/qa-observability/events.jsonl`.

Each event has eventId, timestamp, sequence, namespace, stage/status and available correlation IDs. `runId` is the existing chat run ID; direct Workspace jobs use `execution:<jobId>`. `message:<runId>` is a stable logical message ID because this product stores messages as runs; it is explicitly not an external platform message ID. `taskId` is the Workspace job ID. Existing workItem IDs are preserved, with run ID fallback. `modelCallId` is generated at Harness request dispatch; toolCallId is the actual Harness call ID. Source IDs and artifacts retain their existing values.

Persisted transitions cover file context, intent (when classifier actually produced it), task state, structured results, validators, artifact registration and delivery settlement. Direct hooks cover file parsing, generation, readback and Harness model/tool dispatch. Legacy trace rows are marked `legacy_trace`, with hashes rather than sensitive free text. Restored records are labeled `persisted_state_restored`, never presented as new execution. An absent stage is `not_observed`, not assumed successful or skipped. Not all vision/OCR provider internals use DeepSeek; those internal calls remain legacy traces until separately instrumented. A model request start does not claim a provider response or usage count. Token/cost fields unavailable from this hook remain unknown.

Tool-returned `isError` records failure. Timeout, cancellation, budget and access error categories are distinct. Prompts, model text, tool arguments, credentials and arbitrary error bodies are not copied into the new journal; hashes allow matching authorized native records. Native existing session logs retain their existing storage policy. An observer write failure is surfaced in diagnostics/preflight, while already generated business files remain preserved.

## Delivery semantics and browser selectors

`identityVerified` means bytes currently exist and match registered hash/size. `readbackVerified` requires an actual existing format readback record; it does not mean factual correctness. `deliveryRegistered` refers to a persisted settlement record; a valid download URL alone does not assert delivery. `uiRendered` is always `not_observed_server_side`; independent browser QA must check the card and actual download. Previous verified artifacts remain separately inspectable after later failures. Format-only conversion must retain source identity and old versions; current regression assertions test these conditions.

Stable `data-testid`: `new-conversation`, `conversation-input`, `send-message`, `attachment-upload`, `attachment-list`, `task-status`, `artifact-card`, `artifact-download`, `delivery-status`, `retry-operation`. Repeated selectors intentionally identify multiple real cards; narrow with task/artifact attributes. No synthetic test buttons or business logic bypass.

## Independent QA protocol

Developer writes `fix-ready.json` and `version-manifest.json` after the implementation commit; these generated files are ignored by Git so their commit is not self-referential. `npm run qa:handoff` requires clean code, matching evidence fingerprint and passing required checks, then emits these files. Re-running QA in another checkout produces its own evidence. `FIX_READY` means ready for independent testing, never QA-approved. Local report directory: `qa-output/supervisor`; raw TAP and browser failures are retained. Test reports also capture source hash and dirty files, so pre-commit runs cannot be mistaken for clean-commit execution.

Supervisor should freeze/fetch the exact commit on its own QA branch and namespace, store its original records outside the developer checkout, and submit bugs with bugId, testedCommit, namespace, conversationId, runId/taskId, reproduction steps, expected/actual behavior and evidence paths. Developer must not edit supervisor originals. No automatic merge is configured. Bug A–E should be independently reproduced: attachment bindings, most-recent failed operation, missing delivery, wide-table conversion and incremental edits.

Current limits: these interfaces improve observability; they do not prove 28-scene correctness, zero omissions, real calendar connectivity or complete provider telemetry. Independent QA, real Qwen stress testing and semantic gold evaluation remain pending.
