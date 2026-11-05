import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {assetStoragePath} from '../v8-tools/asset-storage-path.mjs';
import {Continuity} from '../v8-tools/continuity.mjs';import {DocumentTools} from '../v8-tools/document-tools.mjs';import {DocumentExtras} from '../v8-tools/document-extras.mjs';import {SourceRecordTools} from '../v8-tools/source-record-tools.mjs';import {TextTools} from '../v8-tools/text-tools.mjs';
import {localAudioPreflight,registeredAudioTools} from '../v8-tools/local-audio-preflight.mjs';import {AudioTools} from '../v8-tools/audio-tools.mjs';import {createHash} from 'node:crypto';

test('timestamped display names cannot become storage extensions or path traversal',()=>{
 for(const name of ['recording.m4a [00:00:00,000–00:01:30,004]','../escape.wav [00:01/02]','a.m4a [bad:time]'])assert.equal(path.basename(assetStoragePath('run',{id:'segment-1',name,format:'wav'})),'segment-1.wav');
 assert.throws(()=>assetStoragePath('run',{id:'../escape',name:'a.wav',format:'wav'}),{code:'INVALID_STORED_ASSET_ID'});
 assert.equal(path.basename(assetStoragePath('run',{id:'pdf',name:'a.pdf'})),'pdf.pdf');
});
test('actual same-task continuity restores timestamped audio bytes and identifiers without changing original',t=>{
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'v8-audio-resume-'));t.after(()=>{assert.equal(path.dirname(root),base);assert(path.basename(root).startsWith('v8-audio-resume-'));fs.rmSync(root,{recursive:true,force:true});});
 const original=path.join(root,'recording.m4a');fs.writeFileSync(original,'explicit synthetic audio bytes');const bytes=fs.readFileSync(original);
 const open=(name,resume)=>{const directory=path.join(root,name),c=new Continuity({directory,request:'synthetic transcript',inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'p',workItemId:'w',...(resume?{mode:'resume',resumeRunId:resume}:{})}}),docs=new DocumentTools({directory,inputs:resume?[]:[original],python:process.execPath}),extras=new DocumentExtras(docs),records=new SourceRecordTools(docs,extras,new TextTools(docs));c.bind({docs,extras,records});return{c,docs};};
 const x=open('first'),source=[...x.docs.assets.values()][0],id='segment-1',segmentFile=path.join(x.docs.directory,'assets','segment-1.wav');fs.writeFileSync(segmentFile,'synthetic segment bytes');
 x.docs.assets.set(id,{...source,id,sourceId:source.id,parentId:source.id,name:'recording.m4a [00:00:00,000–00:01:30,004]',format:'wav',kind:'audio',path:segmentFile,sha256:createHash('sha256').update(fs.readFileSync(segmentFile)).digest('hex')});
 // Checkpoint derives the immutable byte hash itself; this fixture is not ASR.
 x.c.checkpoint();const y=open('second',x.c.runId),segment=y.docs.asset(id);
 assert.equal(path.extname(segment.path),'.wav');assert.equal(segment.name,'recording.m4a [00:00:00,000–00:01:30,004]');assert.equal(fs.readFileSync(segment.path,'utf8'),'synthetic segment bytes');assert.equal(segment.sourceId,source.id);assert.deepEqual(fs.readFileSync(original),bytes);
 assert.throws(()=>new Continuity({directory:path.join(root,'other'),request:'x',inputClassification:'synthetic',continuity:{spaceRoot:path.join(root,'space'),projectId:'p',workItemId:'other',mode:'resume',resumeRunId:x.c.runId}}),/RESUME_SCOPE_DENIED/);
});
test('missing local transcriber returns actionable failure before any inspect/split or model call',async()=>{
 let calls=0;const x=await localAudioPreflight({docs:{assets:new Map([['a',{id:'a',sourceId:'a',kind:'audio'}]])},audio:{config:{}},harness:{tools:new Map([['inspect_media',{}]]),execute:()=>{calls++;}},config:{asr:{provider:'local'}},request:'请转写录音'});
 assert.equal(x.reason,'local_audio_tools_unavailable');assert(x.missingTools.includes('transcribe_audio'));assert.equal(calls,0);assert.equal(x.cloudModelCalls,0);assert.equal(x.localOnly,true);
});
test('current external+local registration includes transcribe_audio; external+intranet cannot call ASR',()=>{
 const audio=new AudioTools({},{},{asr:{provider:'local'}});
 for(const provider of ['local','intranet']){const config={externalWorkspace:true,asr:{provider}},tools=registeredAudioTools(audio,config);assert.equal(tools.some(t=>t.name==='transcribe_audio'),provider==='local');}
});
