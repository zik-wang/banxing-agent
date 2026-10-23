import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export function acquireDataLease(directory){
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'.server.lock'),nonce=randomUUID();
 for(let i=0;i<2;i++){
  try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,nonce,startedAt:new Date().toISOString()}));fs.closeSync(fd);const release=()=>{try{const lock=JSON.parse(fs.readFileSync(file));if(lock.nonce===nonce)fs.unlinkSync(file);}catch{}};return {file,release};}
  catch(e){if(e.code!=='EEXIST')throw e;let lock;try{lock=JSON.parse(fs.readFileSync(file));}catch{throw Error('数据目录锁无法读取，请确认旧进程已退出后检查锁文件');}try{process.kill(lock.pid,0);}catch(error){if(error.code==='ESRCH'){fs.unlinkSync(file);continue;}throw Error('无法核实数据目录占用状态');}throw Error('数据目录正由进程 '+lock.pid+' 使用，不能启动第二个写入服务');}
 }
 throw Error('未能获得数据目录锁');
}
