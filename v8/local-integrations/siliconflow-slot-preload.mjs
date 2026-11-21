import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSiliconflowSlotFetch} from '../v8-tools/siliconflow-slot-fetch.mjs';
const installed=Symbol.for('banxing.siliconflow.shared-slot-installed');
if(!globalThis[installed]){
 if(process.env.AFK_SILICONFLOW_WORKER)throw Error('SF_SLOT_NESTING_FORBIDDEN: use request preload OR a finite sf-turn run wrapper, never both');
 const module=process.env.BANXING_SF_SLOT_MODULE,worker=process.env.BANXING_SF_WORKER,logs=process.env.BANXING_SF_QUEUE_LOG_DIR;
 if(!module||!worker||!logs)throw Error('SF_SLOT_CONFIGURATION_REQUIRED: queue module, worker and local receipt directory are mandatory');
 const {withSiliconflowSlot}=await import(pathToFileURL(path.resolve(module)).href);
 if(typeof withSiliconflowSlot!=='function')throw Error('SF_SHARED_SLOT_INTERFACE_MISSING');
 fs.mkdirSync(logs,{recursive:true});
 const onReceipt=r=>fs.writeFileSync(path.join(logs,r.id+'.json'),JSON.stringify({pid:process.pid,...r},null,2));
 globalThis.fetch=createSiliconflowSlotFetch({fetchImpl:globalThis.fetch.bind(globalThis),withSlot:withSiliconflowSlot,workerId:worker,onReceipt});
 globalThis[installed]=true;
 const self=fileURLToPath(import.meta.url),helper=fileURLToPath(new URL('../v8-tools/siliconflow-slot-fetch.mjs',import.meta.url));
 fs.writeFileSync(path.join(logs,'installed-'+process.pid+'.json'),JSON.stringify({kind:'SF_SHARED_SLOT_PRELOAD_INSTALLED',workerId:worker,pid:process.pid,installedAt:new Date().toISOString(),entrypoint:path.basename(process.argv[1]||''),preloadSha256:createHash('sha256').update(fs.readFileSync(self)).digest('hex'),helperSha256:createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),scope:'global fetch to api.siliconflow.cn; includes retries; no keys or prompt bodies recorded',bufferedStreaming:true},null,2));
}
