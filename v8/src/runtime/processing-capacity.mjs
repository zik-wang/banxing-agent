// Application-side work budgets. Provider context and permission boundaries are
// independent of this multiplier; Excel has its own DELIVERY_TABLE_LIMITS.
export const PROCESSING_CAPACITY_VERSION='v7-capacity-2.5-1';
export const PROCESSING_MULTIPLIER=2.5;
export const scaledLimit=value=>{
 if(!Number.isFinite(value)||value<0)throw Error('处理额度必须是非负有限数值');
 return Math.ceil(value*PROCESSING_MULTIPLIER);
};
export const PROCESSING_LIMITS=Object.freeze({
 historyTurns:scaledLimit(4),historyAnswerChars:scaledLimit(2000),
 requestChars:scaledLimit(5000),intentChars:scaledLimit(8000),
 inlineTextChars:scaledLimit(8000),textPageChars:scaledLimit(16000),
 parsedTextChars:scaledLimit(60000),originalTextBytes:scaledLimit(2*1024*1024),
 chatRounds:scaledLimit(7),chatToolCalls:scaledLimit(12),
 chatOutputTokens:scaledLimit(3500),visualOutputTokens:scaledLimit(6000),
 analysisOutputTokens:scaledLimit(6500),analysisContextTokens:scaledLimit(28000),
 modelTimeoutMs:scaledLimit(180000),chatTimeoutMs:scaledLimit(120000),
 ocrPages:scaledLimit(10),audioSeconds:scaledLimit(500),
 attachmentCount:scaledLimit(20),fileBytes:scaledLimit(20*1024*1024),
 // The current adapter advertises 128K; the company /v1/models reports 131072.
 // Neither is raised merely because more application work is allowed.
 adapterContextTokens:128000,contextReserveTokens:8192,
 parallelTools:1,analysisConcurrency:2
});
export function contextBudget(requested,outputTokens,window=PROCESSING_LIMITS.adapterContextTokens){
 return Math.min(requested,window-outputTokens-PROCESSING_LIMITS.contextReserveTokens);
}
