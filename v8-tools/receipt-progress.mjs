import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:'RECEIPT_PROGRESS_CHANGED'});};
// Delivery ranges are control state, never proof of source/semantic completeness.
export class ReceiptProgress{
 constructor(directory,scopeKey){this.file=path.join(directory,'receipt-progress.json');this.scopeKey=scopeKey;this.entries=new Map();if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved.scopeKey!==scopeKey||hash(saved.entries)!==saved.sha256)fail('Historical receipt cursor integrity or scope changed');for(const e of saved.entries)this.entries.set(JSON.stringify([e.callId,e.pointer]),e);}}
 get(callId,pointer=''){const e=this.entries.get(JSON.stringify([callId,pointer]));return e?structuredClone(e):null;}
 record({callId,pointer,receiptSha256,start,end,totalChars}){
  const key=JSON.stringify([callId,pointer]),prior=this.entries.get(key);if(prior&&(prior.receiptSha256!==receiptSha256||prior.totalChars!==totalChars))fail('Historical receipt version changed');
  const before=(prior?.ranges||[]).reduce((n,[a,b])=>n+b-a,0),ranges=[...(prior?.ranges||[]),...(end>start?[[start,end]]:[])].sort((a,b)=>a[0]-b[0]),merged=[];
  for(const [a,b]of ranges){const last=merged.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}
  const deliveredChars=merged.reduce((n,[a,b])=>n+b-a,0),newChars=deliveredChars-before;let nextUnreadOffset=0;for(const [a,b]of merged){if(a>nextUnreadOffset)break;nextUnreadOffset=Math.max(nextUnreadOffset,b);}
  const entry={callId,pointer,receiptSha256,totalChars,ranges:merged,deliveredChars,nextUnreadOffset:nextUnreadOffset<totalChars?nextUnreadOffset:null,resumeOffset:newChars>0?end:prior?.resumeOffset??start,unit:'UTF-16 characters in this receipt pointer',receiptTextFullyReturned:deliveredChars===totalChars};this.entries.set(key,entry);
  const entries=[...this.entries.values()],value={scopeKey:this.scopeKey,entries,sha256:hash(entries)},temp=this.file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,this.file);
  return{...structuredClone(entry),newChars,repeatedRange:end>start&&newChars===0};
 }
 list(){return [...this.entries.values()].map(e=>structuredClone(e));}
}
