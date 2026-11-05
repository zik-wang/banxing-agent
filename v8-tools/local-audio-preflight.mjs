// Local transcription is a host action. Private media and its transcript never
// need to enter the cloud planner just to obtain the original transcript file.
export function registeredAudioTools(audio,config){return audio.tools().filter(t=>!config.externalWorkspace||config.asr?.provider==='local'||t.name!=='transcribe_audio');}
export async function localAudioPreflight({docs,audio,harness,config,request}){
 const originals=[...docs.assets.values()].filter(a=>a.id===a.sourceId);
 if(config.asr?.provider!=='local'||!originals.length||originals.some(a=>a.kind!=='audio'))return null;
 if(!/(?:转写|转录|语音转文字|transcrib|transcription)/iu.test(request))return null;
 docs.privateAudioMetadataOnly=true;audio.config.exposeTranscriptToPlanner=false;
 if(harness.tools instanceof Map){
  const missing=['inspect_media','split_audio','transcribe_audio','export_document'].filter(name=>!harness.tools.has(name));
  if(missing.length)return {failed:true,reason:'local_audio_tools_unavailable',localOnly:true,cloudModelCalls:0,missingTools:missing,message:'本地录音处理功能未完整加载，尚未开始识别。原录音已保留，无需重新上传；请检查本地转写工具配置后重试。录音及识别正文没有发送公网模型。'};
 }
 const run=async(name,args)=>{const r=await harness.execute(name,args);if(r.status!=='ok')throw Object.assign(Error(r.error?.message||'本地识别工具失败'),{code:r.error?.code||'LOCAL_AUDIO_FAILED'});return r.data;};
 const resultIds=[];
 for(const original of originals){
  const inspected=await run('inspect_media',{asset_id:original.id});let ids=[original.id];
  if(inspected.needsSplit){await run('split_audio',{asset_id:original.id,segment_seconds:90});ids=[...docs.assets.values()].filter(a=>a.parentId===original.id&&a.kind==='audio').map(a=>a.id);}
  if(!ids.length)throw Error('本地切段未返回可读取片段');
  let last;
  for(let i=0;i<ids.length;i+=12)last=await run('transcribe_audio',{asset_ids:ids.slice(i,i+12),language:'Chinese'});
  if(last?.resultId)resultIds.push(last.resultId);
 }
 if(resultIds.length!==originals.length)throw Error('本地识别未返回可导出的逐文件结果');
 const requested=docs.requestedFormats?.filter(f=>['txt','srt','docx','md'].includes(f))||[];
 const formats=[...new Set(requested.length?requested:['txt','srt'])];
 for(const format of formats)await run('export_document',{title:'录音转写原文_未经人工核听',format,result_ids:resultIds});
 const coverage=audio.status(),sources=coverage.sources||[];
 const complete=sources.length===originals.length&&sources.every(s=>s.allSegmentTextReturned&&s.segmentationDurationConsistent);
 return {completed:complete,failed:!complete,reason:complete?undefined:'local_audio_incomplete',message:(complete?'本地转写稿已生成，可在下方下载。':'已保存本地取得的转写稿，但仍有缺段或时长疑点，请查看执行记录。')+'\n\n录音及识别正文没有发送公网模型。全部文字未经人工逐词核听，不能作为已核实的会议事实；专业术语、数字与相对日期需要回听。字幕时间来自输入分段范围，不是逐词对齐。\n\n如需按主题剪辑，请确认具体时间范围后继续。',coverage,localOnly:true,cloudModelCalls:0};
}
