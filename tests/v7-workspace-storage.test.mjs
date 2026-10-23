import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {Store} from '../core.mjs';
import {addWorkspaceFile,readOriginal,assertWorkspaceCapacity,workspaceStorage,MAX_WORKSPACE_FILES,MAX_WORKSPACE_BYTES} from '../workspace-files.mjs';
import {importArchive} from '../archives.mjs';
import {temporary} from './dsh-fixture.mjs';
const input=name=>({name,base64:Buffer.from('新的原始材料').toString('base64')});
function seed(store,count,bytes=1){store.state.workspaceFiles=Array.from({length:count},(_,i)=>({id:'existing-'+i,name:'existing-'+i+'.txt',bytes}));return JSON.stringify(store.state.workspaceFiles);}

test('已有80份原件仍可上传，已有记录保持不变且新原件可回读',async t=>{
 const store=new Store(temporary(t,'v7-storage-')),before=seed(store,80);
 const file=await addWorkspaceFile(store,input('新材料.txt'));
 assert.equal(store.state.workspaceFiles.length,81);assert.equal(JSON.stringify(store.state.workspaceFiles.slice(0,80)),before);assert.equal(readOriginal(store,file).toString(),'新的原始材料');
 const state=workspaceStorage(store);assert.equal(state.maxFiles,2000);assert.equal(state.maxBytes,2*1024**3);
});
test('压缩包导入使用同一容量规则，不再在80份处截断',async t=>{
 const store=new Store(temporary(t,'v7-storage-'));seed(store,80);const zip=new JSZip();zip.file('第一份.txt','第一份');zip.file('第二份.txt','第二份');
 const result=await importArchive(store,{name:'材料.zip',base64:(await zip.generateAsync({type:'nodebuffer'})).toString('base64')});
 assert.equal(result.files.length,2);assert.equal(result.omitted,0);assert.equal(store.state.workspaceFiles.length,82);
});
test('文件数与总字节上限分别生效，拒绝时不丢已有记录',async t=>{
 const store=new Store(temporary(t,'v7-storage-'));let before=seed(store,MAX_WORKSPACE_FILES);
 await assert.rejects(addWorkspaceFile(store,input('超限.txt')),/容量不足/);assert.equal(JSON.stringify(store.state.workspaceFiles),before);
 seed(store,1,MAX_WORKSPACE_BYTES);before=JSON.stringify(store.state.workspaceFiles);
 await assert.rejects(addWorkspaceFile(store,input('超字节.txt')),/容量不足/);assert.equal(JSON.stringify(store.state.workspaceFiles),before);
 store.state.workspaceFiles[0].bytes=MAX_WORKSPACE_BYTES-10;assert.doesNotThrow(()=>assertWorkspaceCapacity(store,10));assert.throws(()=>assertWorkspaceCapacity(store,11),/容量不足/);
});
test('并发解析不能共同占用最后一个位置；重启仍可读取扩容后的文件库',async t=>{
 const store=new Store(temporary(t,'v7-storage-'));seed(store,MAX_WORKSPACE_FILES-1);
 const results=await Promise.allSettled([addWorkspaceFile(store,input('并发一.txt')),addWorkspaceFile(store,input('并发二.txt'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.state.workspaceFiles.length,MAX_WORKSPACE_FILES);
 const reopened=new Store(store.directory);assert.equal(reopened.state.workspaceFiles.length,MAX_WORKSPACE_FILES);assert.equal(readOriginal(reopened,reopened.state.workspaceFiles.at(-1)).toString(),'新的原始材料');
});
