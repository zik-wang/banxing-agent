# Bots, Skills and proactive tasks

The sidebar selects a general, finance, review, or user-created Bot. Advanced settings contain editable Bot policies and versioned Skills. Each submitted turn snapshots the selected Bot and Skills; later edits affect future turns. Preferred tools are bounded selections from the existing host registry, never new permissions. Metrics report actual model/tool requests and elapsed time, not a claimed causal speed improvement.

Advanced settings also contain opt-in reminders and delegated work. Reminders create unread conversations with host-authored text and zero model requests. Delegated work creates a conversation and uses the regular runner with pinned authorized input revisions. Tasks persist across restarts; overdue recurring events coalesce to one event, and dispatches have persistent execution keys. Work waits while another task is active. There are no default enabled schedules, external messages, or parallel model workers. Proactive work cannot recursively create schedules.

The read-only intranet health tool probes fixed operator-configured chat/vision and registered ASR endpoints. HTTP/readiness receipts do not prove output quality. GPU/disk metrics and service restarts are not supported.

Validation: 100 tests passed and 2 dependency/sandbox checks skipped. Real browser checks created a custom Bot and Skill, verified version 1 and version 2 model replies after reload, and observed clock-triggered reminder/work conversations with the browser closed. Scenario acceptance is separately recorded against real inputs; successful execution alone is not a scenario pass.
