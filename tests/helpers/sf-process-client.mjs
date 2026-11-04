import fs from 'node:fs';
import {createChatApi} from '../../v8-tools/model-transport.mjs';
import {streamingFetch} from '../../v8-tools/streaming-fetch.mjs';
import http from 'node:http';
if(process.env.V8_SF_PROCESS_TEST!=='1'||!process.env.BOARD_DATA||!process.env.BOARD_PORT)throw Error('TEST_ISOLATION_REQUIRED');
const [worker,mode,mockBase,output]=process.argv.slice(2);
const target=new URL(mockBase);
if(target.hostname!=='127.0.0.1')throw Error('MOCK_LOOPBACK_REQUIRED');
process.env.V8_SF_WORKER_ID=worker;
let starts=0;
const mapped=async(url,init)=>{
 if(url!=='https://api.siliconflow.cn/v1/chat/completions')throw Error('SF_BRANCH_NOT_REACHED');
 starts++;
 const mappedInit={...init,headers:{...init.headers,'x-test-worker':worker}};
 if(mode==='sse')return streamingFetch(url,mappedInit,(_original,options,callback)=>http.request(mockBase+'/mock',{...options,headers:mappedInit.headers},callback));
 return fetch(mockBase+'/mock',mappedInit);
};
const api=createChatApi({baseUrl:'https://api.siliconflow.cn/v1',provider:'siliconflow',model:'synthetic-27b',apiKey:'synthetic-model-only',fetchImpl:mapped,maxAttempts:3,timeoutMs:10000,logDirectory:output+'.receipts'});
const result={worker,pid:process.pid,mode,actualBranchUrl:'https://api.siliconflow.cn/v1/chat/completions',realSfRequests:0,startedAt:Date.now()};
try{result.message=await api([{role:'user',content:'Synthetic request only'}],[]);result.ok=true;}
catch(e){result.ok=false;result.error={code:e.code||null,message:e.message,httpStatus:e.details?.httpStatus||null};}
result.finishedAt=Date.now();result.providerDispatches=starts;result.metrics=api.metrics();
fs.writeFileSync(output,JSON.stringify(result,null,2));
process.exitCode=result.ok?0:1;
