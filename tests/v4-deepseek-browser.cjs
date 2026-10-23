const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-output','dsh-browser-'+Date.now()),base='http://127.0.0.1:8806';fs.mkdirSync(out,{recursive:true});
const env={...process.env,PORT:'8806',DEMO_DATA_DIR:path.join(out,'data'),UI_QA_URL:base,V4_QA_BASE:base};
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const report={startedAt:new Date().toISOString(),base,isolatedData:true,checks:[]};
(async()=>{try{
  let ready=false;for(let n=0;n<100;n++){try{const r=await fetch(base+'/api/health');const h=await r.json();ready=h.harness?.name==='DeepSeek Harness'&&h.model;if(ready)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('测试服务未就绪：'+log);
  for(const name of ['v3-grok-ui-qa.cjs','v4-team-browser.cjs','v3-excel-browser-qa.cjs']){
    const child=spawn(process.execPath,[path.join('tests',name)],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const code=await new Promise(resolve=>child.on('exit',resolve));fs.writeFileSync(path.join(out,name+'.log'),output);report.checks.push({name,passed:code===0,exitCode:code,output});console.log(JSON.stringify({name,passed:code===0,output}));
  }
}catch(e){report.error=e.message;process.exitCode=1;}finally{report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.checks.length===3&&report.checks.every(x=>x.passed);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'qa-output/dsh-browser-latest.json'),JSON.stringify({out,report:path.join(out,'report.json')}));server.kill();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));if(!report.passed)process.exitCode=1;}})();
