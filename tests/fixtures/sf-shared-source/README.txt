Source-only fixture for reproducible SF integration tests.

sf-turn.mjs, siliconflow-queue.mjs, core.mjs and control.mjs are unmodified
source snapshots of the existing shared coordinator/client implementation.
source-identity.json pins UTF-8 source with CRLF normalized to LF, and retains
raw captured byte hashes separately. No production runtime files or real
credentials are included. config.json is a minimal synthetic test config.

The integration test sets independent BOARD_DATA and BOARD_PORT values before
loading these modules. init() creates fresh test-only coordinator credentials
in that isolated data directory; these are never printed or committed.
Only worker IDs worker-02 and worker-03 in this independent test board are used;
they do not report for or change either real work window's production identity.

No supervisor config, chat binding or acceptance state is provided. Functions
that manage real threads or user acceptance are not invoked by the tests.
Production queue files, request histories and credentials are not copied.
