import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../core.mjs';
import {Harness} from '../runtime.mjs';
import {Workspace} from '../workspace.mjs';
import {ServiceDirectory} from '../intranet.mjs';
import {resolveArtifact} from '../artifacts.mjs';

const DATA='D:/pro222/personal-agent-v6/qa-output/real-run-data';
const OUT='D:/pro222/personal-agent-v6/qa-output/real-materials-20261019';
const store=new Store(DATA);
const directory=new ServiceDirectory();
await directory.refresh();
await directory.discoverMore().catch(error=>console.error('能力发现未完成',error.message));
const embed=directory.capabilities?.find(c=>c.kind==='multimodalEmbedding');
const rerank=directory.capabilities?.find(c=>c.kind==='reranker');
console.log('embed',embed?.ready,embed?.error||embed?.model||'');
console.log('rerank',rerank?.ready,rerank?.error||rerank?.model||'');
const harness=new Harness(store,{directory});
const workspace=new Workspace(store,harness);
const jobs=[
 {id:'14',fileIds:['c63ea426-2f97-480d-b9dd-133763c1d504','c5bb22d1-96cf-4fc1-9d96-42ce56c90279'],rules:'把这两份公开说明入库，并检索其中的入职或发票原句。'},
 {id:'16',fileIds:['49414a5c-50c5-4662-904a-d359c6d874e5','a5e95e2e-4656-4bad-8b61-1b2368451e1b'],rules:'这是两场公开会议日程，没有机票和酒店。只提取正文里的时间，不编交通耗时。'}
];
const results=[];
for(const item of jobs){
  try{
    const job=workspace.start({scenarioId:item.id,fileIds:item.fileIds,rules:item.rules});
    console.log(item.id,'started',job.id);
    const started=Date.now();
    while(['queued','running'].includes(job.status)){
      if(Date.now()-started>330000)throw Error('等待超过 330 秒');
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    const dir=path.join(OUT,item.id);
    fs.mkdirSync(dir,{recursive:true});
    const artifacts=[];
    for(const artifact of job.artifacts){
      const {bytes}=resolveArtifact(store,job.id,artifact.id);
      fs.writeFileSync(path.join(dir,artifact.name),bytes);
      artifacts.push(artifact.name);
    }
    results.push({id:item.id,status:job.status,summary:job.summary,error:job.error,artifacts});
    console.log(item.id,job.status,job.summary||job.error);
  }catch(error){
    results.push({id:item.id,status:'error',summary:error.message,artifacts:[]});
    console.log(item.id,'ERROR',error.message);
  }
}
fs.writeFileSync(path.join(OUT,'retry-14-16.json'),JSON.stringify({checkedAt:new Date().toISOString(),embed:{ready:!!embed?.ready,error:embed?.error||null,model:embed?.model||null},rerank:{ready:!!rerank?.ready,error:rerank?.error||null},results},null,2));
console.log('DONE');
