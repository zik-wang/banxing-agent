import fs from 'node:fs';
import path from 'node:path';
import {DocumentTools} from './document-tools.mjs';
import {ToolHarness, runToolAgent, chatApi} from './harness.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node v8-tools/run.mjs <operator-config.json>');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
if (!config.request || !config.chat?.baseUrl || !config.chat?.model) throw new Error('Configure request and chat connection');
const directory = path.resolve(config.directory);
fs.mkdirSync(path.dirname(directory), {recursive:true});
const documents = new DocumentTools({...config, directory});
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const timer = setTimeout(() => controller.abort(), config.timeoutMs || 600000);
const harness = new ToolHarness({directory, tools: documents.tools(), maxCalls: config.maxCalls || 24, signal:controller.signal});
try {
  const result = await runToolAgent({harness, next:chatApi(config.chat), request:config.request, maxRounds:config.maxRounds || 16, context:{materials:[...documents.assets.values()].map(a=>documents.publicAsset(a)),visionLimits:{maxImageBytes:config.vision?.maxImageBytes || 5242880}}});
  console.log(JSON.stringify({status:result.status,calls:result.calls,answer:result.answer,report:path.join(directory,'agent-run.json')},null,2));
} catch (error) {
  fs.writeFileSync(path.join(directory,'run-error.json'),JSON.stringify({code:error.code||'RUN_FAILED',message:error.message,contentVerified:false},null,2));
  console.error(error.message);process.exitCode=1;
} finally { clearTimeout(timer);fs.writeFileSync(path.join(directory,'final-status.json'),JSON.stringify(documents.status(),null,2)); }
