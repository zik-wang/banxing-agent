import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {path7za} from '7zip-bin';
import {Store} from '../src/runtime/core.mjs';
import {Workspace} from '../src/workspace/workspace.mjs';

function tempStore(t){const root=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(root,'v6-arc-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),root);assert(path.basename(dir).startsWith('v6-arc-'));fs.rmSync(dir,{recursive:true,force:true});});return new Store(dir);}
async function sampleZip(){const zip=new JSZip();zip.file('发票.txt','发票正文');zip.file('sub/说明.txt','第二份');zip.file('../逃逸.txt','不能导入');zip.file('run.exe','MZ');zip.file('__MACOSX/._发票.txt','junk');return zip.generateAsync({type:'nodebuffer'});}
function pack(dir,name,format){fs.writeFileSync(path.join(dir,'发票.txt'),'发票正文');const packed=path.join(dir,name);const result=spawnSync(path7za,['a','-y','-bd','-t'+format,packed,'发票.txt'],{cwd:dir,windowsHide:true});assert.equal(result.status,0,result.stderr?.toString());return fs.readFileSync(packed);}

test('zip 直接展开成可处理文件，并丢掉可执行文件',async t=>{const store=tempStore(t),workspace=new Workspace(store,{active:new Map()});const result=await workspace.upload({name:'材料.zip',base64:(await sampleZip()).toString('base64')});assert.equal(result.archive,'材料.zip');assert.deepEqual(result.files.map(file=>file.name).sort(),['发票.txt','说明.txt','逃逸.txt']);assert.equal(result.files.find(file=>file.name==='发票.txt').content,'发票正文');assert.equal(result.files.find(file=>file.name==='说明.txt').content,'第二份');assert.equal(result.files.find(file=>file.name==='逃逸.txt').content,'不能导入');assert(result.skipped.includes('run.exe'));assert.equal(store.state.workspaceFiles.some(file=>file.name.endsWith('.exe')),false);});

test('7z 和 tar.gz 也按同样规则展开',async t=>{const store=tempStore(t),workspace=new Workspace(store,{active:new Map()}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-pack-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const seven=await workspace.upload({name:'材料.7z',base64:pack(dir,'材料.7z','7z').toString('base64')});assert.equal(seven.files[0].content,'发票正文');fs.writeFileSync(path.join(dir,'发票.txt'),'压缩包正文');const gz=spawnSync(path7za,['a','-y','-bd','-tgzip',path.join(dir,'材料.tar.gz'),'发票.txt'],{cwd:dir,windowsHide:true});assert.equal(gz.status,0,gz.stderr?.toString());const tar=await workspace.upload({name:'材料.tar.gz',base64:fs.readFileSync(path.join(dir,'材料.tar.gz')).toString('base64')});assert.match(tar.files[0].content,/发票正文|压缩包正文/);});

test('名为 rar 但不是压缩包时给出解开失败，而不是拒绝格式',async t=>{const store=tempStore(t),workspace=new Workspace(store,{active:new Map()});await assert.rejects(workspace.upload({name:'发票.rar',base64:Buffer.from('not-a-rar').toString('base64')}),/无法解开|没有可导入/);});
