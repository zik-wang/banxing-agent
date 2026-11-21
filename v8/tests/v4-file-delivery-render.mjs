// Visual QA uses the same intranet LibreOffice service as production, then
// rasterizes every resulting page with the bundled Poppler executable.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {readBinary} from '../multimodal.mjs';
const root=process.env.FILE_DELIVERY_RENDER_ROOT||JSON.parse(fs.readFileSync('qa-output/file-delivery/live-latest.json','utf8')).root;
const out=path.join(root,'render');fs.mkdirSync(out,{recursive:true});const report=[];
const poppler='C:/Users/31125/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe';
for(const file of fs.readdirSync(root).filter(n=>/\.(docx|xlsx|pdf)$/.test(n))){
 let pdf=path.join(root,file);
 if(!file.endsWith('.pdf')){const form=new FormData();form.append('file',new Blob([fs.readFileSync(pdf)]),file);const bytes=(await readBinary(await fetch('http://10.0.0.93:2010/convert/pdf',{method:'POST',body:form,signal:AbortSignal.timeout(90000),redirect:'error'}))).bytes;pdf=path.join(out,file+'.pdf');fs.writeFileSync(pdf,bytes);}
 const prefix=path.join(out,file),r=spawnSync(poppler,['-scale-to','1400','-png',pdf,prefix],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||'PDF渲染失败');report.push({file,pages:fs.readdirSync(out).filter(n=>n.startsWith(file+'-')&&n.endsWith('.png'))});
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,report},null,2));
