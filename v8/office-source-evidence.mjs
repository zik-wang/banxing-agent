import {assertConversationAttachment} from './attachment-context.mjs';

// Reuse cached parsed text, never guess Recipient from Bill To / buyer.
export function recipientEvidence(store,conversationId,scope=[]){
 const records=[];
 for(const source of scope){
  const f=assertConversationAttachment(store,conversationId,source.id);
  if(f.sha256!==source.sha256)throw Error('成果来源版本已变化');
  const lines=String(f.content||'').split(/\r?\n/),recipients=[],numbers=[];
  lines.forEach((line,index)=>{let m;if((m=/^\s*(?:Recipient|收件人|收票人)\s*[:：]\s*(\S.*?)\s*$/i.exec(line)))recipients.push({value:m[1],line:index+1});if((m=/^\s*(?:Invoice\s+(?:Number|No\.?)|发票号码|票据号码|账单编号)\s*[:：]\s*(\S.*?)\s*$/i.exec(line)))numbers.push(m[1]);});
  // Multiple identities in a source need explicit disambiguation.
  if(recipients.length!==1||new Set(numbers).size>1)continue;
  records.push({fileId:f.id,fileName:f.name,invoiceNumber:numbers[0]||null,value:recipients[0].value,sourceId:`${f.id}:${f.sha256}:L${recipients[0].line}`,status:'explicit_source_label'});
 }
 return records;
}
