import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const namespace=process.env.QA_NAMESPACE||'dev-supervisor';
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace))throw Error('Invalid QA namespace');
process.env.QA_NAMESPACE=namespace;process.env.PORT||='8834';
const data=path.join(root,'.qa-runtime',namespace);
if(process.env.DEMO_DATA_DIR&&path.resolve(process.env.DEMO_DATA_DIR)!==data)throw Error('QA start refuses shared production data; choose QA_NAMESPACE');
process.env.DEMO_DATA_DIR=data;fs.mkdirSync(data,{recursive:true});
// Use only an explicitly supplied provider profile. No company addresses or secrets embedded.
console.log('QA namespace='+namespace+' port='+process.env.PORT+' data='+data);
await import('../start-product.mjs');
