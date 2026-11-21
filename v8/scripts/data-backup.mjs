import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const [mode,rawSource,rawDestination]=process.argv.slice(2);if(!['backup','restore'].includes(mode)||!rawSource||!rawDestination)throw Error('用法：node scripts/data-backup.mjs backup|restore 源目录 空目标目录');
const source=path.resolve(rawSource),destination=path.resolve(rawDestination);if(source===destination||destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep))throw Error('源目录与目标目录必须彼此独立');
if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('目标目录必须为空，拒绝覆盖已有数据');
if(fs.existsSync(path.join(source,'.server.lock'))){const l=JSON.parse(fs.readFileSync(path.join(source,'.server.lock')));try{process.kill(l.pid,0);throw Error('请停止使用该数据目录的服务再备份');}catch(e){if(e.code!=='ESRCH')throw e;}}
const files=[];function walk(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('备份中不接受符号链接');const r=path.join(rel,e.name);if(e.isDirectory())walk(path.join(dir,e.name),r);else if(e.name!=='.server.lock'&&e.name!=='backup-manifest.json'){const bytes=fs.readFileSync(path.join(source,r));files.push({path:r.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}walk(source);
if(mode==='restore'){const manifest=JSON.parse(fs.readFileSync(path.join(source,'backup-manifest.json')));for(const f of manifest.files){const found=files.find(x=>x.path===f.path);if(!found||found.sha256!==f.sha256||found.bytes!==f.bytes)throw Error('备份文件校验失败：'+f.path);}if(manifest.files.length!==files.length)throw Error('备份包含未登记文件');}
JSON.parse(fs.readFileSync(path.join(source,'state.json')));fs.mkdirSync(destination,{recursive:true});
for(const f of files){const out=path.join(destination,f.path);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(source,f.path),out);}
if(mode==='backup')fs.writeFileSync(path.join(destination,'backup-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files},null,2));
console.log(JSON.stringify({mode,files:files.length,destination,verified:true}));
