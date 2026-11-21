import path from 'node:path';import {Store} from '../src/runtime/core.mjs';
const store=new Store(path.resolve(import.meta.dirname,'../qa-output/session-push-fixture'));
for(const key of ['runs','conversations','notifications','approvals','workspaceFiles','jobs'])store.state[key]=[];delete store.state.proactive;
store.state.tasks=[{id:'fictional-push-task',title:'虚构测试：准备演示稿',details:'仅用于主动推送验收',done:false,dueAt:null}];store.save();
