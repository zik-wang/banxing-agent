# R4: public human-reference validation repair

**Status: user resumed training on Nov6. BF16 selective and NF4/no-cache resource
probes each completed5 updates/20 microbatches. Formal training has not started:
system headroom fell again at launch. No three-seed reliability claim or
production change. A bounded admission watcher can wait30 minutes, launch at
most once after two ready samples, or preserve a blocked result.**

The earlier user deferral and failed runs remain historical records. This code
does not require closing other applications, alter pagefiles or kill processes.
`STOP` and the shared user-pause control still stop new training work.

This study measures **English contract-excerpt evidence extraction**, not Chinese
contract risk adjudication, arithmetic, legal advice, or full-contract recall.
Reference answers inherit the original [CUAD](https://www.atticusprojectai.org/cuad/)
lawyer-supervised annotations (CC BY 4.0). No generated legal labels or invented
project reviewers are presented as human Gold.

## What changed from R3

1. Quarantine R3 Chinese synthetic supervision from this study. Its prerequisite
   versus withholding-exception question was underspecified. Original files,
   outputs and scores remain untouched; removing them here changes the task and
   does not retrospectively improve R3 scores.
2. Use 1,200 original human-reference window QA for training, 64 for validation,
   and 108 test QA across 54 official-test documents absent from all saved R3
   train/dev/test document IDs. Each new test document contributes one nonempty
   and one empty example. This is prospective public held-out evaluation, **not**
   an independent third-party blind test or proof of absent base pretraining exposure.
   The upstream human annotations cover original contract spans; empty window
   targets are mechanically derived from no annotated span falling inside that
   window, not newly re-annotated by a project lawyer. Exact normalized inputs are
   deduplicated; semantic near-duplicate clauses have not been exhaustively removed.
3. Compare the same base with three LoRA seeds (61106/61107/61108), all fixed at
   300 updates, microbatch one × accumulation four. Each training row is seen
   exactly once. Validation at 100/200/300 monitors progress; it does not select
   the best checkpoint. The test opens only after all three step300 weights seal.
   These are three training seeds of the same base, not independent model voting.
4. Freeze a common scorer **before** testing: complete JSON-fence removal and
   bare-array/answers-object compatibility, preserving answer characters. Strict
   object compliance is separate. Invalid negative output is not correct abstention.
   Precision, recall, unsupported spans, false fill and invalid abstention are
   reported separately. Always-empty is a deterministic 54/108 reference, not a
   real model run. Paired intervals resample source documents, not independent QA rows.
5. Bind source/split/code audit to the exact freeze hash. Missing, failed or stale
   preflight blocks execution. Every selected reference span is reconstructed
   from original CUAD offsets; duplicate input and document leakage checks run.
6. Preserve startup/runtime failures instead of hiding them. Windows error1455
   occurred before any update in the initial attempt. A second attempt loaded
   all 338 base tensors with destination-byte verification, then failed during
   the next iteration after 50 completed updates due to system memory exhaustion.

## Runtime repairs and proof limits

- `stream_weights.py` reads one tensor payload at a time, without full-file mmap;
  checks keys, shapes, dtypes, offsets and destination SHA256. Tiny F32/BF16 tests
  passed; real base loading verified 338 destination tensors before the later OOM.
- The failure stack entered Transformers' causal-mask/vmap path. `causal.py`
  prepares the equivalent mask only for a single unpadded, unpacked, uncached
  training/dev example. Tiny Qwen tests compare **all logits, loss and parameter
  gradients**, exactly, for F32/BF16 at two lengths. This is not a proof that the
  real-model OOM is fixed. A real1.5B training-row forward probe passed during
  resource calibration; each formal arm must repeat the probe before updates.
- `supervised.py` projects vocabulary logits only at supervised next-token
  positions, preserving all context, labels, EOS and the objective. Tiny F32/BF16
  tests check loss and LoRA gradients; changed GEMM shapes may differ by numeric
  roundoff. The actual BF16715-token training-row control had identical loss and
  all supervised logits. The BF16 selective path completed5 stress updates/20
  microbatches, but varying system headroom still prevents claiming a full run.
- Trim unused CUDA cache after each microbatch/dev example and record commit/
  CUDA memory. The old12GiB commit/4GiB physical guard was conservative, not a
  universal minimum. Current candidate admission is7GiB commit for BF16 or6GiB
  for NF4 before Torch import (5GiB after import), with1GiB physical and4.5GiB
  GPU free; runtime commit reserve1.5GiB is
  above the original1GiB runtime floor. Guards can still stop a run when other
  applications allocate memory. No OS/pagefile changes or automatic retry.
- An explicitly separate **NF4 QLoRA** protocol is available via `--nf4` resource
  calibration. It uses bitsandbytes0.48.1 NF4 double quantization with block64,
  uint8 storage/BF16 compute; tied embeddings/head and norms stay BF16, LoRA is
  FP32. Original base tensors are verified before conversion; packed weights and
  quantization-scale hashes must agree across every arm and the baseline reload.
  This is **not BF16-equivalent**: compare NF4 baseline to NF4+LoRA only, never
  pool it with historical BF16 scores. Data and quality gates do not change.
  NF4/no-cache calibration completed5 updates/20 microbatches. Allocator counters
  are disabled in this mode and report0: **not zero GPU usage**. Driver-global
  usage is separately logged, includes other applications, and is not an isolated
  process peak. In NF4 load receipts, parameter `numel` counts packed stored
  elements, not the original model's logical architectural parameter count.
  The real NF4 control had zero loss difference but maximum logit difference
  .0625 within the pre-recorded BF16 roundoff tolerance; not bit identity.
  Before any formal NF4 arm, wall limits were frozen at2h/arm and8h total to
  account for allocator overhead. Steps, data and scoring thresholds are fixed.
- `calibrate.py` runs at most5 stress updates/20 microbatches within6 minutes on
  training rows only. These are not seed results or held-out predictions. The
  full-vocabulary equivalence control may use a short original training row;
  optimized training itself is stressed with longest sequences/targets. `amend.py`
  creates a fresh frozen directory instead of rewriting previous experiments.
- `wait_capacity.py` is a stdlib-only, separate admission wrapper. It waits at
  most30 minutes, requires two samples15s apart above6.5GiB commit plus the
  physical floor, and makes at most one protected launcher attempt. It respects
  shared pause/deadline and `STOP`, journals wait time separately from execution,
  preserves prior startup logs, and cannot mark overall T2/user acceptance done.
- `launch.py` is lightweight and defaults to **check only**. It checks capacity
  before importing Torch in a child, logs directly to a file rather than a
  PowerShell Tee pipeline, and requires explicit `--start-training` to execute.
  It refuses to overwrite an already-started execution.
- A long unexplained execution gap, user stop, deadline, nonfinite loss, resource
  pressure or an incomplete arm stops the study. Missing seeds are not silently
  excluded from a claimed three-seed result. Test gates are frozen, not weakened
  after observing results. Three seeds still do not prove broad training stability.

## Actual current artifacts

Prepared candidate (local, not Git):

`D:/pro222/pccr-eye-gaze/qa-output/contract-qwen15b-r4-human-v3-20261106-worker02`

- `protocol-tests.log`: **15/15** focused tests, including syntax scoring,
  stale/missing approval, tensor copying and tiny-model mask equivalence.
- `preflight-audit.json`: **37 checks**, **1,372** final QA source records
  reconstructed. These are mechanical checks, not 37 legal cases or human signoff.
- `freeze.json`: input/protocol/code SHA; `base-manifest.json`: actual base hashes.
- `data-decisions.jsonl`: selection/removal reasons, not deleted original data.
- `execution-amendment.json`: exact runtime-only candidate changes and prior failure.
- `readiness.json`: actual capacity check, no training launch; `DEFERRED.json`:
  latest user instruction to deliver fixes first and train later.
- `sample-examples.json`: six actual **training** Q/A examples, one per field.
  Held-out answers are not shown in the handoff examples or supplied to a model.

Historical attempts remain separate:

- `.../contract-qwen15b-r4-human-20261106-worker02`: loader error1455, zero updates.
- `.../contract-qwen15b-r4-human-v2-20261106-worker02`: 50 completed updates in
  seed61106, then MemoryError. No validation/test completion. There is no complete
  optimizer checkpoint for continuing those 50 updates. A later run starts from
  the frozen base; it must not be described as checkpoint recovery or merged into
  this partial history.

## Reproduce when training is explicitly resumed

Use the preserved Python3.12 environment with torch2.6.0+cu124,
transformers4.56.2, peft0.17.1 and the existing local BF16 base. Frozen original
model hashes must match. Weights and full datasets are not pushed to Git.

Readiness only, no training:

```powershell
& '<venv>/Scripts/python.exe' '<candidate>/executed-code/launch.py' --root '<candidate>' --base 'D:/AI-Models/Qwen2.5-1.5B-Instruct'
```

Only after the user explicitly resumes training: preserve a resume receipt and
remove the candidate's user-created `STOP` marker, then append `--start-training`
to that command. Do not run it during a user pause. The child checks all
hashes again. If a started execution fails, preserve it and diagnose the exact
cause; never reuse its directory or sample repeatedly until a good score appears.

The study's fixed baseline + three-seed test requires **432 local outputs on 108
QA / 54 contracts**. Those outputs have **not been produced**. No new accuracy,
completed loss curve, model superiority, Chinese legal reliability or user
acceptance is claimed in this repair handoff. The live8884 remains unchanged.
No new27B comparison was run, so this handoff cannot support superiority to27B.
