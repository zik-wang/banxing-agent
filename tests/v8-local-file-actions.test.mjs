import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createWebServer} from '../v8-web/server.mjs';
import {digest} from '../v8-tools/resource-space.mjs';

const temporaryParent=path.resolve('qa-output/local-file-actions-test-temp');
function temporary(t){
 fs.mkdirSync(temporaryParent,{recursive:true});
 const root=fs.mkdtempSync(path.join(temporaryParent,'case-'));
 t.after(()=>{assert(path.resolve(root).startsWith(temporaryParent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
async function setup(t,{openLocalFile}={}){
 const root=temporary(t),calls=[];
 const config={dataRoot:path.join(root,'data'),chat:{provider:'intranet',baseUrl:'http://10.0.0.32:8861/v1',model:'test'}};
 const {server,workspace}=createWebServer(config,{openLocalFile:openLocalFile||(async value=>{calls.push(value);})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port;
 const req=(url,options={})=>fetch(base+url,{...options,headers:{'X-V8-Client':'web',...options.headers}});
 return {root:config.dataRoot,parent:root,workspace,calls,base,req};
}
function output(x,{name='成果 中文 with spaces.txt',content='真实交付结果',hidden=false,filePath}={}){
 const c=x.workspace.newConversation(),turnId=randomUUID(),artifactId=randomUUID();
 const file=filePath||path.join(x.root,name);fs.writeFileSync(file,content);
 const record={artifactId,path:file,title:name,sha256:digest(Buffer.from(content)),readbackPassed:true,available:true,generation:'new_in_this_turn',role:'requested_output'};
 const directory=path.join(x.root,'runs',turnId);fs.mkdirSync(directory,{recursive:true});
 const t={id:turnId,directory,request:hidden?'我下载链接呢':'生成文件',status:'completed',createdAt:new Date().toISOString(),artifacts:hidden?[]:[record]};
 if(hidden)fs.writeFileSync(path.join(directory,'delivery-settlement.json'),JSON.stringify({verifiedArtifacts:[],otherVerifiedArtifacts:[record],outcome:'answered'}));
 x.workspace.conversation(c.id).turns.push(t);x.workspace.save();
 const url=`/api/conversations/${c.id}/turns/${turnId}/files/${artifactId}`;
 return {c,t,file,record,url};
}
function original(x,name='本地原件 with spaces.txt',bytes=Buffer.from('原件内容')){
 const c=x.workspace.newConversation();x.workspace.upload(c.id,name,bytes);
 const uploaded=x.workspace.conversation(c.id).files[0],ref=uploaded.ref;
 const version=x.workspace.space.check(x.workspace.workspaceId,ref);
 const file=path.resolve(x.workspace.space.root,version.metadata.managedPath);
 const url=`/api/workspace/resources/${ref.resourceId}`;
 return {c,ref,file,url,name};
}
async function rejectWithoutOpening(x,url,options={method:'POST'}){
 const before=x.calls.length,response=await x.req(url,options);
 assert(response.status>=400,`expected refusal, got ${response.status}: ${await response.text()}`);
 assert.equal(x.calls.length,before,'refused request must not invoke the native opener');
 return response;
}

test('file hyperlinks describe the actual local output; GET does not launch the native app',async t=>{
 const x=await setup(t),a=output(x);
 const view=await(await x.req('/api/conversations/'+a.c.id)).json();
 const local=view.turns[0].localFiles.find(f=>f.id===a.record.artifactId);
 assert(local,'the result has a local file hyperlink');
 assert.equal(local.path,fs.realpathSync(a.file));assert.equal(local.available,true);assert.equal(local.canOpen,true);
 assert.equal(local.openUrl,a.url+'/open');assert.equal(local.revealUrl,a.url+'/reveal');
 await rejectWithoutOpening(x,local.openUrl,{method:'GET'});
 await rejectWithoutOpening(x,local.revealUrl,{method:'GET'});
 assert.equal(x.calls.length,0);
});

test('POST open and reveal pass the exact Chinese and spaced path as data to the injected opener',async t=>{
 const x=await setup(t),a=output(x,{name:'A & B 中文 [结果] $path.txt'});
 for(const action of ['open','reveal']){
  const res=await x.req(a.url+'/'+action,{method:'POST'});assert.equal(res.status,200,await res.text());
 }
 assert.deepEqual(x.calls.map(({path:file,action})=>({path:file,action})),[
  {path:fs.realpathSync(a.file),action:'open'},{path:fs.realpathSync(a.file),action:'reveal'}]);
});

test('open and reveal require the same-origin UI mutation header',async t=>{
 const x=await setup(t),a=output(x),url=a.url+'/reveal';
 const noHeader=await fetch(x.base+url,{method:'POST'});assert.equal(noHeader.status,403);
 const foreign=await x.req(url,{method:'POST',headers:{Origin:'https://foreign.invalid'}});assert.equal(foreign.status,403);
 assert.equal(x.calls.length,0);
 assert.equal((await x.req(url,{method:'POST',headers:{Origin:x.base}})).status,200);
 assert.equal(x.calls.length,1);
});

test('client body and query paths cannot redirect a valid file action to another local file',async t=>{
 const x=await setup(t),a=output(x),outsider=path.join(x.parent,'outside-data-root.txt');fs.writeFileSync(outsider,'must never open');
 const res=await x.req(a.url+'/reveal?path='+encodeURIComponent(outsider),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:outsider,action:'open',command:'calc.exe'})});
 assert.equal(res.status,200,await res.text());
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].path,fs.realpathSync(a.file));assert.equal(x.calls[0].action,'reveal');
});

test('turn identity is required; another conversation and unknown artifact IDs cannot open the file',async t=>{
 const x=await setup(t),a=output(x),b=x.workspace.newConversation();
 await rejectWithoutOpening(x,a.url.replace(a.c.id,b.id)+'/open');
 await rejectWithoutOpening(x,a.url.replace(a.record.artifactId,randomUUID())+'/reveal');
 await x.req('/api/conversations/'+a.c.id,{method:'DELETE'});
 await rejectWithoutOpening(x,a.url+'/reveal');
});

test('changed, missing, directory and outside-root output paths are rejected before native launch',async t=>{
 const x=await setup(t),a=output(x);
 fs.appendFileSync(a.file,'tampered');await rejectWithoutOpening(x,a.url+'/open');
 fs.unlinkSync(a.file);await rejectWithoutOpening(x,a.url+'/reveal');
 fs.mkdirSync(a.file);await rejectWithoutOpening(x,a.url+'/reveal');
 const outsider=path.join(x.parent,'outside.txt'),b=output(x,{filePath:outsider});
 await rejectWithoutOpening(x,b.url+'/reveal');
});

test('source code is reveal-only and cannot execute through an open-file request',async t=>{
 const x=await setup(t),a=output(x,{name:'uploaded_source.py',content:'raise RuntimeError("must not execute")'});
 const view=await(await x.req('/api/conversations/'+a.c.id)).json();
 const local=view.turns[0].localFiles.find(f=>f.id===a.record.artifactId);assert.equal(local.canOpen,false);
 await rejectWithoutOpening(x,a.url+'/open');
 assert.equal((await x.req(a.url+'/reveal',{method:'POST'})).status,200);
 assert.deepEqual(x.calls.map(v=>v.action),['reveal']);
});

test('a filesystem junction cannot turn an outside-root file into an authorized local link',async t=>{
 const x=await setup(t),folder=path.join(x.parent,'outside-folder'),alias=path.join(x.root,'alias');
 fs.mkdirSync(folder);try{fs.symlinkSync(folder,alias,process.platform==='win32'?'junction':'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Filesystem junctions unavailable in this test environment');return;}throw error;}
 const a=output(x,{filePath:path.join(alias,'outside.txt')});
 await rejectWithoutOpening(x,a.url+'/reveal');
});

test('a hidden new verified artifact is linked from its host settlement record without regenerating it',async t=>{
 const x=await setup(t),a=output(x,{hidden:true,name:'原来有文件但无下载卡.txt'});
 const view=await(await x.req('/api/conversations/'+a.c.id)).json();
 assert.equal(view.turns[0].artifacts.length,0,'retain the original historical delivery classification');
 const local=view.turns[0].localFiles.find(f=>f.id===a.record.artifactId);assert(local,'new verified files are not lost with download cards');
 assert.equal(local.path,fs.realpathSync(a.file));
 assert.equal((await x.req(local.revealUrl,{method:'POST'})).status,200);
 assert.equal(x.calls.length,1);assert.equal(fs.readFileSync(a.file,'utf8'),'真实交付结果');
});

test('failed verification and old reference-only artifacts do not become fresh local result links',async t=>{
 const x=await setup(t),a=output(x,{hidden:true});
 const p=path.join(a.t.directory,'delivery-settlement.json');
 const settlement=JSON.parse(fs.readFileSync(p,'utf8'));
 settlement.otherVerifiedArtifacts[0].available=false;
 fs.writeFileSync(p,JSON.stringify(settlement));
 let view=await(await x.req('/api/conversations/'+a.c.id)).json();
 assert(!view.turns[0].localFiles.some(f=>f.id===a.record.artifactId&&f.available));
 await rejectWithoutOpening(x,a.url+'/reveal');
 settlement.otherVerifiedArtifacts[0]={...a.record,generation:'existing',role:'reference'};
 fs.writeFileSync(p,JSON.stringify(settlement));
 view=await(await x.req('/api/conversations/'+a.c.id)).json();
 assert(!view.turns[0].localFiles.some(f=>f.id===a.record.artifactId),'a past reference is not this turn output');
 await rejectWithoutOpening(x,a.url+'/reveal');
});

test('workspace originals use their managed filename and exact authorized path, not a bare hash blob',async t=>{
 const x=await setup(t),o=original(x);
 const listing=await(await x.req('/api/workspace?kind=original')).json();
 const resource=listing.resources.find(r=>r.resourceId===o.ref.resourceId);assert(resource?.localFile);
 assert.equal(resource.localFile.path,fs.realpathSync(o.file));assert.equal(path.basename(resource.localFile.path),o.name);
 const res=await x.req(o.url+'/open?revision='+o.ref.revisionId,{method:'POST'});assert.equal(res.status,200,await res.text());
 assert.equal(x.calls[0].path,fs.realpathSync(o.file));assert.equal(x.calls[0].action,'open');
});

test('a legacy blob opens through a verified named managed copy without changing the original blob',async t=>{
 const x=await setup(t),c=x.workspace.newConversation(),bytes=Buffer.from('旧原件中文内容'),name='旧版 原件 & 标题.txt';
 const ref=x.workspace.space.put({projectId:x.workspace.workspaceId,workItemId:c.id,kind:'original',bytes,metadata:{name}});
 const blob=path.join(x.workspace.space.root,'blobs',digest(bytes)),before=fs.readFileSync(blob);
 const listing=await(await x.req('/api/workspace?kind=original')).json();
 const descriptor=listing.resources.find(r=>r.resourceId===ref.resourceId).localFile;
 assert.equal(descriptor.path,null);assert.equal(descriptor.canOpen,true);assert.equal(x.calls.length,0);
 const response=await x.req(`/api/workspace/resources/${ref.resourceId}/reveal?revision=${ref.revisionId}`,{method:'POST'});
 assert.equal(response.status,200,await response.text());
 const file=x.calls[0].path;
 assert.notEqual(file,blob);assert(file.startsWith(x.workspace.managed.directory+path.sep));assert.equal(path.basename(file),name);
 assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readFileSync(blob),before);
 const again=await x.req(`/api/workspace/resources/${ref.resourceId}/open?revision=${ref.revisionId}`,{method:'POST'});
 assert.equal(again.status,200,await again.text());assert.equal(x.calls[1].path,file);
});

