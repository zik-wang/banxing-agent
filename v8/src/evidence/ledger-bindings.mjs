// Only resolve roles the user named explicitly; ambiguity remains an error.
export function resolveLedgerBindings(files,request,options){
 const result={...options},xlsx=files.filter(f=>f.extension==='.xlsx');
 if(!result.templateId){const m=String(request).match(/(?:使用|以|用)\s*[「“"']?([^\n，,」”"']+?)[」”"']?\s*(?:作为|当作|为)\s*(?:原|历史)?台账/);if(m){const name=m[1].trim(),hits=xlsx.filter(f=>f.name===name||f.name.replace(/\.xlsx$/i,'')===name);if(hits.length===1)result.templateId=hits[0].id;}}
 const baseline=xlsx.find(f=>f.id===result.templateId);
 if(baseline&&!result.dedupeColumns){const m=String(request).match(/去重(?:键|字段|列)(?:建议)?\s*[:：]\s*([^\n。；;]+)/),rows=String(baseline.content||'').match(/^1:\s*(.+)$/gm);if(m&&rows?.length===1){const headers=rows[0].replace(/^1:\s*/,'').split(' | ').map(s=>s.trim()),labels=m[1].replace(/[（(][^）)]*[）)]/g,'').split(/\s*[+＋,，]\s*/).filter(Boolean),aliases={供应商:/^(?:供应商|中标人|中标供应商|成交供应商|成交人)$/,中标金额:/^(?:中标金额|成交金额)(?:_元|[（(].*?[）)])?$/};const resolved=labels.map(l=>{const hits=headers.filter(h=>h===l||aliases[l]?.test(h));return hits.length===1?hits[0]:null;});if(resolved.length&&resolved.every(Boolean))result.dedupeColumns=[...new Set(resolved)].join(',');}}
 return result;
}
