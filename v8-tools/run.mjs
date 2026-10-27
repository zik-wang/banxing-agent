import fs from 'node:fs';
import path from 'node:path';
import {DocumentTools} from './document-tools.mjs';
import {ToolHarness, runToolAgent, chatApi, FOCUSED_DOCUMENT_GUIDANCE,TOOL_SOURCE_GUIDANCE} from './harness.mjs';
import {DocumentExtras} from './document-extras.mjs';
import {WorkbookTools} from './workbook-tools.mjs';
import {TextTools} from './text-tools.mjs';
import {KnowledgeTools} from './knowledge-tools.mjs';
import {DeliveryTools} from './delivery-tools.mjs';
import {AudioTools} from './audio-tools.mjs';
import {SourceRecordTools} from './source-record-tools.mjs';
import {settleDelivery} from './delivery-settlement.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node v8-tools/run.mjs <operator-config.json>');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
if(config.chat?.apiKeyEnv){if(!process.env[config.chat.apiKeyEnv])throw Error('Configured model credential environment variable is missing');config.chat.apiKey=process.env[config.chat.apiKeyEnv];}
const isCloud=config.chat?.provider==='cloud'||config.chat?.provider==='siliconflow';
if(isCloud&&!['public','synthetic','private_metadata_only'].includes(config.inputClassification))throw Error('CLOUD_SCOPE_DENIED: host must classify authorized cloud inputs');
if(isCloud&&config.inputClassification==='private_metadata_only'){if(config.asr?.provider!=='local')throw Error('Private audio requires local ASR');config.asr.exposeTranscriptToPlanner=false;}
if (!config.request || !config.chat?.baseUrl || !config.chat?.model) throw new Error('Configure request and chat connection');
const directory = path.resolve(config.directory);
fs.mkdirSync(path.dirname(directory), {recursive:true});
const documents = new DocumentTools({...config, directory});
documents.privateAudioMetadataOnly=isCloud&&config.inputClassification==='private_metadata_only';
if(isCloud&&config.inputClassification==='private_metadata_only'&&[...documents.assets.values()].some(a=>a.kind!=='audio'))throw Error('CLOUD_SCOPE_DENIED: metadata-only scope supports audio inputs only');
const texts=new TextTools(documents);
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const timer = setTimeout(() => controller.abort(), config.timeoutMs || 600000);
const extras = new DocumentExtras(documents,{...config,sourceConstraints:config.sourceConstraints!==false});
const workbooks = config.workbookTools ? new WorkbookTools(documents,extras,config) : null;
const knowledge=new KnowledgeTools(documents,texts,config),delivery=new DeliveryTools(documents,extras,texts),audio=new AudioTools(documents,delivery,config);
const records=new SourceRecordTools(documents,extras,texts);
const harness = new ToolHarness({directory, tools: [...documents.tools(),...texts.tools(),...extras.tools(),...(workbooks?.tools()||[]),...knowledge.tools(),...delivery.tools(),...audio.tools(),...records.tools()], maxCalls: config.maxCalls || 24, maxVisibleTools:config.maxVisibleTools||12, maxNoProgress:config.maxNoProgress||5,signal:controller.signal});
try {
  const result = await runToolAgent({harness, next:chatApi({...config.chat,logDirectory:path.join(directory,'model-responses')}), request:config.request, guidance:(config.focusedGuidance?FOCUSED_DOCUMENT_GUIDANCE+'\n':'')+TOOL_SOURCE_GUIDANCE, maxRounds:config.maxRounds || 16, context:{materials:[...documents.assets.values()].map(a=>documents.publicAsset(a)),visionLimits:{maxImageBytes:config.vision?.maxImageBytes || 5242880}},finalizeAnswer:(answer,run)=>settleDelivery({docs:documents,extras,records},answer,run)});
  console.log(JSON.stringify({status:result.status,calls:result.calls,answer:result.answer,report:path.join(directory,'agent-run.json')},null,2));
} catch (error) {
  fs.writeFileSync(path.join(directory,'run-error.json'),JSON.stringify({code:error.code||'RUN_FAILED',message:error.message,contentVerified:false},null,2));
  console.error(error.message);process.exitCode=1;
} finally { clearTimeout(timer);fs.writeFileSync(path.join(directory,'final-status.json'),JSON.stringify({...documents.status(),audio:audio.status()},null,2)); }
