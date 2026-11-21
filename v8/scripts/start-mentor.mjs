import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.PORT||='8814';
process.env.DEMO_DATA_DIR||=path.join(root,'data','mentor');
process.env.V7_DEPLOYMENT_CONFIG||=path.join(root,'examples','mentor','company-intranet.json');
process.env.CALENDAR_CONFIG_FILE||=path.join(root,'examples','mentor','calendar-isolated.json');
console.log('Mentor trial: configured company intranet; isolated test calendar.');
await import('../start-product.mjs');
