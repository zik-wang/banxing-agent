import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
/** Writes verification next to the exact OCR input. All paths originate in a
 * local runtime receipt, and every crop is hash-checked before the write. */
export function finalizeRoiEvidence(document){
 const receiptPath=document.recovery?.localOcrReceipt;if(!receiptPath)return [];
 const root=path.dirname(receiptPath),receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8')),outputs=[];
 if(receipt.fileId!==document.fileId||receipt.originalSha256!==document.originalSha256)throw Error('ROI receipt document mismatch');
 for(const p of receipt.pages.filter(p=>p.region)){
  const actual=path.resolve(root,p.inputName);if(!actual.startsWith(path.resolve(root)+path.sep))throw Error('ROI path outside receipt');
  const sha=createHash('sha256').update(fs.readFileSync(actual)).digest('hex');if(sha!==p.sha256)throw Error('ROI crop hash changed');
  const fields=p.region.fields.map(field=>({field,before:document.recovery.before[field],after:document.fields[field],result:document.recovery.fieldResults?.find(r=>r.fieldType===field),issues:document.issues.filter(i=>i.field===field),candidateIds:document.candidates.filter(c=>c.raw?.field===field).map(c=>c.id)}));
  const output={roiId:p.region.id,ocrCallId:receipt.id,originalSha256:document.originalSha256,cropSha256:sha,page:p.page,pageIndex:p.region.pageIndex,inputWidth:p.width,inputHeight:p.height,locatorMethod:p.region.locatorMethod,precision:p.region.precision,fields,independentReader:false,correctness:'Requires independent reference or human review; geometric anchor is not truth'};
  const dest=path.join(path.dirname(actual),'verification.json');fs.writeFileSync(dest,JSON.stringify(output,null,2));outputs.push(dest);
 }
 return outputs;
}
