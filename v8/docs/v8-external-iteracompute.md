# External IteraCompute workspace

The optional `iteracompute` provider uses `https://api.iteracompute.com/v1` and `qwen/qwen3.8-27b`, the documented Chat Completions tool protocol, and `chat_template_kwargs.enable_thinking=false`. Credentials are loaded from a host-side ignored JSON secret file (`apiKeyFile`), never the browser or Git. A distinct `external-iteracompute` workspace is required. Attempting to reuse an existing internal data root without the external marker fails before migration.

New inputs are classified `external_authorized`, not `public`. Existing private/internal resource grants are still rejected for cloud dispatch. Internal history, Bots, Skills, files, reminders and knowledge are not migrated automatically. The visible external-mode notice explains that new messages and selected content reach the third-party provider. Local file storage, tools, queued messages and branches remain local. This does not imply zero retention by the provider.

Local text/Word/PDF-text readers, workbook processing, knowledge indexing, Word/XLSX generation and local image/PDF-copy conversion remain available. Intranet service inspection and ASR transcription are absent from the external tool registry. Office-to-PDF fails immediately with an explicit unavailable error, instead of trying company endpoints. Visual reading uses the external model only when configured after an actual image test.

Provider free capacity may queue and is not a latency guarantee. Actual initial checks returned text and a complete tool-call round trip; image verification recognized a generated five-digit number and square colour. Paid top-up is not required by this implementation. HTTP errors preserve task state and are not disguised as successful generation.
