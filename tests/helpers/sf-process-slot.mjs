// Test-only shim: use the REAL shared client with faster polling, never a
// production slot or another scheduler implementation.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.env.V8_SF_PROCESS_TEST!=='1'||!process.env.BOARD_DATA||!process.env.BOARD_PORT)throw Error('TEST_ISOLATION_REQUIRED');
const shared=await import(pathToFileURL(path.join(process.env.V8_SF_TEST_SHARED_ROOT,'sf-turn.mjs')).href);
export const withSiliconflowSlot=(worker,fn,options)=>shared.withSiliconflowSlot(worker,fn,{...options,pollMs:25});
