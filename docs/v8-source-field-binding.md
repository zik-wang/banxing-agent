# Quote-bound source fields

`bind_source_fields` locates original quote, label and value spans on explicit physical pages when automatic colon-based field parsing misses a layout. Only whitespace differences are accepted. Changed abbreviations, and/ampersands, punctuation, missing quotes and ambiguous repeated matches fail. A batch registers no fields until every field validates. Original source hashes and UTF-16 character spans remain attached.

`export_source_records layout=field_rows` exports a readable per-field checklist: optional interpreted display label, original label, original value, page/span, full quote and unresolved relationship status. Original unstructured material remains in a separate sheet. Locating substrings does not prove the semantic relationship, supplier role, payment status or which deadline corresponds to which service. Models must still judge those relationships from appropriate source evidence or mark them unresolved.

Excel normalizes CR/CRLF display line breaks to LF; original strings remain in the source evidence and transformation sidecar. This prevents false saved-file mismatch for multiline PDF quotes.

Validated with targeted tests and direct tools on the real public invoice. Three quoted fields were exported and reopened successfully. This is not an automatic end-to-end scenario pass. This extension is a subsequent candidate; production PDF/Bot release remains independently identified.
