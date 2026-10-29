# Word and pasted material inputs

V8 accepts `.docx` originals through uploads and the shared workspace. `read_word_document` exposes a paginated OOXML text projection with the original file SHA256 and projected character spans. It preserves body paragraph/table order, text in nested table cells, hyperlinks, headers, footers, notes, and comments. Tracked changes are marked; images, embedded objects, page layout, and field recalculation remain explicitly outside the text reader's verified scope. The original package is retained unchanged. Reading XML never executes a document or fetches external relationships.

Substantial pasted messages are retained as exact UTF-8 originals for the current turn. A clear short task at the beginning or end becomes the task prompt; the complete original remains readable with `read_text_range`. New pasted material is not silently replaced by unrelated files or an earlier result. An explicit reference to the previous result keeps that result available. Input is bounded at 240,000 UTF-16 code units.

Older failed tasks also recover their immutable original pasted message during a retry. This supplies the original message as input; it does not replay completed tool effects. Empty workspace searches, including variants of the same search, do not count as fresh business progress and cannot consume every planning round unchecked.

Run the input regression with a Python runtime configured for the existing local conversion worker:

```powershell
$env:V8_PYTHON = 'path/to/python.exe'
node --test tests/v8-word-input.test.mjs
```

The tests cover real local DOCX text extraction, ordering, pagination, Unicode, unread scope, malformed packages, XML entities, exact pasted originals, HTTP input scope, and empty-search termination. Model outputs still require task-specific acceptance; successful parsing does not certify a contract's business or legal correctness.
