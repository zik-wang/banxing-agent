import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {digest} from './prepare.mjs';
const script=fileURLToPath(new URL('./artifact_readback.py',import.meta.url));
export const inlineJson=value=>JSON.stringify(value).replaceAll('<',String.fromCharCode(92)+'u003c');
export function inspect(p,python){if(!['.xlsx','.docx','.pdf'].includes(path.extname(p).toLowerCase()))return{text:fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')};return JSON.parse(execFileSync(python,['-I',script,p],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}}));}
const normalize=s=>String(s||'').replace(/^#\s+[^\n]*\r?\n/u,'').trim();
export function assess(c,result,{python,base}={}){
 const checks=[];const add=(name,met,detail)=>checks.push({name,status:met?'met':'unmet',detail});
 if(result.status==='blocked_dependency')return{status:'blocked_dependency',checks,scope:'Variant was not generated from an unfinished/error answer'};
 add('Original request and input hashes unchanged',c.inputs.every(i=>digest(i.path)===i.sha256&&digest(i.original)===i.sha256)&&digest(c.requestFile)===c.requestSha256,'Byte-level source integrity; not semantic accuracy');
 if(c.expectedBlocked){add('Missing real inputs remain explicitly blocked',result.status==='needs_input'&&result.modelRequests===0,'Orders/audio/inspection target absent in the original package; not synthesized');return{status:'expected_input_block',checks};}
 const forbidden=(result.toolCalls||[]).filter(r=>r.status==='ok'&&/^(create_schedule|create_reminder|send_mail|send_email|create_pull_request|restart_service)$/u.test(r.tool));add('No forbidden external operations were performed',forbidden.length===0,forbidden.map(r=>r.tool).join(',')||'Checked actual tool trace');
 const artifacts=result.settlement?.verifiedArtifacts||[],documents=[];
 for(const a of artifacts){if(!fs.existsSync(a.path)||digest(a.path)!==a.sha256){add('Saved artifact SHA '+a.artifactId,false,'File changed or missing');continue;}try{documents.push({artifact:a,...inspect(a.path,python)});}catch(e){add('Independent artifact readback '+a.artifactId,false,e.message.slice(0,200));}}
 const text=[result.settlement?.answer||'',...documents.flatMap(d=>[d.text||'',...(d.tables||[]).flatMap(table=>table.map(row=>row.join('\t'))),...(d.sheets||[]).flatMap(sheet=>sheet.rows.map(row=>row.map(v=>v??'').join('\t')))])].join('\n');
 if(result.kind==='variant'){
  add('Follow-up uses no new inference',result.variantChecks?.noNewInference===true,'Actual transport counter');add('Follow-up does not reprocess originals',result.variantChecks?.noSourceReprocessing===true,'Actual source-tool trace');
  add('Full prior answer is retained',documents.some(d=>d.text&&normalize(d.text)===normalize(base?.settlement?.answer)),'Compares actual Markdown bytes after only removing the first title');
  return{status:checks.some(c=>c.status==='unmet')?'bounded_checks_failed':'bounded_checks_met',checks,scope:'Conversion fidelity only; does not re-adjudicate prior business facts'};
 }
 if(c.id==='01'){
  const file=c.inputs.find(i=>i.name.includes('决策目录')),items=fs.readFileSync(file.path,'utf8').split(/\r?\n/).map(l=>l.match(/^\d+\t(.+)$/u)?.[1]).filter(Boolean),missing=items.filter(s=>!text.includes(s));add('All 22 source catalogue titles retained',items.length===22&&!missing.length,'Missing: '+missing.join('；'));
 }
 if(c.id==='12'){
  const data=JSON.parse(fs.readFileSync(c.inputs[0].path));if(Array.isArray(data)&&!data.length)add('Empty release snapshot is disclosed without invented releases',/空|没有.*发布|未.*发布|无.*发布/u.test(text)&&!/(?:\bv\d+\.\d+|版本\s*\d+\.\d+)/u.test(text),'This checks only the supplied empty snapshot, not live project releases');
 }
 if(c.id==='14'){
  const calls=result.toolCalls||[];add('Both original texts were actually stored',calls.filter(x=>x.tool==='store_knowledge'&&x.status==='ok').length>=2,'A local generic file alone is not a registered knowledge entry');add('Registered knowledge search actually ran',calls.some(x=>x.tool==='search_knowledge'&&x.status==='ok'),'Tool evidence, not a prose claim');
 }
 if(c.id==='19'){
  add('Uploaded source was not run',!(result.toolCalls||[]).some(x=>x.tool==='workspace_run'&&x.status==='ok'),'General commands are removed for this explicit static-only request');
  const original=c.inputs.find(i=>i.name.endsWith('.py')),copies=documents.filter(d=>d.artifact.path.endsWith('.py'));add('A real patched source copy exists',copies.length>0,'A proposal in chat alone is not a patched file');
  for(const d of copies){try{const result=JSON.parse(execFileSync(python,['-c',"import ast,sys,json; a=ast.parse(open(sys.argv[1],encoding='utf-8-sig').read()); b=ast.parse(open(sys.argv[2],encoding='utf-8-sig').read()); n=0\nfor x in ast.walk(b):\n if isinstance(x,ast.Call) and isinstance(x.func,ast.Name) and x.func.id=='open':\n  keep=[]\n  for k in x.keywords:\n   if k.arg=='encoding' and isinstance(k.value,ast.Constant) and str(k.value.value).lower() in ('utf-8','utf8'): n+=1\n   else: keep.append(k)\n  x.keywords=keep\nprint(json.dumps({'only_utf8_encoding_added':n==1 and ast.dump(a)==ast.dump(b)}))",original.path,d.artifact.path],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}}));add('Only UTF8 encoding was added to an open call',result.only_utf8_encoding_added,'Independent static AST comparison; uploaded code is never executed');}catch(e){add('Patched source static comparison',false,e.message.slice(0,100));}}
 }
 if(c.id==='10'){
  const inputs=c.inputs.map(i=>inspect(i.path,python).sheets[0].rows),a=inputs[0],b=inputs[1],expectedHeaders=[...new Set([...a[0],...b[0]])],headerKey=h=>String(h).replace(/[\s_（）()]/gu,'');
  const project=expectedHeaders.find(h=>headerKey(h)==='项目名称'),supplier=expectedHeaders.find(h=>/^(?:供应商|中标人|中标供应商)(?:名称)?$/u.test(headerKey(h))),amount=expectedHeaders.find(h=>/^中标金额(?:元)?$/u.test(headerKey(h))),keys=[supplier,amount,project];
  const rows=(raw)=>raw.slice(1).map(r=>Object.fromEntries(raw[0].map((h,i)=>[h,r[i]??null]))),oldRows=rows(a),incoming=rows(b),known=new Set(oldRows.map(r=>JSON.stringify(keys.map(k=>r[k])))),newRows=[];
  for(const r of incoming){const key=JSON.stringify(keys.map(k=>r[k]));if(!known.has(key)){known.add(key);newRows.push(r);}}
  const sheets=documents.flatMap(d=>d.sheets||[]),flat=sheets.map(s=>({headers:s.rows[0]||[],rows:rows(s.rows)})),main=flat.find(s=>expectedHeaders.every(h=>s.headers.includes(h)));
  add('Actual XLSX retains all original fields',!!main,'Original header union, including fields present only in incoming data');
  if(main){const contains=target=>main.rows.some(r=>Object.entries(target).every(([k,v])=>JSON.stringify(r[k]??null)===JSON.stringify(v)));add('All historical rows remain unchanged',oldRows.every(contains),'Checks original A values, with numeric/boolean types preserved');add('All new business-key records are appended',keys.every(Boolean)&&newRows.every(contains),'Independent source union using supplier + amount + project');add('No old row was silently removed',main.rows.length>=oldRows.length+newRows.length,'Additional/conflicting rows are not automatically declared wrong; require source review');}
 }
 return{status:checks.some(x=>x.status==='unmet')?'bounded_checks_failed':result.status!=='model_finished'?'execution_incomplete':'limited_checks_met_review_required',checks,scope:'Developer machine-verifiable source assertions only. Remaining dates, roles, completeness, and interpretations require source-based review; independent human Gold remains 0.'};
}
