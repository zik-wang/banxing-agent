import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {cropBoxToPage} from './invoice-roi.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
/** Read-only evidence reuse. Caller provides actual local receipt paths, never
 * replacement OCR text. File identity and the original model input are checked. */
export function readPriorRegionalEvidence(file,receiptPaths=[]){
 const sources=[],attempts=[];
 if(!Array.isArray(receiptPaths)||receiptPaths.length>20)throw Error('Historical regional receipt budget exceeded');
 for(const receiptPath of [...new Set(receiptPaths)]){
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  if(receipt.originalSha256!==file.sha256||receipt.kind!=='regional_recovery')throw Error('Historical OCR receipt does not match selected original');
  const root=path.dirname(receiptPath),payload=JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8'));
  for(const [index,input]of receipt.pages.entries()){
   if(!input.region)continue;const inputPath=path.resolve(root,input.inputName),relative=path.relative(root,inputPath);
   if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Historical ROI input path escapes receipt');
   if(sha(fs.readFileSync(inputPath))!==input.sha256)throw Error('Historical ROI crop hash mismatch');
   const result=payload.pages[index],region=input.region;
   if(result&&(result.roiId&&result.roiId!==region.id||result.page!==input.page))throw Error('Historical OCR page/ROI mismatch');
   const usable=result?.text?.trim()&&result.status!=='failed';
   attempts.push({roiId:region.id,fields:region.fields,receipt:receiptPath,inputSha256:input.sha256,status:usable?'returned':'failed',newOcrInputs:0});
   if(!usable)continue;
   const indexed=(payload.records||[]).filter(b=>b.inputIndex===index);
   const layoutRecords=region.actualBbox?indexed.map(b=>({...b,pageBbox:cropBoxToPage(b.bbox,region)})):[];
   sources.push({text:result.text,page:input.page,model:payload.model,recognitionRunId:receipt.id,roiId:region.id,ocrCallId:receipt.id,cached:true,targetFields:region.fields,imageRegion:region,layoutRecords,layoutAvailability:region.actualBbox?'indexed_blocks':'legacy_no_verified_block_mapping',ocrReceipt:receiptPath,rawOutputRef:{container:path.join(root,'result.json'),pageIndex:index},readingScope:'historical_regional_same_reader',reuseVerifiedInputSha256:input.sha256});
  }
 }
 return {sources,attempts};
}
