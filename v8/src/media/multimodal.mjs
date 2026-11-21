import {readJson} from '../integrations/intranet.mjs';
import {readOriginal} from '../workspace/workspace-files.mjs';
export function capability(harness,kind){const c=harness.directory.capabilities?.find(c=>c.kind===kind&&c.ready);if(!c)throw Error('内网'+kind+'服务尚未就绪');return c;}
export async function readBinary(response,max=25*1024*1024){if(!response.ok)throw Error('内网服务 HTTP '+response.status);let size=0,parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('输出超过大小上限');parts.push(chunk);}if(!size)throw Error('接口返回空文件');return {bytes:Buffer.concat(parts),type:response.headers.get('content-type')||''};}
export async function synthesize(harness,text,signal){
 if(typeof text!=='string'||!text.trim()||text.length>1200)throw Error('朗读文字需1–1200字');const c=capability(harness,'tts'),speakers=await readJson(await fetch(c.baseUrl+'/speakers',{signal,redirect:'error'}));const speaker=speakers.speakers?.[0];if(typeof speaker!=='string')throw Error('没有可用音色');
 const cached=speaker.startsWith('cache_'),body=new URLSearchParams({tts_text:text,[cached?'voice_id':'spk_id']:speaker,stream:'false',speed:'1'});const result=await readBinary(await fetch(c.baseUrl+(cached?'/inference_zero_shot_by_voice':'/inference_sft'),{method:'POST',body,signal,redirect:'error'}));
 // CosyVoice may return raw signed 16-bit PCM, documented by this service's schema.
 if(result.bytes.toString('ascii',0,4)==='RIFF')return result.bytes;
 if(!result.type.includes('audio')&&!result.type.includes('octet-stream'))throw Error('语音接口未返回音频');if(result.bytes.length%2)throw Error('PCM音频长度无效');
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+result.bytes.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(result.bytes.length,40);return Buffer.concat([header,result.bytes]);
}
export async function convertFile(harness,store,file,format,signal){
 if(!['pdf','docx','txt','xlsx','csv','png'].includes(format))throw Error('不支持的转换格式');if(!['.docx','.xlsx','.pdf','.txt','.md','.csv'].includes(file.extension))throw Error('此原件格式暂不支持转换');const c=capability(harness,'convert'),form=new FormData();form.append('file',new Blob([readOriginal(store,file)]),file.name);
 return (await readBinary(await fetch(c.baseUrl+'/convert/'+format,{method:'POST',body:form,signal,redirect:'error'}))).bytes;
}
export async function embed(harness,texts,signal){
 const c=capability(harness,'multimodalEmbedding');const result=await readJson(await fetch(c.baseUrl+'/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:c.model,input:texts}),signal,redirect:'error'}),8*1024*1024);
 const data=result.data?.slice().sort((a,b)=>a.index-b.index).map(d=>d.embedding);if(!data||data.length!==texts.length||data.some(v=>!Array.isArray(v)||!v.length||v.some(x=>!Number.isFinite(x))))throw Error('向量接口返回格式无效');return data;
}
export async function rerank(harness,query,documents,signal){const c=capability(harness,'reranker');const result=await readJson(await fetch(c.baseUrl+'/v1/rerank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:c.model,query,documents,top_n:5}),signal,redirect:'error'}));if(!Array.isArray(result.results))throw Error('重排序接口格式无效');return result.results;}
