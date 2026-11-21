import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {WebWorkspace} from '../v8-web/server.mjs';
for(const removed of [false,true])test('resume uses original snapshot despite empty manual picker; removed='+removed,async t=>{
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'v8-resume-picker-'));t.after(()=>{assert.equal(path.dirname(root),base);assert(path.basename(root).startsWith('v8-resume-picker-'));fs.rmSync(root,{recursive:true,force:true});});
 const w=new WebWorkspace({dataRoot:root,chat:{provider:'intranet',baseUrl:'http://10.0.0.32/v1',model:'synthetic'}}),view=w.newConversation(),c=w.conversation(view.id);w.upload(c.id,'synthetic.txt',Buffer.from('explicit synthetic source'));
 const original=c.files[0];original.removed=removed;c.turns.push({id:'old-turn',runId:'old-run',status:'failed',request:'synthetic original task',artifacts:[]});let config;
 w.spawnRun=(node,args)=>{config=JSON.parse(fs.readFileSync(args[1],'utf8'));const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdout.end();child.stderr.end();return child;};
 await w.start(c.id,{message:'继续处理未完成的部分',mode:'resume',retryTurnId:'old-turn',fileIds:[],useConversationFiles:false});
 assert.equal(config.continuity.mode,'resume');assert.equal(config.continuity.resumeRunId,'old-run');assert.equal(config.continuity.excludedInputs.some(r=>r.resourceId===original.ref.resourceId),removed);assert.deepEqual(config.continuity.selectedInputs,[]);
 await new Promise(resolve=>setTimeout(resolve,80));
});
