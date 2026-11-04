import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {WorkspaceExecution} from '../v8-tools/workspace-execution.mjs';import {DocumentTools} from '../v8-tools/document-tools.mjs';import {DocumentExtras} from '../v8-tools/document-extras.mjs';import {TextTools} from '../v8-tools/text-tools.mjs';import {DeliveryTools} from '../v8-tools/delivery-tools.mjs';
import {ResultTools} from '../v8-tools/result-tools.mjs';
const python=process.env.V8_PYTHON||'C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const codex=process.env.BX_CODEX_EXE||'C:/Users/31125/AppData/Local/OpenAI/Codex/bin/b6c7fc9497179c98/codex.exe';
const powershell=process.env.BX_POWERSHELL;
const native=process.platform==='win32'&&!!powershell&&fs.existsSync(codex)&&fs.existsSync(python);
function setup(t,request='根据材料处理并生成文件'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bx-workspace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const original=path.join(root,'source.txt');fs.writeFileSync(original,'原文 0.1 + 0.2');
 const docs=new DocumentTools({directory:path.join(root,'run'),inputs:[original],python});docs.executionRepair=true;docs.request=request;
 const extras=new DocumentExtras(docs,{}),delivery=new DeliveryTools(docs,extras,new TextTools(docs));
 const config={workspaceExecution:{enabled:true,backend:'codex-mxc',codexExecutable:codex,pythonExecutable:python,powershellExecutable:powershell||process.execPath,readOnlyRuntimeRoots:[path.dirname(process.execPath)],maxCommandSeconds:20,maxOutputBytes:8192}};
 return{root,original,docs,extras,config,workspace:new WorkspaceExecution(docs,extras,delivery,config)};
}
test('host paths, inputs, control configuration, junctions and hardlinks cannot be written/published',t=>{
 const x=setup(t);for(const file of ['../escape.txt',x.original,'inputs/test.txt','control/home/config.toml'])assert.throws(()=>x.workspace.write({file,content:'bad'}),{code:'WORKSPACE_PATH_DENIED'});
 x.workspace.write({file:'work/outputs/a.txt',content:'actual output'});assert.equal(x.workspace.read({file:'work/outputs/a.txt'}).text,'actual output');
 fs.linkSync(path.join(x.workspace.work,'outputs/a.txt'),path.join(x.workspace.work,'outputs/hard.txt'));assert.throws(()=>x.workspace.read({file:'work/outputs/hard.txt'}),{code:'WORKSPACE_LINK_DENIED'});
 if(process.platform==='win32'){fs.symlinkSync(path.join(x.root,'not-created-target'),path.join(x.workspace.work,'link'),'junction');assert.throws(()=>x.workspace.write({file:'work/link/file.txt',content:'bad'}),{code:'WORKSPACE_LINK_DENIED'});}
 assert.equal(fs.readFileSync(x.original,'utf8'),'原文 0.1 + 0.2');
});
test('requests prohibiting code execution do not expose a general command tool',t=>{
 const x=setup(t,'修复源码，不要运行代码，不要创建PR。');assert.equal(x.workspace.commandsAllowed,false);assert.equal(x.workspace.tools().some(t=>t.name==='workspace_run'),false);
});
test('private local-only audio policy cannot be bypassed by a general execution workspace',t=>{
 const x=setup(t);x.docs.privateAudioMetadataOnly=true;assert.throws(()=>new WorkspaceExecution(x.docs,x.extras,{},x.config),{code:'LOCAL_ONLY_EXECUTION'});
});
test('native Python performs actual Decimal calculation and publishes a real saved result',{skip:!native},async t=>{
 const x=setup(t),r=await x.workspace.run({language:'python',code:"from decimal import Decimal\nfrom pathlib import Path\nPath('outputs/result.txt').write_text(str(Decimal('0.1')+Decimal('0.2')),encoding='utf8')\nprint('EXECUTED')"});
 assert.equal(r.exitCode,0);assert.match(r.stdout,/EXECUTED/);const a=await x.workspace.publish({file:'work/outputs/result.txt',title:'实际计算'},{});assert.equal(a.exportIntegrityPassed,true);assert.equal(fs.readFileSync(a.path,'utf8'),'0.3');
 const again=await x.workspace.publish({file:'work/outputs/result.txt',title:'实际计算'},{});assert.equal(again.artifactId,a.artifactId);assert.equal(x.extras.artifacts.size,1);
});
test('native PowerShell can run generated commands and preserve UTF8 outputs',{skip:!native},async t=>{
 const x=setup(t),r=await x.workspace.run({language:'powershell',code:"[IO.File]::WriteAllText('outputs/ps.txt','真实命令执行'); Write-Output 'PS_EXECUTED'"});assert.equal(r.exitCode,0,r.stderr);assert.match(r.stdout,/PS_EXECUTED/);assert.equal(x.workspace.read({file:'work/outputs/ps.txt'}).text,'真实命令执行');
});
test('native generated DOCX and typed XLSX are reopened and published as actual Office files',{skip:!native},async t=>{
 const x=setup(t),r=await x.workspace.run({language:'python',code:"from openpyxl import Workbook\nfrom docx import Document\nw=Workbook();s=w.active;s.title='记录';s.append(['金额','名称','已核']);s.append([0.3,'原值',True]);w.save('outputs/result.xlsx')\nd=Document();d.add_paragraph('实际正文');t=d.add_table(rows=1,cols=2);t.cell(0,0).text='姓名';t.cell(0,1).text='原文';d.save('outputs/result.docx')"});assert.equal(r.exitCode,0,r.stderr);
 const book=await x.workspace.publish({file:'work/outputs/result.xlsx',title:'实际表格'},{}),word=await x.workspace.publish({file:'work/outputs/result.docx',title:'实际文档'},{});assert.equal(book.exportIntegrityPassed,true);assert.equal(word.exportIntegrityPassed,true);
 const artifact=x.extras.artifacts.get(book.artifactId);assert.equal(artifact.expected[0].raw[1][0],0.3);assert.equal(typeof artifact.expected[0].raw[1][0],'number');assert.equal(artifact.expected[0].raw[1][2],true);
 const reopened=await new ResultTools(x.docs,x.extras,null).read({artifact_id:book.artifactId},{signal:AbortSignal.timeout(10000)});assert.equal(reopened.sheets[0].rows[1][0],0.3);assert.equal(reopened.sheets[0].rows[1][2],true);assert.equal(reopened.offsetUnit,'worksheet_rows_including_header');
 assert.equal(x.extras.artifacts.get(word.artifactId).expectedWord.tables[0][0][1],'原文');
});
test('native sandbox blocks staged-input writes, host canary reads/writes, loopback and inherited secrets',{skip:!native},async t=>{
 const x=setup(t),canary=path.join(x.root,'host-secret.txt');fs.writeFileSync(canary,'host-only');
 const server=net.createServer(s=>s.end('reachable-on-host'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 process.env.BX_FAKE_API_KEY='not-a-real-secret';t.after(()=>delete process.env.BX_FAKE_API_KEY);
 const input=x.workspace.sources[0].path;
 const code=`import pathlib,json,os,socket\nr={}\nfor key,p,write in [('read_input',${JSON.stringify('../'+input)},False),('write_input',${JSON.stringify('../'+input)},True),('read_host',${JSON.stringify(canary)},False),('write_host',${JSON.stringify(path.join(x.root,'outside.txt'))},True)]:\n try:\n  p=pathlib.Path(p); p.write_text('bad') if write else p.read_text(encoding='utf8');r[key]=True\n except Exception:r[key]=False\ntry:\n s=socket.create_connection(('127.0.0.1',${server.address().port}),timeout=2);s.close();r['loopback']=True\nexcept Exception:r['loopback']=False\nr['inherited_secret']=os.getenv('BX_FAKE_API_KEY')\nprint(json.dumps(r))`;
 const r=await x.workspace.run({language:'python',code});assert.equal(r.exitCode,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{read_input:true,write_input:false,read_host:false,write_host:false,loopback:false,inherited_secret:null});assert.equal(fs.existsSync(path.join(x.root,'outside.txt')),false);
});
test('native command timeout kills its spawned process tree',{skip:!native},async t=>{
 const x=setup(t);const late=path.join(x.workspace.work,'outputs/late.txt');
 const childCode="import time,pathlib;time.sleep(3);pathlib.Path("+JSON.stringify(late)+").write_text('late')";
 const r=await x.workspace.run({language:'python',timeout_seconds:1,code:'import subprocess,sys,time\nsubprocess.Popen([sys.executable,"-c",'+JSON.stringify(childCode)+'])\ntime.sleep(15)'});assert.equal(r.stopped,'timeout');await new Promise(resolve=>setTimeout(resolve,3500));assert.equal(fs.existsSync(late),false);
});
test('a failed sandbox backend never falls back to unsandboxed execution',{skip:!native},async t=>{
 const x=setup(t);x.workspace.config.codexExecutable=process.execPath;const r=await x.workspace.run({language:'python',code:"open('outputs/should-not-exist','w').write('unsafe')"});assert.notEqual(r.exitCode,0);assert.equal(fs.existsSync(path.join(x.workspace.work,'outputs/should-not-exist')),false);
});
test('native stdout flood is stopped and cannot be reported as a completed command',{skip:!native},async t=>{
 const x=setup(t);x.workspace.config.maxOutputBytes=2048;const r=await x.workspace.run({language:'python',code:"print('x'*100000)"});assert.equal(r.stopped,'output_limit');assert.equal(r.partial,true);assert.ok(r.stdout.length<=2048);
});
