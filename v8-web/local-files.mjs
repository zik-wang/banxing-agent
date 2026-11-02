import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {digest} from '../v8-tools/resource-space.mjs';
import {safeName} from '../v8-tools/managed-workspace.mjs';

const documentTypes=new Set(['.xlsx','.docx','.pdf','.txt','.md','.json','.csv','.tsv','.srt','.png','.jpg','.jpeg','.webp','.gif','.bmp','.mp3','.wav','.m4a','.mp4']);
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function nativeOpenLocalFile({path:file,action,sha256}){
 if(process.platform!=='win32')return Promise.reject(Error('当前系统尚未接入本地文件打开方式'));
 const script=fs.readFileSync(fileURLToPath(new URL('./open-local-file.ps1',import.meta.url)),'utf8');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 // Only this fixed script is code. File paths are Unicode environment data.
 return new Promise((resolve,reject)=>execFile(executable,['-NoProfile','-NonInteractive','-STA','-Command',script],{
  windowsHide:true,timeout:15000,maxBuffer:65536,
  env:{...process.env,BANXING_LOCAL_FILE:file,BANXING_LOCAL_ACTION:action,BANXING_LOCAL_SHA256:sha256}
 },error=>error?reject(Object.assign(Error('未能打开本地文件，请确认文件未被移走且系统已关联对应应用'),{status:409,cause:error})):resolve()));
}
export class LocalFileActions {
 constructor({root,space,managed,workspaceId,openLocalFile=nativeOpenLocalFile}){this.root=fs.realpathSync(root);this.space=space;this.managed=managed;this.workspaceId=workspaceId;this.openLocalFile=openLocalFile;}
 verify(file,sha256){
  if(!file||!/^([a-f0-9]{64})$/i.test(sha256||''))fail(409,'文件记录不完整');
  let real;try{real=fs.realpathSync(file);}catch{fail(404,'本地文件已移动或不存在');}
  const relative=path.relative(this.root,real);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||real!==path.resolve(file))fail(403,'文件路径不在当前工作空间');
  if(!fs.statSync(real).isFile())fail(409,'该记录不是文件');
  if(digest(fs.readFileSync(real))!==sha256)fail(409,'本地文件内容已变化，请重新核对');
  return real;
 }
 descriptor(record,file){return {id:record.artifactId||record.resourceId,name:record.name||path.basename(file||record.path),title:record.title||record.name||path.basename(file||record.path),path:file||null,sha256:record.sha256,available:true,canOpen:documentTypes.has(path.extname(file||record.name||'').toLowerCase())};}
 describeResource(resourceId,revisionId,snapshot){
  const ref={resourceId,revisionId},r=snapshot.resources[resourceId],v=this.space.check(this.workspaceId,ref,new Set(),snapshot);
  if(!['original','artifact'].includes(r.kind))fail(409,'该索引没有独立文件');
  const name=v.metadata.name||v.metadata.title||'file';
  const candidate=v.metadata.managedPath?path.resolve(this.space.root,v.metadata.managedPath):path.join(this.managed.directory,'local-files',resourceId,revisionId,safeName(name));
  let file=null;
  if(fs.existsSync(candidate)){
   const real=fs.realpathSync(candidate),relative=path.relative(this.root,real);
   if(real!==candidate||!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail(403,'文件路径不在当前工作空间');
   if(!fs.statSync(real).isFile())fail(409,'该记录不是文件');file=real;
  }
  if(v.metadata.managedPath&&!file)fail(404,'本地文件已移动或不存在');
  // Listing is metadata only. Opening/downloading still performs current ACL and full hash checks.
  return {...this.descriptor({resourceId,name,sha256:v.hash},file),canOpen:documentTypes.has(path.extname(name).toLowerCase()),ref,verification:'metadata_only',byteVerificationRequired:true};
 }
 artifact(record){
  const candidates=Object.entries(this.space.load().resources).filter(([,r])=>r.kind==='artifact').flatMap(([resourceId,r])=>Object.entries(r.revisions).filter(([,v])=>v.metadata.artifactId===record.artifactId).map(([revisionId])=>({resourceId,revisionId})));
  if(candidates.length&&!candidates.some(ref=>{try{return this.space.check(this.workspaceId,ref).hash===record.sha256&&digest(this.space.read(this.workspaceId,ref))===record.sha256;}catch{return false;}}))fail(403,'文件资源已归档、撤权或来源不可用');
  return this.descriptor(record,this.verify(record.path,record.sha256));
 }
 resource(resourceId,revisionId,{materialize=false}={}){
  const ref=this.managed.ref(resourceId,revisionId),resource=this.space.load().resources[resourceId],version=this.space.check(this.workspaceId,ref);
  if(!['original','artifact'].includes(resource.kind))fail(409,'这条记录是处理结果索引，没有独立本地文件');
  const bytes=this.space.read(this.workspaceId,ref),name=version.metadata.name||version.metadata.title||'file';
  let file;
  if(version.metadata.managedPath)file=this.verify(path.resolve(this.space.root,version.metadata.managedPath),version.hash);
  else{
   const folder=path.join(this.managed.directory,'local-files',resourceId,ref.revisionId),candidate=path.join(folder,safeName(name));
   if(materialize){
    fs.mkdirSync(folder,{recursive:true});
    if(fs.realpathSync(folder)!==folder)fail(403,'本地文件目录已变化');
    if(!fs.existsSync(candidate))fs.writeFileSync(candidate,bytes,{flag:'wx'});
   }
   if(fs.existsSync(candidate))file=this.verify(candidate,version.hash);
  }
  return {...this.descriptor({resourceId,name,sha256:version.hash},file),ref};
 }
 async perform(file,action){
  if(!['open','reveal'].includes(action))fail(400,'不支持的本地文件操作');
  const real=this.verify(file.path,file.sha256);
  if(action==='open'&&!documentTypes.has(path.extname(real).toLowerCase()))fail(409,'这类文件请在文件夹中查看');
  await this.openLocalFile({path:real,action,sha256:file.sha256});
  return {ok:true,action,path:real,message:action==='open'?'已请求本机应用打开文件':'已在文件夹中显示并选中文件'};
 }
}
