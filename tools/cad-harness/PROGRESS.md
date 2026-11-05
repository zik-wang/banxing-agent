# CAD Harness progress

## Verified behavior

- Declarative JSON plans compile to editable millimetre DXF. Validation reopens saved entities and measures dimensions, boundaries, angles, holes, channels and connections.
- A real stdio MCP server exposes batch status, candidate verification and one-case generation. The batch host uses its MCP client; initialization, tool discovery and actual entity verification have been exercised in separate processes.
- A reference fixture passes the MCP verification tool; deleting a branch connection fails both the count and endpoint checks. These are authored fixtures, not DeepSeek outputs.
- Twenty new, distinct synthetic inputs are frozen: five variants each of groove carriers, stepped brackets, chamfered plates and breakout boxes. Each has a separate functional brief. Three-to-five-module serial and branch graphs are covered. PNG linework is drawn independently of the DXF compiler; numeric source truth remains outside the model request.
- The new batch allows one HTTP attempt per case and twenty total. Auth, model mismatch, first-case format failure, 429, uncertain transport, pause or deadline stops it. A geometry failure is retained while the next image proceeds, without repair feedback or retry. Durable reservations prevent uncertain calls being replayed.
- Full local validation: 86 tests passed, zero failures and zero skipped. Includes request-boundary controls, actual geometry/graph negative cases and stdio protocol checks. Test supplier responses are mocked; no paid calls are counted as tests.

## Historical evidence viewer

The local three-column page displays ten original public figures, eight real baseline CAD renders, two baseline compile-failure records, and ten final repaired outputs. The baseline renders were produced directly from retained baseline DXFs. Historical scores and CAD coordinates are unchanged. The page records first-pass 0/10 and assisted final 10/10 under the same finite v7 checks; it explicitly does not claim manufacturing acceptance. Browser checks cover all ten cases, image loading, modal open/Escape, and mobile overflow. Source drawings and built pages are not distributed in this code commit.

## Current blockers and limits

- The actual twenty-case MCP run stops before HTTP because the original authorized process has no DeepSeek authentication injection: prepared 20, submitted 0, returned 0, validated model outputs 0, not run 20. Payment authorization is present; payment is not the blocker. No credential files or other private chats are read.
- The endpoint remains the original api.deepseek.com endpoint and configured model deepseek-flash. It is not SiliconFlow and does not use a SiliconFlow slot. Current official documentation maps the alias to DeepSeek-V4.1-Flash-1017 and documents image/JSON support; this batch has no account-runtime response yet.
- DeepSeek has not been shown autonomously calling MCP tools. The local host orchestrates MCP; the model supplies a JSON plan and the compiler supplies DXF. No claim of native DXF model output is made.
- Synthetic cases and the earlier repaired development set do not establish independent generalization. Complete manufacturing acceptance and user acceptance are not performed.
- An explicit later request replaced the deferred new-ten plan with this twenty-case synthetic batch. It does not extend the recorded deadline or override pause/material permissions.
- No Git remote is configured in this checkout. Local commits and code snapshots do not establish a GitHub push.

## Distribution

Only an explicit allowlist of code, tests, requirements and sanitized notes is transferable. Drawings, generated CAD, reference plans, raw requests/responses, credentials, local board state, caches and unrelated changes are excluded. The original-material regression is skipped in a public checkout and is never counted as passed. Exact snapshot fingerprints and independent code-checkout results are retained in local handoff evidence.
