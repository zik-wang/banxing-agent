# Adaptive tool and colleague execution

The generic web agent defaults to host-owned `executionPolicy.mode = adaptive`.
There is no fixed model-round, total tool-call, discovery-call, vision-call,
cumulative continuation-call, or whole-task duration budget in this mode.
`null` explicitly represents an unlimited limit in JSON. Counters remain real.
The model chooses tools, continues after a recoverable error, or returns an answer
or a missing-input explanation. The operator may stop the task at any time.
Individual network requests still time out and the transport still bounds retries.

## Colleagues are tools, not a finance-specific workflow

`request_assistant_handoff` delegates responsibility for the current task to an
enabled colleague discovered from the bot registry. It supports
`review_required` and `reviewer_bot_id`; omitted fields preserve the existing
return-to-origin review behavior. The model may work directly, skip a separate
review when unnecessary, or choose a different reviewer. User-requested review
must be respected in the model's plan.

A colleague can delegate again before business writes. Ancestors cannot become
workers again in the same chain, so A → B → A delegation loops are rejected.
Nested completion passes the actual worker result reference and review receipts
back up the chain. A review is read-only; `reviewed` records a completed review
process, and never sets `contentVerified` to true merely because bots agree.

Delegation still requires host-validated, currently authorized references. It
does not mount a colleague's unrelated folders, schedules or knowledge base.
Deleted or excluded sources stay excluded. Per-turn selection ancestry is
validated again when the delegation receipt is consumed. Local file outputs,
idempotency, schema validation and outbound approval checks retain their existing
authority. Cancelling also removes queued collaborators and cancels the whole
live route tree, while retaining unrelated queued user messages.

## Scope

This change covers the generic tools runtime and assistant collaboration. The
separate contract-review and explicit group-meeting operators keep their existing
protocols; neither is represented here as converted to a general adaptive agent.
Setting the host's `executionPolicy.mode` to `bounded` preserves generic runtime
limits for compatibility. Standalone CLI callers opt in with `adaptive`.

This is whole-task handoff, not parallel subtask fan-out. Business writes cannot
be replayed by handing off after they occur. Necessary data transformations are
still composed through registered tools. It does not claim that every task or
every bot choice is semantically correct.

## Acceptance

`tests/v8-adaptive-harness.test.mjs` covers continuation beyond former limits,
real resource ledger accounting, error feedback, cancellation, model-selected
review options, nested routing, ancestor exclusion and forged reference denial.
These are explicit offline policy fixtures, not real-model semantic evidence.
Real-model acceptance uses public procurement originals and independently reads
the actual Excel and Word outputs. Ordinary chat and a finance-owned merge also
exercise direct execution; no fixed Chinese trigger routes a task to finance.
