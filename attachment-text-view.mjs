import {readOriginal,digest} from './workspace-files.mjs';
export const TEXT_PAGE_CHARS=16000;
export function attachmentTextView(store,file){
 let text=file.content||'',projection=null;
 if(['.txt','.md','.json','.csv','.log','.eml','.ics'].includes(file.extension)){
  const bytes=readOriginal(store,file);if(bytes.length>2*1024*1024)throw Error('正文超过本轮2MB读取边界，原件保留，需明确分段处理');text=bytes.toString('utf8').replace(/^\uFEFF/,'');
  if(file.extension==='.json'){try{const data=JSON.parse(text);if(Array.isArray(data)&&data.length&&data.every(x=>x&&typeof x==='object'&&typeof x.tag_name==='string'&&typeof x.body==='string')){text=JSON.stringify(data.map(x=>({tag_name:x.tag_name,name:x.name,published_at:x.published_at,prerelease:x.prerelease,draft:x.draft,html_url:x.html_url,body:x.body})),null,2);projection={kind:'release_content',records:data.length,preserved:['tag_name','name','published_at','prerelease','draft','html_url','body'],omitted:'API transport metadata, asset download metadata; all release bodies retained'};}}catch(error){if(projection)throw error;}}
 }
 return {text,projection,viewSha256:digest(Buffer.from(text)),originalSha256:file.sha256,sourceTruncated:!!file.truncated&& !['.txt','.md','.json','.csv','.log','.eml','.ics'].includes(file.extension)};
}
