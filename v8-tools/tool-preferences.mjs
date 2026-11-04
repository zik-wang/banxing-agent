export function preferredDocumentTools(assets,factProfile){
 const common=['read_json_range','save_draft','export_document','read_text_range','read_source_records','export_source_records','apply_patch_copy','read_artifact','validate_artifact'];
 // Printed-field/expiry extraction keeps its registered fact tools first.
 if(factProfile==='expiry')return [...new Set(['read_source_records','export_source_records',...common])];
 // Ordinary PDF analysis starts with bounded page reads/search, not all-page records.
 if(assets.some(a=>a.kind==='pdf'))return [...new Set(['extract_pdf_text','search_document','read_text_range','save_draft','export_document',...common])];
 return common;
}