test('archived, revoked, unknown-scope and invalid-revision resources cannot invoke native actions',async t=>{
 const x=await setup(t),a=original(x,'archive.txt'),b=original(x,'revoke.txt');
 x.workspace.managed.changeState(a.ref.resourceId,'archived');
 x.workspace.managed.changeState(b.ref.resourceId,'revoked');
 for(const o of [a,b])await rejectWithoutOpening(x,o.url+'/reveal?revision='+o.ref.revisionId);
 const active=original(x,'active.txt');
 await rejectWithoutOpening(x,active.url+'/open?revision='+('0'.repeat(64)));
 const alienId='another_project';x.workspace.space.project(alienId);x.workspace.space.work(alienId,'work');
 const alien=x.workspace.space.put({projectId:alienId,workItemId:'work',kind:'original',bytes:Buffer.from('not granted'),metadata:{name:'alien.txt'}});
 await rejectWithoutOpening(x,'/api/workspace/resources/'+alien.resourceId+'/reveal?revision='+alien.revisionId);
});

test('resource hash changes and metadata-only result resources are not opened as original files',async t=>{
 const x=await setup(t),o=original(x);fs.appendFileSync(o.file,'tamper');
 await rejectWithoutOpening(x,o.url+'/open?revision='+o.ref.revisionId);
 const c=x.workspace.newConversation(),file=path.join(x.workspace.space.root,'metadata-only.txt');fs.writeFileSync(file,'not a deliverable');
 const ref=x.workspace.space.put({projectId:x.workspace.workspaceId,workItemId:c.id,kind:'result',bytes:Buffer.from('not a deliverable'),metadata:{name:'metadata-only.txt',managedPath:path.relative(x.workspace.space.root,file)}});
 await rejectWithoutOpening(x,'/api/workspace/resources/'+ref.resourceId+'/reveal?revision='+ref.revisionId);
});

