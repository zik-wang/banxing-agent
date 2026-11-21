# V7-QA-007: retry the latest failed operation

Base: clean development commit `6ba2446`. The defect remained present after fixes 001–006.

## Reproduction from independent evidence

Read-only inputs: `fix-request-retry.json`, `iteration-history/r1-faults/results.json` and `diagnostics.json`. The regression fixture is a reduced copy of the four relevant runs and their jobs, preserving their original IDs and timestamps. No QA files are edited.

Sequence: successful Excel → failed PDF → failed PDF retry → model timeout for `按部门汇总。` → retry.

- Expected latest failure: `eb2f4c13-a847-4321-b16d-e6835c786558` (model).
- Actual on 6ba2446: `ad3a253f-313e-4b9d-b7e3-e277c8a7fa0e` (older PDF retry).
- Developer baseline replay: `qa-output/retry-fix/baseline-reproduction.json`.

## Cause and narrow fix

`planOffice` previously selected an office failure and returned before considering model failures. Its comparison against the latest failed job did not include a model failure without a job. The resulting priority was operation type rather than chronology.

Retry candidates from both run types now share one chronological selection before dispatch. Equal timestamps use the latest appended run. Explicit retry IDs are constrained to the current conversation and their own failed jobs; already recovered failures are not revived. A later failed background job still uses its existing recovery path. Input authorization, model limits, export generation and invoice 09 implementation are unchanged.

## Verification

`node --test tests/v7-qa-007.test.mjs tests/p43-office.test.mjs`

Six new named regressions cover captured IDs, the reverse ordering, equal timestamps, explicit older selection, cross-conversation/missing IDs, recovered failures, later background-job failures, and the full production failure chain. The integration test uses actual Workspace upload, Harness routing, XLSX generation and readback; only the converter call and model execution are injected failures. It verifies the final retry calls the model again, does not call the PDF converter a third time, and keeps the original Excel bytes/artifact ID intact.

Set `QA_RETRY_REPORT_DIR=qa-output/retry-fix` to save integration run IDs and versioned evidence. This test makes **zero real model POSTs**; it does not simulate model correctness or calendar functionality. Full current regression and the existing real-browser conversion/download smoke are also required for handoff. The earlier six-case real-Qwen browser evidence belongs to the previous handoff and is not presented as a new execution of this commit.

New `fix-ready.json` includes 001–007 so independent QA can regress all seven. Developer checks do not constitute independent acceptance. No main merge or changes to QA worktree/evidence or services 8814/8826.
