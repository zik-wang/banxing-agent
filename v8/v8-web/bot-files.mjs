import fs from 'node:fs';import path from 'node:path';import {digest} from '../v8-tools/resource-space.mjs';import {safeName} from '../v8-tools/managed-workspace.mjs';
export class BotFiles{
 constructor(root){this.root=fs.realpathSync(root);this.directory=path.join(this.root,'bot-files');this.ensure(this.directory);}
 ensure(folder){fs.mkdirSync(folder,{recursive:true});const real=fs.realpathSync(folder),relative=path.relative(this.root,real);if(real!==path.resolve(folder)||!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Bot目录不在当前工作空间');return real;}
 folder(id){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效Bot ID');const folder=this.ensure(path.join(this.directory,id));for(const n of ['原件','成果'])this.ensure(path.join(folder,n));return folder;}
 write(botId,kind,id,name,bytes){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效文件ID');const folder=this.ensure(path.join(this.folder(botId),kind,id)),file=path.join(folder,safeName(name));if(fs.existsSync(file)){if(fs.realpathSync(file)!==file||digest(fs.readFileSync(file))!==digest(bytes))throw Error('Bot目录中的文件已被修改，保留本地修改，不自动覆盖');}else fs.writeFileSync(file,bytes,{flag:'wx'});return file;}
 original(botId,ref,name,bytes){return this.write(botId,'原件',ref.resourceId,name,bytes);}
 artifact(botId,a,verify){verify();return {...a,path:this.write(botId,'成果',a.artifactId,path.basename(a.path),fs.readFileSync(a.path))};}
}
