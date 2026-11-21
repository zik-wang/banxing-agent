const {chromium}=require('../../QiHuoAutoChess/WebNext/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/31125/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8801/');await page.locator('[data-scene="04"]').waitFor();await page.locator('[data-page="chat"]').click();
  const marker='聊天界面验证_'+Date.now(),message='这是界面测试。请只回复“测试通过”，不要调用工具。'+marker;
  await page.locator('#message').fill(message);await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#message').value==='');
  let run;const deadline=Date.now()+90000;
  do{const state=await (await page.request.get('http://127.0.0.1:8801/api/state')).json();run=state.runs.find(r=>r.request.includes(marker));if(run&&run.status!=='running')break;await page.waitForTimeout(500);}while(Date.now()<deadline);
  assert(run);assert(!run.error);assert.equal(run.status,'done');assert(run.answer.trim().length>0);
  await page.waitForFunction(()=>!document.querySelector('#send').disabled);assert.equal(await page.locator('#message').inputValue(),'');assert.deepEqual(errors,[]);
  const report={passed:true,realIntranetChat:true,answerReceived:true,inputCleared:true,sendRecovered:true,browserErrors:errors};fs.writeFileSync(path.resolve(__dirname,'../qa-output/v3-chat-live-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
