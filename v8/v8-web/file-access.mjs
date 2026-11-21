import fs from 'node:fs/promises';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
const checkAbort=signal=>{if(signal?.aborted)throw fail(499,'请求已取消');};
const hash=async b=>Buffer.from(await webcrypto.subtle.digest('SHA-256',b)).toString('hex');
export class BoundedFileAccess {
 constructor({concurrency=4,maxQueued=16}={}){this.concurrency=concurrency;this.maxQueued=maxQueued;this.active=0;this.queue=[];}
 run(fn,signal){
  checkAbort(signal);
  if(this.active>=this.concurrency&&this.queue.length>=this.maxQueued)return Promise.reject(fail(503,'文件读取繁忙，请稍后重试'));
  return new Promise((resolve,reject)=>{
   const item={start:()=>{signal?.removeEventListener('abort',abort);this.active++;Promise.resolve().then(()=>{checkAbort(signal);return fn();}).then(resolve,reject).finally(()=>{this.active--;this.queue.shift()?.start();});}};
   const abort=()=>{const at=this.queue.indexOf(item);if(at>=0){this.queue.splice(at,1);reject(fail(499,'请求已取消'));}};
   if(this.active<this.concurrency)item.start();else{this.queue.push(item);signal?.addEventListener('abort',abort,{once:true});}
  });
 }
 async resource(space,projectId,resourceId,revisionId,signal){return this.run(async()=>{
  const s=space.load(),r=s.resources[resourceId];if(!r)throw fail(403,'资源不可用');const ids=Object.keys(r.revisions);if(!revisionId&&ids.length!==1)throw fail(409,'请明确文件版本');
  const ref={resourceId,revisionId:revisionId||ids[0]},v=space.check(projectId,ref,new Set(),s);
  const verify=async(file,root)=>{checkAbort(signal);const real=await fs.realpath(file);if(real!==file||!real.startsWith(root+path.sep))throw fail(403,'文件路径不在资源空间');const bytes=await fs.readFile(real,{signal});if(await hash(bytes)!==v.hash)throw fail(409,'文件内容已变化，无法交付');checkAbort(signal);return bytes;};
  if(v.metadata.managedPath)await verify(path.resolve(space.root,v.metadata.managedPath),space.root);
  const bytes=await verify(path.join(space.root,'blobs',v.hash),path.join(space.root,'blobs'));
  // A revoke/archive while I/O was in flight must take effect before any bytes leave the server.
  space.check(projectId,ref);checkAbort(signal);return {ref,version:v,bytes};
 },signal);}
}
