import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,digest} from '../v8-tools/resource-space.mjs';
import {safeName} from '../v8-tools/managed-workspace.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const excluded=new Set(['node_modules','venv','.venv','__pycache__','dist','build']);
const media=new Set(['.mp3','.wav','.m4a','.flac','.ogg','.mp4','.aac']);
const supported=new Set(['.docx','.txt','.md','.json','.csv','.tsv','.log','.pdf','.xlsx','.png','.jpg','.jpeg','.webp','.py','.js','.mjs','.ts',...media]);
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const stamp=stat=>digest({bytes:stat.size,mtime:stat.mtimeMs,ino:String(stat.ino)});
export class FolderConnections{
 constructor(root){this.root=fs.realpathSync(root);const settings=path.join(this.root,'settings');fs.mkdirSync(settings,{recursive:true});this.file=path.join(settings,'folder-connections.json');if(!fs.existsSync(this.file))atomic(this.file,{schemaVersion:1,mounts:[]});}
 load(){const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.schemaVersion!==1)fail(409,'文件夹连接格式不受支持');return data;}
 list(botId){return this.load().mounts.filter(m=>m.botId===botId&&m.enabled);}
 get(botId,id){const mount=this.load().mounts.find(m=>m.id===id&&m.botId===botId&&m.enabled);if(!mount)fail(404,'此助理没有这个有效文件夹连接');let current;try{current=fs.realpathSync(mount.directory);}catch{fail(404,'已连接文件夹不存在或无法访问');}if(current!==mount.directory||!fs.statSync(current).isDirectory())fail(409,'文件夹位置已变化，请重新连接');return mount;}
 connect(botId,input){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(botId))fail(400,'无效助理ID');
  if(typeof input.directory!=='string'||!path.isAbsolute(input.directory)||input.directory.includes('\0'))fail(400,'请选择一个本机文件夹');
  let directory;try{directory=fs.realpathSync(input.directory);}catch{fail(404,'文件夹不存在或无法访问');}
  if(!fs.statSync(directory).isDirectory()||directory===path.parse(directory).root||path.basename(directory).startsWith('.')||inside(directory,this.root)||directory===this.root)fail(400,'请选择具体的资料文件夹，不要选择磁盘根目录、隐藏配置目录或整个运行工作区');
  if(!['local','public','synthetic'].includes(input.classification||'local'))fail(400,'请选择材料分类');
  if(input.writeResults!==undefined&&typeof input.writeResults!=='boolean')fail(400,'成果写入权限必须为布尔值');
  const state=this.load(),old=state.mounts.find(m=>m.botId===botId&&m.directory===directory);
  if(old&&input.expectedVersion!==undefined&&input.expectedVersion!==old.version)fail(409,'连接设置已变化，请刷新');
  const value={id:old?.id||randomUUID(),botId,directory,name:path.basename(directory),classification:input.classification||'local',writeResults:input.writeResults===true,enabled:true,version:(old?.version||0)+1,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(old)state.mounts[state.mounts.indexOf(old)]=value;else state.mounts.push(value);atomic(this.file,state);return value;
 }
 disconnect(botId,id){this.get(botId,id);const state=this.load(),m=state.mounts.find(m=>m.id===id&&m.botId===botId);m.enabled=false;m.version++;m.updatedAt=new Date().toISOString();atomic(this.file,state);return {disconnected:true,importedSnapshotsPreserved:true};}
 resolve(m,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\0')||relative.split(/[\\/]/).some(x=>x==='..'||x.startsWith('.'))||path.isAbsolute(relative)||/^[a-z]:/i.test(relative))fail(403,'文件路径不在已授权文件夹');
  const file=path.resolve(m.directory,...relative.split(/[\\/]/));if(!inside(m.directory,file))fail(403,'文件路径越界');
  let cursor=m.directory;for(const part of path.relative(m.directory,file).split(path.sep)){cursor=path.join(cursor,part);let info;try{info=fs.lstatSync(cursor);}catch{fail(404,'文件已移动或不存在');}if(info.isSymbolicLink())fail(403,'不跟随文件夹内的符号链接或目录联接');}
  const real=fs.realpathSync(file);if(!inside(m.directory,real))fail(403,'文件真实位置越界');return real;
 }
 entries(botId,id,{query='',cursor=0,limit=50}={}){
  const m=this.get(botId,id);if(typeof query!=='string'||query.length>200||!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)fail(400,'无效搜索或分页参数');
  const files=[],warnings=[],queue=[{folder:m.directory,depth:0}];let visited=0,symlinks=0,filtered=0;
  while(queue.length&&visited<5000){const {folder,depth}=queue.shift();let children;try{children=fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));}catch{warnings.push('无法读取：'+path.relative(m.directory,folder));continue;}
   for(const item of children){if(++visited>5000)break;if(item.name.startsWith('.')||excluded.has(item.name)||/\.private\.|\.(pem|key|safetensors|gguf|ckpt|pth)$/i.test(item.name)){filtered++;continue;}const file=path.join(folder,item.name);let st;try{st=fs.lstatSync(file);}catch{continue;}
    if(st.isSymbolicLink()){symlinks++;continue;}if(st.isDirectory()){if(depth<20)queue.push({folder:file,depth:depth+1});else warnings.push('子目录超过20层，未继续遍历');continue;}if(!st.isFile()||!supported.has(path.extname(file).toLowerCase())){filtered++;continue;}
    const relative=path.relative(m.directory,file).split(path.sep).join('/');if(query&&!relative.toLocaleLowerCase().includes(String(query).toLocaleLowerCase()))continue;
    files.push({relativePath:relative,name:item.name,bytes:st.size,modifiedAt:st.mtime.toISOString(),fingerprint:stamp(st),audioOrVideo:media.has(path.extname(file).toLowerCase())});
   }
  }
  files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath,'zh-CN'));return {mount:m,files:files.slice(cursor,cursor+limit),totalFound:files.length,nextCursor:cursor+limit<files.length?cursor+limit:null,scanComplete:queue.length===0&&visited<=5000&&warnings.length===0,visited,skippedLinks:symlinks,filtered,warnings};
 }
 read(botId,id,relative,{fingerprint,external=false}={}){
  const mount=this.get(botId,id);if(external&&!['public','synthetic'].includes(mount.classification))fail(403,'此连接仅供本机浏览。公网选用需明确将材料标为公开或合成');
  if(external&&media.has(path.extname(relative).toLowerCase()))fail(403,'录音和视频不通过此公网入口选用，请使用本地识别流程');
  const file=this.resolve(mount,relative),before=fs.statSync(file);if(!before.isFile())fail(400,'请选择文件');if(before.size<1||before.size>50*1024*1024)fail(413,'本次文件需为1字节至50MB');if(fingerprint&&stamp(before)!==fingerprint)fail(409,'文件已更新，请刷新后重新选用');
  if(!supported.has(path.extname(file).toLowerCase()))fail(415,'该格式不能加入对话');const bytes=fs.readFileSync(file),after=fs.statSync(file);if(stamp(before)!==stamp(after)||bytes.length!==after.size)fail(409,'读取期间文件发生变化，请重试');
  return {mount,name:path.basename(file),bytes,sha256:digest(bytes),relativePath:relative,fingerprint:stamp(after)};
 }
 saveArtifact(botId,id,record,verify){
  const mount=this.get(botId,id);if(!mount.writeResults)fail(403,'此连接未允许另存成果');verify();const bytes=fs.readFileSync(record.path);if(digest(bytes)!==record.sha256)fail(409,'成果内容已变化');
  const folder=path.join(mount.directory,'伴行成果');if(!fs.existsSync(folder))fs.mkdirSync(folder);if(fs.lstatSync(folder).isSymbolicLink()||fs.realpathSync(folder)!==folder)fail(403,'成果目录位置已变化，拒绝写入');
  const ext=path.extname(record.path),stem=safeName(path.basename(record.path,ext));
  for(let n=0;n<100;n++){const file=path.join(folder,stem+'-'+record.artifactId.slice(0,8)+(n?'-'+n:'')+ext);if(!inside(mount.directory,file))fail(403,'成果位置越界');if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink())continue;if(digest(fs.readFileSync(file))===record.sha256)return {saved:true,reused:true,path:file,sha256:record.sha256};continue;}
   fs.writeFileSync(file,bytes,{flag:'wx'});if(digest(fs.readFileSync(file))!==record.sha256)fail(500,'另存后校验失败');return {saved:true,reused:false,path:file,sha256:record.sha256};
  }fail(409,'同名成果过多，请整理目标目录后重试');
 }
}
