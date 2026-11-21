const {chromium}=require('../../QiHuoAutoChess/WebNext/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.V4_QA_BASE||'http://127.0.0.1:8808',out=path.resolve(__dirname,'../qa-output');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/31125/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base);await page.waitForFunction(()=>document.body.classList.contains('shell-ready'));
  await page.locator('#sidebar-settings').click();await page.locator('.settings-nav [data-page="workbench"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-scene]').length===28);
  for(let n=21;n<=28;n++)assert.equal(await page.locator('[data-scene="'+n+'"]').count(),1);
  await page.locator('[data-scene="21"]').click();await page.locator('#wb-sample').click();
  await page.waitForFunction(()=>document.querySelectorAll('#wb-files [data-wb-file]:checked').length===2);
  await page.reload();await page.waitForFunction(()=>document.body.classList.contains('shell-ready'));
  await page.locator('#sidebar-settings').click();await page.locator('.settings-nav [data-page="workbench"]').click();
  await page.waitForFunction(()=>document.querySelector('#wb-scene-number').textContent.includes('21'));
  await page.locator('[data-scene="23"]').click();await page.locator('#wb-sample').click();
  await page.waitForFunction(()=>document.querySelectorAll('#wb-files [data-wb-file]:checked').length===2);
  await page.locator('#wb-rules').fill('按订单编号核对金额和状态，逐行计算差异及重复，不覆盖原数据');
  await page.locator('#wb-run').click();
  const until=Date.now()+150000;let job;
  while(Date.now()<until){const state=await(await page.request.get(base+'/api/workspace')).json();job=state.jobs.find(j=>j.scenarioId==='23');if(job&&!['queued','running'].includes(job.status))break;await page.waitForTimeout(500);}
  assert(job?.workResult,job?.error||'No result');assert.equal(job.workResult.metrics.amountDifference,'-2.80');assert.equal(job.workResult.duplicates.length,1);
  const artifact=job.artifacts.find(a=>a.name.endsWith('-结构化结果.json'));assert(artifact);
  const downloaded=await(await page.request.get(base+'/api/jobs/'+job.id+'/artifacts/'+artifact.id)).json();assert.equal(downloaded.metrics.leftTotal,'5.50');
  await page.waitForTimeout(1200);await page.screenshot({path:path.join(out,'v4-work-scenarios-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'v4-work-scenarios-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);const report={passed:true,registeredScenarios:28,newScenariosVisible:8,selectionRestoresAfterRefresh:true,actualQwenReconciliation:true,amountDifference:'-2.80',duplicateGroups:1,resultDownloadedAndVerified:true,mobileOverflow:false,errors};
  fs.writeFileSync(path.join(out,'v4-work-scenarios-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
