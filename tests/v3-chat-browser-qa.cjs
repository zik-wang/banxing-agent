const {chromium}=require('../../QiHuoAutoChess/WebNext/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base='http://127.0.0.1:8801',out=path.resolve(__dirname,'../qa-output');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/31125/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const initial=await (await page.request.get(base+'/api/state')).json();
  const mock={...initial,notifications:[],running:[],approvals:[],runs:Array.from({length:10},(_,i)=>({conversationId:initial.conversations[0].id,id:'fixture-'+i,request:'布局测试消息 '+i,status:'done',startedAt:new Date().toISOString(),answer:'仅用于浏览器布局测试。\n'.repeat(18)+'<img src=x onerror=alert(1)>',trace:[{label:'测试步骤',detail:'模拟执行记录'}],turns:1}))};
  let posts=0,fail=false;
  await page.route('**/api/state',route=>route.fulfill({json:mock}));
  await page.route('**/api/chat',async route=>{posts++;await new Promise(r=>setTimeout(r,200));await route.fulfill({status:fail?503:202,json:fail?{error:'模拟连接失败'}:{conversationId:initial.conversations[0].id,id:'fixture-post',request:'测试发送',status:'done',answer:'完成',trace:[],turns:1}});});
  await page.goto(base);await page.locator('[data-scene="04"]').waitFor();await page.locator('[data-page="chat"]').click();
  const checkLayout=async()=>{
   const bounds=await page.evaluate(()=>{const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {send:box('#send'),form:box('#chat-form'),messages:box('#conversation'),height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,bodyHeight:document.documentElement.scrollHeight};});
   assert(bounds.messages.height>100,JSON.stringify(bounds));assert(bounds.send.width>=65);assert(bounds.form.bottom<=bounds.height+1,JSON.stringify(bounds));assert(bounds.send.bottom<=bounds.height+1);assert(!bounds.overflow);assert(bounds.bodyHeight<=bounds.height+1,JSON.stringify(bounds));
  };
  await checkLayout();assert.equal(await page.locator('#conversation img').count(),0);
  await page.evaluate(()=>{const c=document.querySelector('#conversation');c.scrollTop=80;document.querySelector('.trace').open=true;});
  const top=await page.locator('#conversation').evaluate(el=>el.scrollTop);mock.runs[9].trace.push({label:'轮询更新',detail:'测试'});
  await page.waitForTimeout(2700);assert.equal(await page.locator('#conversation').evaluate(el=>el.scrollTop),top);assert(await page.locator('.trace').first().evaluate(el=>el.open));
  await page.locator('#message').fill('保留草稿');await page.waitForTimeout(2500);assert.equal(await page.locator('#message').inputValue(),'保留草稿');
  await page.locator('#message').press('Shift+Enter');assert((await page.locator('#message').inputValue()).includes('\n'));assert.equal(posts,0);
  await page.locator('#message').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(posts,0);
  await page.locator('#message').fill('测试发送');await page.locator('#message').press('Enter');await page.locator('#message').press('Enter');await page.waitForTimeout(500);assert.equal(posts,1);assert.equal(await page.locator('#message').inputValue(),'');
  fail=true;await page.locator('#message').fill('失败时保留');await page.locator('#send').click();await page.waitForTimeout(500);assert.equal(await page.locator('#message').inputValue(),'失败时保留');assert((await page.locator('#toast').innerText()).includes('模拟连接失败'));assert(await page.locator('#send').isEnabled());
  await page.screenshot({path:path.join(out,'v3-chat-desktop.png')});
  for(const width of [390,360]){await page.setViewportSize({width,height:844});await checkLayout();}
  mock.running=[mock.runs[9].id];mock.runs[9].status='running';await page.waitForTimeout(2600);await checkLayout();assert(await page.locator('#cancel').isVisible());assert(await page.locator('#send').isDisabled());
  await page.screenshot({path:path.join(out,'v3-chat-mobile.png')});
  await page.locator('[data-page="workbench"]').click();assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('chat-open')),false);assert(await page.locator('#wb-form').isVisible());assert.deepEqual(errors,[]);
  const report={passed:true,syntheticHistoryOnly:true,desktopAndMobileLayout:true,pollPreservesScrollAndTrace:true,draftPreserved:true,keyboardAndIme:true,duplicateSubmitPrevented:true,errorRecovery:true,runningAndStopLayout:true,browserErrors:errors};fs.writeFileSync(path.join(out,'v3-chat-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
