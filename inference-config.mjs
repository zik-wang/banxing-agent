import {createHash} from 'node:crypto';
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());
export const INFERENCE_VERSION='v7-p2-inference-1';
export function inferenceProfile(value={}){
 const supplied=value.inference||{};
 const profile={version:INFERENCE_VERSION,provider:['siliconflow','cloud'].includes(value.provider)?'cloud':value.provider==='qwen'?'intranet':value.provider||'unknown',model_id:value.modelName||value.model||'configured-model',endpoint:value.baseUrl||null,quantization:supplied.quantization||'unknown',inference_backend:supplied.inference_backend||'unknown',chat_template:supplied.chat_template||'unknown',analysis_mode:value.analysisMode||'native-tools',temperature:supplied.temperature??0.1,top_p:supplied.top_p??null,max_output_tokens:supplied.max_output_tokens??6500,context_budget_tokens:supplied.context_budget_tokens??24000,timeout_ms:supplied.timeout_ms??180000,output_constraint:supplied.output_constraint||'prompt-json-and-strict-parser',thinking:'disabled_by_client_adapter',retry_transport:0};
 if(!Number.isFinite(profile.temperature)||profile.temperature<0||profile.temperature>2||profile.top_p!==null&&(!Number.isFinite(profile.top_p)||profile.top_p<=0||profile.top_p>1)||!Number.isInteger(profile.max_output_tokens)||profile.max_output_tokens<256||profile.max_output_tokens>12000||!Number.isInteger(profile.context_budget_tokens)||profile.context_budget_tokens<2048||profile.context_budget_tokens>128000||profile.timeout_ms<1000||profile.timeout_ms>180000)throw Error('推理配置超出允许范围');
 profile.input_projection=supplied.input_projection||'legacy-duplicate-text';
 profile.parameter_support={temperature:'applied',top_p:'not exposed by pinned Harness adapter; null means server default unknown',response_format:'not exposed by pinned Harness adapter; prompt and strict parser only'};
 if(profile.top_p!==null)throw Error('当前Harness适配器未接线top_p，不能假称该配置已生效');
 return profile;
}
export function modelConfigFingerprint(value){return createHash('sha256').update(JSON.stringify(inferenceProfile(value))).digest('hex');}
export function estimateContext(systemPrompt,request,maxOutputTokens){
 // Conservative character upper bound, not a tokenizer or an accuracy estimate.
 return {inputCharacterUpperBound:systemPrompt.length+request.length,outputTokenBudget:maxOutputTokens,isTokenizerBound:false,inputUtf8Bytes:Buffer.byteLength(systemPrompt+request,'utf8'),method:'character-based admission heuristic, not a verified tokenizer bound; actual usage reported separately'};
}
