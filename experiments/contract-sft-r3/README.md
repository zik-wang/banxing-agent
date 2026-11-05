# Contract evidence SFT R3

Local Qwen2.5-1.5B-Instruct LoRA experiment. This directory contains executable
preparation/training/scoring/report code, not model weights or production changes.
It learns **bounded excerpt evidence extraction**, not final legal verdicts,
whole-contract completeness, OCR, or money arithmetic.

## Data contract

- Public CUAD, CC BY 4.0: https://www.atticusprojectai.org/cuad/ . Retain attribution,
  document IDs, original question IDs, source SHA256 and absolute source spans.
- Chinese data are explicitly labelled authored synthetic clauses. Their exact
  field oracle is mechanically checkable but is not independent legal annotation.
- Full training 1,200 QA: 480 Chinese, 720 English. Small ablation: a proportional
  300-QA subset. Development: 64. Test: 192, disjoint documents/template families.
- Fixed source windows, not answer-centered windows. Cross-boundary answers,
  overly long answers/examples and duplicates have explicit decisions. Budget
  exclusions are not labelled quality failures.
- Earlier R2 risk-classification examples are not reused. Earlier experiments
  remain immutable; this is a new task and cannot be compared as the same score.

## Execution order

1. Create a **new** output directory with `prepare.py`; never reuse a prior run.
   Its CLI accepts `--out`, `--cuad` and `--base` (see `--help`). Freeze its four
   JSONL data files, system prompt, generation, seed and release gates.
2. `finalize.py` is the exact one-off pre-training seal for the worker-02 local
   run; its `ROOT` and source paths intentionally describe the preserved run.
   For another machine/run, adapt paths in a *new* seal script before training,
   then preserve that executed script and its hash. Do not rerun it in a completed
   output directory or overwrite the original `executed-code`/freeze files.
3. In the local environment, run `python -m unittest test_protocol -v` from this
   directory. Data QA reconstructs original human spans and checks split isolation.
4. Run the frozen `executed-code/train.py --root <new-output> --base <local-base>`.
   No network downloads or API calls; requires CUDA and ~4.5 GiB initially free.
   The script checks the existing user pause/deadline control, plus a `STOP` file
   in the output directory. It bounds each arm to 600 updates/one hour and the
   whole run to three hours.
5. Run `audit_dataset.py --root ... --cuad <CUADv1.json> --previous <preserved-v0>
   --r2 <old-R2-directory>` once for version/decision auditing. It does not change
   data or labels. This historical audit needs the preserved local earlier builds;
   it is not required to train a new independent experiment.
6. After `final-results.json` exists, run `report.py --root ... --plot-deps
   <isolated-matplotlib-install>`; it recomputes scores/input hashes/selected-row
   coverage, and creates actual PNG/SVG loss plots, error examples and a standalone
   HTML report. `canvas_report.py --root ... --target <managed-canvas-path>` creates
   an optional single-file local analytical viewer.

Dependencies for the actual run: Python 3.12 environment, torch 2.6.0+cu124,
transformers 4.56.2, peft 0.17.1, safetensors. See each run's
`dependency-versions.json` for the full installation. Scientific plots use a
separate matplotlib installation and the Windows Microsoft YaHei font.

## What is preserved

Every optimizer update stores its four real sample IDs/losses/token counts,
gradient norm and learning rate. Every 100 updates stores teacher-forced dev loss,
actual dev generations and an adapter checkpoint. Selection uses only dev
corpus-macro exact-answer-set F1 (loss only breaks ties), after all training rows
have been seen. Both selected weights are sealed before any test generation.

Baseline, small and full arms share identical test prompts, strict parsing and
greedy generation. Every returned string, input digest, finish condition and
latency is recorded. Invalid JSON is not silently counted as a correct empty
answer. Source-copy validity and semantic exact match are separate.
Different span boundaries count as mismatches even when their meanings might be
acceptable. These are strict evidence-extraction scores, not counts of proven
legal mistakes; inspect the preserved examples before interpreting each mismatch.

No loss number itself proves reliability. Frozen release gates are reported
including failures. Synthetic family/document cluster intervals do not cover
training-seed variance, unseen legal domains, or public-benchmark pretraining
contamination (which cannot be ruled out here).

The two data sizes have the same **maximum** update budget, but validation-based
selection/early stopping can produce different actual compute and repeat counts.
This is not a perfectly compute-matched causal study.

## Git and production boundary

The post-test `diagnostic_format.py` applies the same reversible array/fence
compatibility rule to all groups and labels its scores as post-hoc diagnostics;
it does not replace the strict pre-registered scores. Its three focused tests
prove answer characters are not repaired or silently discarded.

`audit_reference_ambiguity.py` flags a separate data-definition problem found
after inspecting errors: the exception question did not clearly exclude payment
prerequisites. In this run, all nine nonempty outputs against forbidden-exception
references quote alternative prerequisites, not the forbidden cause itself.
These are not established negation mistakes. Frozen data and scores remain
unchanged; the report preserves flagged IDs and does not drop them to inflate
performance. Clarify task scope and independently adjudicate references before
using these examples in another training run.

Only generic code, synthetic tests and a desensitized result summary belong in
Git. Adapters, base weights, raw datasets/predictions, environments and local
runtime state remain in local `qa-output`. Do not deploy or change the live 8884
service as part of this experiment. No result is user or independent-QA acceptance.
