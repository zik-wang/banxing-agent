import path from 'node:path';
import {ToolError} from './harness.mjs';
const textTypes=new Set(['.txt','.md','.markdown','.json','.jsonl','.py','.csv','.tsv','.log','.yaml','.yml','.xml','.html','.css','.js','.mjs','.ts','.sql','.ini','.toml']);
export function classifyFile(name,bytes){
 const ext=path.extname(name).toLowerCase();
 if(bytes.subarray(0,5).toString()==='%PDF-')return {kind:'pdf',suggestedTools:['extract_pdf_text','render_pdf_page']};
 if(ext==='.xlsx')return {kind:'workbook',suggestedTools:['read_workbook']};
 if(textTypes.has(ext))return {kind:'text',format:ext.slice(1),suggestedTools:['read_text_range','search_document',...(ext==='.json'?['read_json_range']:[])]};
 if(['.m4a','.mp3','.wav','.flac','.ogg','.aac','.opus','.mp4','.webm'].includes(ext))return {kind:'audio',format:ext.slice(1),suggestedTools:['inspect_media','split_audio','transcribe_audio']};
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216||['.png','.jpg','.jpeg','.gif','.webp','.bmp','.tif','.tiff'].includes(ext))return {kind:'image',suggestedTools:['vision_extract','split_image']};
 return {kind:'unsupported',format:ext.slice(1)||'unknown',suggestedTools:[]};
}
export function decodeSource(bytes){
 let encoding='utf-8',prefixBytes=0,data=bytes;
 if(bytes[0]===255&&bytes[1]===254){encoding='utf-16le';prefixBytes=2;data=bytes.subarray(2);}
 else if(bytes[0]===254&&bytes[1]===255){encoding='utf-16be';prefixBytes=2;data=bytes.subarray(2);}
 else if(bytes.subarray(0,3).equals(Buffer.from([239,187,191]))){prefixBytes=3;data=bytes.subarray(3);}
 try{const text=new TextDecoder(encoding,{fatal:true}).decode(data);if(text.includes('\0'))throw Error('NUL in text');return{text,encoding,prefixBytes,offsetUnit:'utf16_code_units'};}
 catch{throw new ToolError('TEXT_ENCODING_UNSUPPORTED','Text must be valid UTF-8 or BOM-marked UTF-16; original bytes were not replaced.',{encoding,action:'Provide the original encoding or an authorized conversion copy.'});}
}
