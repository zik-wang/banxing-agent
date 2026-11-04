import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {atomic,localPersistenceFailure} from '../v8-tools/resource-space.mjs';
import {WebWorkspace} from '../v8-web/server.mjs';

test('Windows sharing locks longer than half a second recover within the bounded atomic retry',{skip:process.platform!=='win32',timeout:15000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v8-file-sharing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'state.json');atomic(file,{version:1});
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const command="$file=[IO.File]::Open("+quote(file)+",[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{Write-Output 'LOCK_READY';[Console]::Out.Flush();Start-Sleep -Milliseconds 1100}finally{$file.Dispose()}";
 const child=spawn('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
 await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Sharing lock did not start: '+stderr)),8000);child.stdout.on('data',b=>{out+=b;if(out.includes('LOCK_READY')){clearTimeout(timer);resolve();}});child.on('error',reject);});
 let attempts=0;const before=Date.now();
 try{atomic(file,{version:2},{rename:(from,to)=>{attempts++;fs.renameSync(from,to);}});}finally{child.kill();}
 assert.ok(attempts>1&&attempts<=8);assert.ok(Date.now()-before>=800);assert.equal(JSON.parse(fs.readFileSync(file)).version,2);
});

test('local storage failures have actionable feedback without masquerading as a model error',()=>{
 for(const code of ['EPERM','EACCES','EBUSY','SPACE_BUSY_OR_INTERRUPTED_WRITER']){
  const failure=localPersistenceFailure({code,message:'private/path/raw error'});
  assert.equal(failure.kind,'local_persistence');assert.ok(!JSON.stringify(failure).includes('private/path'));assert.match(failure.action,/无需重新上传/);
 }
 assert.equal(localPersistenceFailure({code:'MODEL_HTTP_ERROR'}),null);
});

test('historical persistence error is explained read-only and preserves its actual failed state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v8-storage-view-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const w=new WebWorkspace({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.1:9/v1',model:'offline'}}),c=w.conversation(w.newConversation().id),directory=path.join(root,'failed');fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'run-error.json'),JSON.stringify({code:'EPERM',message:'private/raw/path'}));
 const turn={id:'failure',request:'合成保存测试',status:'failed',directory,artifacts:[]};c.turns.push(turn);const before=JSON.stringify(turn),view=w.turnView(c,turn);
 assert.equal(view.status,'failed');assert.equal(view.serviceFailure.kind,'local_persistence');assert.equal(JSON.stringify(turn),before);
});
