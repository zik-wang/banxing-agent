// Keep available slots working without crossing stage, call or time budgets.
export async function runBoundedBatches(batches,execute,{canStart=()=>true,concurrency=2,signal}={}){
 if(!Array.isArray(batches)||typeof execute!=='function'||!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('Invalid bounded recovery queue');
 let cursor=0,stopped=false;const failures=[];
 const worker=async()=>{for(;;){if(stopped||signal?.aborted)return;try{if(!canStart())return;const index=cursor++;if(index>=batches.length)return;await execute(batches[index],index);}catch(error){failures.push(error);stopped=true;return;}}};
 await Promise.all(Array.from({length:Math.min(concurrency,batches.length)},()=>worker()));
 return failures;
}
