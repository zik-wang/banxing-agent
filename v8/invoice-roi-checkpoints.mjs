import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
/** Salvage only completed, hash-matched local ROI checkpoints. A missing or
 * failed ROI remains a failed page; nothing is synthesized from the filename. */
export function readInvoiceOcrCheckpoints(inputs,model){
 const pages=[],records=[];
 for(const [index,input]of inputs.entries()){
  let checkpoint;const file=path.join(path.dirname(input.path),'worker-output.json');
  try{const bytes=fs.readFileSync(file);if(bytes.length>8*1024*1024)throw Error('Checkpoint too large');checkpoint=JSON.parse(bytes);
   if(checkpoint.version!=='v7-roi-checkpoint-1'||checkpoint.model!==model||checkpoint.roiId!==input.roiId||checkpoint.page!==input.page||checkpoint.inputSha256!==hash(fs.readFileSync(input.path))||!Array.isArray(checkpoint.records)||typeof checkpoint.text!=='string')throw Error('Checkpoint provenance mismatch');
   for(const b of checkpoint.records)if(!Array.isArray(b.bbox)||b.bbox.length!==4||b.bbox.some(v=>!Number.isFinite(v)||v<0||v>1)||b.bbox[0]>=b.bbox[2]||b.bbox[1]>=b.bbox[3])throw Error('Invalid checkpoint bbox');
   records.push(...checkpoint.records.map(b=>({...b,page:input.page,inputIndex:index,roiId:input.roiId,region:input.region})));
   pages.push({page:input.page,inputIndex:index,roiId:input.roiId,text:checkpoint.text,status:checkpoint.text.trim()?'returned':'failed',error:checkpoint.error||null,fromCompletedCheckpoint:true});
  }catch(e){pages.push({page:input.page,inputIndex:index,roiId:input.roiId,text:'',status:'failed',error:fs.existsSync(file)?'checkpoint_invalid':'no_completed_checkpoint',fromCompletedCheckpoint:false});}
 }
 const content=pages.map(p=>p.text).join('\n\n');if(content.length>60000||records.length>1500)throw Error('Completed checkpoints exceed OCR output budget; retained without truncation');if(!content.trim())throw Error('No completed valid local ROI checkpoint; original failure retained');
 return {ok:true,content,pages,records,model,partial:true,restoredFromCheckpoints:true};
}
