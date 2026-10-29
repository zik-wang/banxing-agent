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
import {Continuity} from './continuity.mjs';
import {ResultTools} from './result-tools.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node v8-tools/run.mjs <operator-config.json>');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
if(config.chat?.apiKeyEnv&&config.continuity?.mode!=='rebuild_delivery'){if(!process.env[config.chat.apiKeyEnv])throw Error('Configured model credential environment variable is missing');config.chat.apiKey=process.env[config.chat.apiKeyEnv];}
const isCloud=config.chat?.provider==='cloud'||config.chat?.provider==='siliconflow';
if(isCloud&&!['public','synthetic','private_metadata_only'].includes(config.inputClassification))throw Error('CLOUD_SCOPE_DENIED: host must classify authorized cloud inputs');
if(isCloud&&config.inputClassification==='private_metadata_only'){if(config.asr?.provider!=='local')throw Error('Private audio requires local ASR');config.asr.exposeTranscriptToPlanner=false;}
const deliveryOnly=config.continuity?.mode==='rebuild_delivery';
if (!config.request || (!deliveryOnly&&(!config.chat?.baseUrl || !config.chat?.model))) throw new Error('Configure request and chat connection');
const continuity=config.continuity?new Continuity(config):null;
if(continuity&&['resume','retry','rebuild_delivery'].includes(continuity.mode)&&config.inputs?.length)throw Error('RESUME_REQUIRES_ORIGINAL_SNAPSHOT_NOT_NEW_INPUTS');
const directory = path.resolve(config.directory);
fs.mkdirSync(path.dirname(directory), {recursive:true});
const documents = new DocumentTools({...config, directory,inputs:config.inputs||[]});
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
continuity?.bind({docs:documents,workbooks,extras,records});
const allTools=[...documents.tools(),...texts.tools(),...extras.tools(),...(workbooks?.tools()||[]),...knowledge.tools(),...delivery.tools(),...audio.tools(),...records.tools(),...new ResultTools(documents,extras,workbooks).tools()];
const harness = new ToolHarness({directory, tools: continuity?continuity.wrap(allTools):allTools, maxCalls: config.maxCalls || 24, maxVisibleTools:config.maxVisibleTools||12, maxNoProgress:config.maxNoProgress||5,signal:controller.signal});
if(continuity){const discovery=harness.tools.get('discover_tools'),original=discovery.execute;discovery.execute=(...args)=>{continuity.spend('tool');return original(...args);};}
try {
  const settle=(answer,run)=>settleDelivery({docs:documents,extras,records},answer,run);
  if(deliveryOnly){const recovered=await continuity.recoverDelivery(settle);console.log(JSON.stringify(recovered,null,2));}
  else {
  const api=chatApi({...config.chat,logDirectory:path.join(directory,'model-responses')});
  const result = await runToolAgent({harness, next:(...args)=>{continuity?.spend('model');return api(...args);}, request:continuity?.originalRequest||config.request, guidance:(config.focusedGuidance?FOCUSED_DOCUMENT_GUIDANCE+'\n':'')+TOOL_SOURCE_GUIDANCE+'\n后续内容修改可用read_artifact读取当前成果、revise_table修订当前tableId，然后导出新版本。artifactId仅供read_artifact/validate_artifact；不是原件assetId。用户要求可下载成果时，实际导出，不只给文字承诺。', maxRounds:config.maxRounds || 16, context:{...(continuity?.context()||{}),...(config.interactionContext?{interactionContext:config.interactionContext}:{}),materials:[...documents.assets.values()].map(a=>documents.publicAsset(a)),visionLimits:{maxImageBytes:config.vision?.maxImageBytes || 5242880}},finalizeAnswer:async(answer,run)=>{const d=await settle(answer,run);if(continuity)d.continuity=continuity.finish(d);return d;}});
  console.log(JSON.stringify({status:result.status,calls:result.calls,answer:result.answer,report:path.join(directory,'agent-run.json')},null,2));
  }
} catch (error) {
  try{const d=await settleDelivery({docs:documents,extras,records},'',{status:'failed',termination:{reason:error.code||'program_error'}});continuity?.finish(d);}catch(settlementError){fs.writeFileSync(path.join(directory,'settlement-error.json'),JSON.stringify({message:settlementError.message}));}
  fs.writeFileSync(path.join(directory,'run-error.json'),JSON.stringify({code:error.code||'RUN_FAILED',message:error.message,contentVerified:false},null,2));
  console.error(error.message);process.exitCode=1;
} finally { clearTimeout(timer);fs.writeFileSync(path.join(directory,'final-status.json'),JSON.stringify({...documents.status(),audio:audio.status()},null,2)); }
