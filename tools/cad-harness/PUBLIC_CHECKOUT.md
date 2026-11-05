# CAD Harness code checkout

This checkout contains the declarative CAD compiler, entity-based validation, bounded DeepSeek runner, synthetic tests, and a sanitized progress note. It does not contain original drawings, company documents, model requests or responses, credentials, generated CAD, or local progress-board state.

Use Python 3.11 or later and install the dependencies from `requirements-tested.txt`. Run the offline suite with:

```powershell
python test.py
```

The local original-drawing regression runs only when its authorized fixture is present. A public code checkout reports that test as **skipped**, rather than publishing the fixture or counting it as passed. All other tests use synthetic data or mocked provider responses. Offline tests do not call a paid model.

The reusable `cad_harness.module_audit.audit_modules(path)` reads the actual functional-view DXF entities. It requires closed module boundaries, a valid diagram boundary, three non-overlapping modules in order, and two real connection lines whose endpoints meet the corresponding ports. The current topology is deliberately fixed to a three-module smoke test; it does not demonstrate general understanding of arbitrary module specifications.

Runtime jobs and confidential source files must be prepared locally with the appropriate authorization. The provider uses `deepseek-flash` at the existing DeepSeek Chat Completions endpoint and reads authentication from the process environment. Never put credentials in a job, source file, command record, or commit. A missing authentication environment is a service/configuration blocker, not a geometry result.

Model output is a JSON plan. The local compiler produces editable DXF, then the checker reopens its entities. A model JSON response or a DXF that opens successfully is not sufficient to establish correct dimensions, angles, counts, topology, or complete drawing coverage. `CHECKS_PASS_SCOPE_LIMITED` is not manufacturing acceptance, and worker completion is not user acceptance.

The previously used ten drawings were a development set with external numerical feedback and changing coverage. Their repaired scores are not an independent blind-test result. A later explicit authorization replaces the deferred new-ten plan with twenty additional synthetic development cases; these are also not an independent holdout.

`batch20.py` prepares four geometry families with five variations each, PNG/SVG originals, separate functional briefs, and frozen reference fingerprints. Only PNG and the functional brief are sent to DeepSeek; contracts and reference plans stay in the validator. Each case may consume one HTTP attempt, with twenty attempts maximum and no transport or repair retries. A durable attempt reservation and exclusive batch lock prevent replay after uncertain failures. Authentication, model mismatch, first-case format failure, HTTP 429, uncertain transport, pause, or the authorized deadline stops the batch. The original legacy runner retains its own repair policy; the new batch does not use it for model calls.

`cad_mcp.py` is an actual local stdio MCP server with initialization and tool discovery. `cad_mcp_client.py` drives it from the batch host. Its three tools are `cad_batch_status`, `cad_verify_candidate`, and `cad_run_next`. They have no shell tool, arbitrary path reader, endpoint switch, credential-file loader, or upload capability. The tool server must inherit authentication securely from its original authorized parent; never include a secret in MCP configuration or messages. JSON plans compile locally to editable DXF; DeepSeek does not natively return DXF and has not been shown autonomously calling these tools. The host orchestrates MCP within the one-request-per-case limit.

The host-defined graph validator supports three to five rectangular modules and serial or branching connections. It checks actual closed boundaries, containment, non-overlap, exact module/connection counts, and real line endpoints on source/target ports. Synthetic source-truth checks also compare actual DXF boundaries and projection lines. These checks cover this authored corpus, not arbitrary engineering semantics.

Example commands (provide local paths; generated materials are excluded from version control):

```powershell
python batch20.py prepare --batch <local-batch-directory> --control <authorized-control.mjs> --node <node-executable>
python batch20.py offline-check --batch <local-batch-directory> --control <authorized-control.mjs> --node <node-executable>
python batch20.py run --batch <local-batch-directory> --control <authorized-control.mjs> --node <node-executable>
python cad_mcp.py --batch <local-batch-directory> --control <authorized-control.mjs> --node <node-executable>
```

The dated twenty-case runner is limited to its recorded batch authorization and deadline; it does not grant ongoing paid-call authority. Non-SiliconFlow `api.deepseek.com` requests do not occupy a SiliconFlow slot. This code deliberately cannot silently switch to SiliconFlow or another model.

`build_review_page.py --output <historical-output-directory> --benchmark <historical-benchmark-directory>` creates a local three-column original/first/final viewer from retained artifacts. It requires real renders for existing baseline DXFs and displays the absence of a valid baseline CAD as a failure. It never edits scores or copies a later output into the baseline position. Historical materials and the built page are not part of the public code checkout.
