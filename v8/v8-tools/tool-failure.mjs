import {safeModelError} from './model-transport.mjs';
const transient=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
// Only observational readers can be retried after an ambiguous network failure.
// Writes may already have taken effect; their existing receipt/recovery path owns retry.
const readers=new Set(['vision_extract','extract_pdf_text','read_text_range','read_json_range','read_word_document','read_workbook','read_artifact','read_result','read_source_records','search_document','inspect_material','inspect_media','list_materials','processing_status','search_knowledge','retrieve_policy','retrieve_legal_sources']);
export function originalToolError(error){return safeModelError(error,text=>String(text).replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/([?&](?:api[_-]?key|access_token|token|skey)=)[^&\s]+/gi,'$1[REDACTED]').replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi,'$1[REDACTED]@'));}
export function isToolNetworkFailure(error,seen=new Set()){
 if(!error||typeof error!=='object'||seen.has(error))return false;seen.add(error);
 // Explicit semantic/permission errors never become retryable because their text mentions a network.
 if(error.code&&!transient.has(error.code)&&!['TOOL_FAILED','NETWORK_ERROR','MODEL_NETWORK_ERROR'].includes(error.code))return false;
 return transient.has(error.code)||/^(?:fetch failed|terminated)$/i.test(error.message||'')||isToolNetworkFailure(error.cause,seen)||(error.errors||[]).some(e=>isToolNetworkFailure(e,seen));
}
export const safelyRetryableTool=name=>readers.has(name);
