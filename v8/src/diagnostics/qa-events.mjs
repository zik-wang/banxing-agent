// Content-free execution telemetry. No prompts, file bodies, credentials or error text.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
export const executionContext=new AsyncLocalStorage();
export const fingerprint=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
export function errorCode(error){const s=String(error?.message||error||'');return /timeout|超时/i.test(s)?'TIMEOUT':/上限|限额|budget/i.test(s)?'BUDGET_EXHAUSTED':/取消/.test(s)?'CANCELLED':/权限|授权/.test(s)?'ACCESS_BLOCKED':'EXECUTION_FAILED';}
export function emitExecution(stage,status,fields={}){const c=executionContext.getStore();return c?.observer?.emit({eventId:randomUUID(),timestamp:new Date().toISOString(),...c.refs,stage,status,...fields});}
export async function observed(stage,fields,action){const start=performance.now();emitExecution(stage,'started',fields);try{const c=executionContext.getStore(),result=await executionContext.run(c?{...c,refs:{...c.refs,...fields.toolCallId?{toolCallId:fields.toolCallId}:{},...fields.modelCallId?{modelCallId:fields.modelCallId}:{}}}:undefined,action);emitExecution(stage,result?.isError===true?'failed':'completed',{...fields,durationMs:Math.round(performance.now()-start),...(result?.isError===true?{errorCode:'TOOL_RESULT_ERROR'}:{})});return result;}catch(error){emitExecution(stage,'failed',{...fields,durationMs:Math.round(performance.now()-start),errorCode:errorCode(error)});throw error;}}
