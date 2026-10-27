import fs from 'node:fs';
import path from 'node:path';
import {DocumentTools} from './document-tools.mjs';
import {ToolHarness, runToolAgent, chatApi, FOCUSED_DOCUMENT_GUIDANCE} from './harness.mjs';
import {DocumentExtras} from './document-extras.mjs';
import {WorkbookTools} from './workbook-tools.mjs';
import {TextTools} from './text-tools.mjs';
import {KnowledgeTools} from './knowledge-tools.mjs';
import {DeliveryTools} from './delivery-tools.mjs';
import {AudioTools} from './audio-tools.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node v8-tools/run.mjs <operator-config.json>');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
if (!config.request || !config.chat?.baseUrl || !config.chat?.model) throw new Error('Configure request and chat connection');
const directory = path.resolve(config.directory);
fs.mkdirSync(path.dirname(directory), {recursive:true});
const documents = new DocumentTools({...config, directory});
const texts=new TextTools(documents);
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const timer = setTimeout(() => controller.abort(), config.timeoutMs || 600000);
const extras = new DocumentExtras(documents,config);
const workbooks = config.workbookTools ? new WorkbookTools(documents,extras,config) : null;
const knowledge=new KnowledgeTools(documents,texts,config),delivery=new DeliveryTools(documents,extras,texts),audio=new AudioTools(documents,delivery,config);
const harness = new ToolHarness({directory, tools: [...documents.tools(),...texts.tools(),...extras.tools(),...(workbooks?.tools()||[]),...knowledge.tools(),...delivery.tools(),...audio.tools()], maxCalls: config.maxCalls || 24, maxVisibleTools:config.maxVisibleTools||12, maxNoProgress:config.maxNoProgress||5,signal:controller.signal});
try {
  const result = await runToolAgent({harness, next:chatApi({...config.chat,logDirectory:path.join(directory,'model-responses')}), request:config.request, guidance:config.focusedGuidance?FOCUSED_DOCUMENT_GUIDANCE:'', maxRounds:config.maxRounds || 16, context:{materials:[...documents.assets.values()].map(a=>documents.publicAsset(a)),visionLimits:{maxImageBytes:config.vision?.maxImageBytes || 5242880}}});
  console.log(JSON.stringify({status:result.status,calls:result.calls,answer:result.answer,report:path.join(directory,'agent-run.json')},null,2));
} catch (error) {
  fs.writeFileSync(path.join(directory,'run-error.json'),JSON.stringify({code:error.code||'RUN_FAILED',message:error.message,contentVerified:false},null,2));
  console.error(error.message);process.exitCode=1;
} finally { clearTimeout(timer);fs.writeFileSync(path.join(directory,'final-status.json'),JSON.stringify({...documents.status(),audio:audio.status()},null,2)); }
