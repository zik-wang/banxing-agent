import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ResourceSpace} from '../v8-tools/resource-space.mjs';import {ManagedWorkspace} from '../v8-tools/managed-workspace.mjs';
test('identical explicit reupload in a different authorization scope creates a separate resource, never relabels private original',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'upload-scope-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const space=new ResourceSpace(dir),w=new ManagedWorkspace(space,'test');space.work('test','first');space.work('test','second');const bytes=Buffer.from('public test text');
 w.classification='private';const a=w.importOriginal({name:'notice.txt',bytes,conversationId:'first',workItemId:'first'});
 w.classification='external_authorized';const b=w.importOriginal({name:'notice.txt',bytes,conversationId:'second',workItemId:'second'});
 assert.notEqual(a.resourceId,b.resourceId);assert.equal(space.check('test',a).metadata.classification,'private');assert.equal(space.check('test',b).metadata.classification,'external_authorized');assert.deepEqual(space.read('test',a),bytes);
 const c=w.importOriginal({name:'notice.txt',bytes,conversationId:'second',workItemId:'second'});assert.deepEqual(c,b);
 w.classification='private';assert.deepEqual(w.importOriginal({name:'notice.txt',bytes,conversationId:'first',workItemId:'first'}),a);
});
