# R3 local SFT: completed experiment, not release-qualified

2026-11-05. No production deployment, no cloud API requests, no model weights in Git.
This is bounded contract-excerpt evidence extraction, not legal approval or arithmetic.

## Actual conditions

- Qwen2.5-1.5B-Instruct, BF16 base, FP32 LoRA, rank 8, alpha 16, dropout .05,
  q_proj/v_proj. 1,089,536 trainable parameters; total including adapter 1,544,803,840.
- Full training: 1,200 QA (480 authored Chinese synthetic + 720 original CUAD
  human-reference QA); proportional small subset: 300. Dev 64; test 192.
- Same seed, prompts, greedy decoding, max 160 new tokens and scoring for all arms.
  Assistant answer/EOS only enters training loss. Microbatch 1, accumulation 4,
  AdamW lr 1e-4. Per-update sample IDs/token counts/gradient norms preserved locally.
- Small arm: 600 optimizer updates, six actual validation checkpoints. Full arm:
  384 updates, three checkpoints. Both selected step 300 by dev F1 only. At that
  point each saw 1,200 presentations: 300 unique QA four times versus 1,200 once.
- Selected dev losses: small 0.0527758481; full 0.0412950029. Dev corpus-macro
  exact-answer-set F1 was 0.828125 for both.
- Full arm had an unexplained approximately 116-minute execution/clock gap and
  stopped on the predeclared arm time budget. It was not extended. Wall time is
  not active GPU time. Different selection opportunities limit causal comparisons.

## Outcomes and interpretation

192 test QA × 3 groups = **576 actual local generations**, not 576 contracts.
Strict required answers-object matching: base 0/192 (protocol failures), small
132/192, full 133/192. Base zero must **not** be described as zero understanding.

A clearly marked **post-hoc diagnostic**, identical for all groups, only removes
complete JSON fences and wraps bare string arrays; no answer characters or meaning
are changed. Exact matches then are 36/192, 132/192, 133/192. Chinese diagnostic
matches: 5/128, 80/128, 82/128; English human-reference matches: 31/64, 52/64, 51/64.
This diagnostic does not replace the frozen primary scores or release gates.

Both adapters produced legal required JSON on 192/192. The full arm matched
Chinese amount and payment-duration references on 32/32 each, but these are limited
synthetic inputs: 12 distinct test amount strings, seven duration strings, four
template families. They are not 32 independent real-contract reliability trials.

**Both adapters failed the complete predeclared release gates. Neither replaces
27B as contract reviewer. More training data did not establish a better overall
system in this run; this is not proof that smaller data is intrinsically better.**

## Data QA discovery, not hidden model blame

Post-test source review found that the exception question did not explicitly
exclude payment prerequisites, although the constructed reference tracked only
the explicit withholding-exception slot. Potentially underspecified exception QA:
90/120 train, 6/8 dev, 24/32 test. In the forbidden-reference subset the full model
returned nonempty answers on 9/16; all nine quote alternative prerequisites.
These are **not nine established negation/legal errors**. Original scores, inputs
and outputs remain unchanged; no disputed examples were dropped or relabelled to
inflate results. Clarify the task and independently adjudicate new references
before the next experiment. Chinese scores are not independent legal accuracy.

Old R2's 334 examples were not reused: different risk-classification labels,
weak negatives and previously exposed evaluation. Public English human spans and
Chinese controlled values were added for a new extraction task. Every window/Q
candidate decision and source question scope is preserved. Budget exclusions,
out-of-task categories, duplicates, cross-boundary spans and length exclusions
are separate reasons. No loss-based data pruning occurred.

## Evidence and limits

23 mechanical data checks, seven protocol tests, three diagnostic-parser tests,
623 deterministic delivery/readback assertions passed; these counts are **not**
legal test cases or independent QA acceptance. Actual train/dev loss PNG/SVG,
per-update logs, raw outputs, frozen hashes, decisions, representative Q/A and all
mismatches are retained in a local standalone report. Report canvas typechecks
against the bundled SDK. No new 27B comparison or whole-contract Gold evaluation.

Public source: [CUAD](https://www.atticusprojectai.org/cuad/), CC BY 4.0,
[paper](https://arxiv.org/abs/2103.06268). Chinese samples are authored synthetic,
not independently adjudicated legal Gold. One training seed, narrow categories,
short windows, overlapping value vocabulary, possible public-benchmark base-model
pretraining exposure and disputed reference scope prevent broad reliability claims.

See `README.md` for reproduction order and `RESULTS.json` for desensitized metrics.
Model weights, datasets, raw requests/predictions and machine runtime stay local.