test('a turn artifact remains blocked when its registered resource is archived after rendering',async t=>{
 const x=await setup(t),a=output(x);
 const ref=x.workspace.space.put({projectId:x.workspace.workspaceId,workItemId:a.c.id,kind:'artifact',bytes:fs.readFileSync(a.file),metadata:{artifactId:a.record.artifactId,name:path.basename(a.file)}});
 x.workspace.managed.changeState(ref.resourceId,'archived');
 await rejectWithoutOpening(x,a.url+'/reveal');
});

test('explicit resource revisions select their exact path; an ambiguous version is not silently guessed',async t=>{
 const x=await setup(t),o=original(x,'version-one.txt'),file2=path.join(path.dirname(o.file),'version-two.txt');fs.writeFileSync(file2,'第二版');
 const second=x.workspace.space.put({projectId:x.workspace.workspaceId,workItemId:o.c.id,resourceId:o.ref.resourceId,kind:'original',bytes:fs.readFileSync(file2),metadata:{name:'version-two.txt',managedPath:path.relative(x.workspace.space.root,file2)}});
 await rejectWithoutOpening(x,o.url+'/open');
 for(const [ref,file] of [[o.ref,o.file],[second,file2]]){
  const res=await x.req(o.url+'/open?revision='+ref.revisionId,{method:'POST'});assert.equal(res.status,200,await res.text());
  assert.equal(x.calls.at(-1).path,fs.realpathSync(file));
 }
});

test('native launch failure is reported honestly and does not manufacture a successful open receipt',async t=>{
 const x=await setup(t,{openLocalFile:async()=>{throw Object.assign(new Error('native app unavailable'),{code:'ENOENT'});}}),a=output(x);
 // Injection is the boundary: tests never launch Explorer or a document application.
 const response=await x.req(a.url+'/open',{method:'POST'});assert(response.status>=400);
 assert.match(await response.text(),/native app unavailable|无法|失败|ENOENT/);
 assert.equal(x.calls.length,0);
});
