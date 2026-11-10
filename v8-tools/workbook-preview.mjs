import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Native graphics drivers can abort the process, bypassing JavaScript catch.
// Optional previews must never run inside the delivery/registry process.
export async function renderWorkbookPreview(request, {signal, timeoutMs=20000, workerPath=fileURLToPath(import.meta.url)}={}) {
  const started=Date.now();
  return new Promise(resolve=>{
    let child, stderr='', reason=null, finished=false, timer;
    const finish=(code, exitSignal)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      let valid=false;
      try { const b=fs.readFileSync(request.output);valid=b.length>24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); } catch {}
      const ok=code===0&&!reason&&valid;
      resolve({ok,path:ok?request.output:null,elapsedMs:Date.now()-started,...(!ok?{error:{code:reason||(code===0?'PREVIEW_OUTPUT_INVALID':'PREVIEW_PROCESS_FAILED'),exitCode:code,signal:exitSignal||null,message:stderr.trim().slice(-4000)||'Optional workbook preview unavailable; saved workbook remains available.'}}:{})});
    };
    const abort=()=>{reason='PREVIEW_CANCELLED';child?.kill();};
    if(signal?.aborted){reason='PREVIEW_CANCELLED';finish(null,null);return;}
    try {
      child=spawn(process.execPath,[workerPath,'--preview-worker'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
      child.stdin.on('error',()=>{});
      child.on('error',e=>{reason='PREVIEW_START_FAILED';stderr=e.message;finish(null,null);});
      child.on('close',finish);
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{reason='PREVIEW_TIMEOUT';child.kill();},timeoutMs);
      child.stdin.end(JSON.stringify(request));
    } catch(e){reason='PREVIEW_START_FAILED';stderr=e.message;finish(null,null);}
  });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]&&process.argv[2]==='--preview-worker') {
  try {
    let input='';for await(const part of process.stdin)input+=part;
    const r=JSON.parse(input);
    const {FileBlob,SpreadsheetFile}=await import(pathToFileURL(r.artifactModule).href);
    const book=await SpreadsheetFile.importXlsx(await FileBlob.load(r.input));
    const blob=await book.render({sheetName:r.sheetName,range:r.range,scale:1,format:'png'});
    fs.writeFileSync(r.output,new Uint8Array(await blob.arrayBuffer()));
  } catch(e){console.error(e.stack||e.message);process.exitCode=1;}
}
