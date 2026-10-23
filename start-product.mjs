import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';import {readEnvFile} from './hybrid-deployment.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),env=path.join(root,'.env'),allowed=new Set(['PORT','DEMO_DATA_DIR','V7_DEPLOYMENT_CONFIG','CALENDAR_CONFIG_FILE','CALDAV_USERNAME','CALDAV_PASSWORD']);
if(fs.existsSync(env))for(const [key,value]of Object.entries(readEnvFile(env)))if(allowed.has(key)&&process.env[key]===undefined)process.env[key]=value;
await import('./server-v4.mjs');
