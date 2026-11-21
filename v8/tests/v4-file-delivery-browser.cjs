const {chromium}=require('../../QiHuoAutoChess/WebNext/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const base='http://127.0.0.1:8819',out=path.resolve(__dirname,'../qa-output/file-delivery/browser');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Users/31125/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'}),page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],downloads=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(async()=>{const h=await (await fetch('/api/health')).json();return h.model;},null,{timeout:30000});
 const previous=await (await page.request.get(base+'/api/state')).json(),previousIds=previous.chatJobs.map(j=>j.id);await page.locator('#sidebar-new').click();
 await page.locator('#message').fill('根据以下内容制作测试项目周报，生成Word、Excel、PDF三个文件供下载：接口联调已完成，客户验收未安排；张三负责测试报告。费用明细：接口测试128.50元，材料制作71.25元。请包含分工表和费用明细表，保留中文，不编造日期。');await page.locator('#send').click();
 await page.waitForFunction(async ids=>{const s=await (await fetch('/api/state')).json();return s.chatJobs?.some(j=>!ids.includes(j.id)&&j.status==='completed'&&j.artifacts.length===3);},previousIds,{timeout:150000});
 await page.locator('.chat-job-files a').first().waitFor();assert.equal(await page.locator('.chat-job-files a').count(),3);assert.equal(await page.locator('#message').inputValue(),'');
 const state=await (await page.request.get(base+'/api/state')).json(),job=state.chatJobs.find(j=>!previousIds.includes(j.id)&&j.artifacts.length===3);assert(job);
 for(const artifact of job.artifacts){const href=`/api/jobs/${job.id}/artifacts/${artifact.id}`,response=await page.request.get(base+href);assert.equal(response.status(),200);const bytes=await response.body(),ext=artifact.name.split('.').at(-1);assert(response.headers()['content-type'].includes(ext==='pdf'?'application/pdf':ext==='docx'?'wordprocessingml':'spreadsheetml'));assert.match(response.headers()['content-disposition'],/attachment/);const [download]=await Promise.all([page.waitForEvent('download'),page.locator(`a[href="${href}"]`).click()]);const target=path.join(out,download.suggestedFilename());await download.saveAs(target);const saved=fs.readFileSync(target);assert(saved.equals(bytes));downloads.push({name:artifact.name,bytes:saved.length,sha256:createHash('sha256').update(saved).digest('hex'),mime:response.headers()['content-type']});}
 await page.waitForFunction(async()=>{const s=await (await fetch('/api/state')).json();return !s.runs.some(r=>r.status==='running');},null,{timeout:120000});
 await page.screenshot({path:path.join(out,'chat-downloads.png'),fullPage:true});
 await page.evaluate(()=>{const b=document.querySelector('[data-page="workbench"]');if(b)b.click();});await page.waitForTimeout(700);assert.equal(errors.length,0,errors.join('\n'));
 const report={checkedAt:new Date().toISOString(),base,realModel:true,downloads,errors};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(error.stack);throw error;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
