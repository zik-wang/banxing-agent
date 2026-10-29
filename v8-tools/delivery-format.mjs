import path from 'node:path';
export function requestedFormats(request=''){
 const result=new Set(),formats=[['docx',/\bword\b|\bdocx\b|\.docx\b/ig],['xlsx',/\bexcel\b|\bxlsx\b|\.xlsx\b/ig],['pdf',/\bpdf\b/ig],['md',/\bmarkdown\b|\bmd\b/ig],['txt',/\btxt\b/ig],['srt',/\bsrt\b/ig],['pptx',/\bpptx?\b|powerpoint/ig],['csv',/\bcsv\b/ig],['rtf',/\brtf\b/ig]];
 for(const clause of request.split(/[，,。；;\n]/))for(const [format,re] of formats){for(const m of clause.matchAll(re)){const before=clause.slice(0,m.index);if(/(?:不要|不用|无需|不需要|别).{0,12}$/u.test(before))continue;if(/(?:转成|转为|转换|导出|生成|做成|输出|给我|提供|需要|我要|要).{0,30}$/u.test(before)||clause.trim().toLowerCase()===m[0].toLowerCase())result.add(format);}}
 return [...result];
}
export function checkRequestedFormats(cards,formats=[],initialIds=new Set(),allowExisting=false){const current=cards.filter(a=>allowExisting||!initialIds.has(a.artifactId));const missing=formats.filter(f=>!current.some(a=>path.extname(a.path).toLowerCase()==='.'+f));return {requested:formats,missing,satisfied:missing.length===0};}
