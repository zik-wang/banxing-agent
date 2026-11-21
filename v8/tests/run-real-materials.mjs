import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/runtime/core.mjs';
import {Harness} from '../src/runtime/runtime.mjs';
import {Workspace} from '../src/workspace/workspace.mjs';
import {ServiceDirectory} from '../src/integrations/intranet.mjs';
import {resolveArtifact} from '../src/documents/artifacts.mjs';

const SRC='D:/pro222/personal-agent-v4/real-materials';
const DATA='D:/pro222/personal-agent-v6/qa-output/real-run-data';
const OUT='D:/pro222/personal-agent-v6/qa-output/real-materials-20261019';
fs.rmSync(DATA,{recursive:true,force:true});
fs.mkdirSync(OUT,{recursive:true});
const store=new Store(DATA);
const directory=new ServiceDirectory();
await directory.refresh().catch(error=>console.error('目录刷新失败',error.message));
const harness=new Harness(store,{directory});
const workspace=new Workspace(store,harness);
const uploaded=new Map();
const notes=[];

function htmlToText(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]+>/g,'\n').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\n[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function put(name,bytes,note){
  const file=await workspace.upload({name,base64:Buffer.from(bytes).toString('base64')});
  uploaded.set(name,file);
  notes.push({name,id:file.id,bytes:file.bytes,chars:file.content.length,truncated:file.truncated,parseStatus:file.parseStatus,parseError:file.parseError,note:note||''});
  console.log('upload',name,file.parseStatus,file.content.length,file.truncated?'truncated':'',file.parseError||'');
  return file;
}
function fromDisk(rel,name=path.basename(rel),note){
  return put(name,fs.readFileSync(path.join(SRC,rel)),note);
}
function fromHtml(rel,name){
  const text=htmlToText(fs.readFileSync(path.join(SRC,rel),'utf8'));
  return put(name,Buffer.from(text),'由已下载 HTML 去掉标签得到，原文仍在 real-materials');
}
function usable(file){return file&&file.content&&!file.truncated&&file.parseStatus==='ready';}

const boston=await fromDisk('01/boston-city-council-2026-schedule.pdf');
const denver=await fromDisk('01/denver-city-council-2026-calendar.pdf');
const opinion=await fromHtml('03/guowuyuan-guofa-2026-7.htm','guofa-2026-7.txt');
const brief428=await fromHtml('04/briefing-2026-04-28.htm','briefing-2026-04-28.txt');
const brief413=await fromHtml('04/briefing-2026-04-13.htm','briefing-2026-04-13.txt');
const brief227=await fromHtml('11/briefing-2026-02-27.htm','briefing-2026-02-27.txt');
const mail=await fromHtml('05/accumulo-fluo-handoff-2025-04-29.html','accumulo-fluo-handoff.txt');
const tender=await fromHtml('06/pbc-070GXH2026096-tender-notice.html','pbc-070-tender-notice.txt');
const correction=await fromHtml('08/pbc-070GXH2026096-correction.html','pbc-070-correction.txt');
const award=await fromDisk('06/pbc-070GXH2026096-award-candidates.pdf');
const invoiceA=await fromDisk('09/jiangsu-digital-invoice-specimen.pdf');
const invoiceB=await fromDisk('09/neimenggu-einvoice-specimen.pdf');
const tax=await fromHtml('09/sta-2024-11-digital-invoice-notice.html','sta-2024-11-notice.txt');
const vllm=await fromDisk('12/vllm-releases.json');
const llama=await fromDisk('12/llama.cpp-releases.json');
const livekit=await fromDisk('13/livekit-agents-README.md');
const funasr=await fromDisk('13/FunASR-README.md');
const cosy=await fromDisk('13/CosyVoice-README.md');
const rdap=await fromDisk('15/apache.org.rdap.json');
const awardJson=await fromDisk('23/usaspending-award-FA872625FB025.json');
const dicp=await fromDisk('16/dicp-electrochem-schedule.pdf');
const esit=await fromDisk('16/esit2026-shanghai-program.pdf');
const code=await fromDisk('19/CSVExporter-pyqtgraph-0.11.0.py');
const issue=await fromDisk('19/pyqtgraph-issue-1081.json');
const credit=await fromDisk('21/pbc-credit-center-virtualization-2306089088.pdf');
const wenyu=await fromDisk('21/beijing-wenyu-software-procurement-2022.pdf');
const accept=await fromHtml('22/puyang-acceptance-body.htm','puyang-acceptance.txt');
const mockito=await fromDisk('26/mockito-issue-3777.json');
const bun=await fromDisk('27/bun-issue-15027.json');
const bunComments=await fromDisk('27/bun-issue-15027-comments.json');
const gitlab=await fromDisk('28/gitlab-onboarding.md');
const search=JSON.parse(fs.readFileSync(path.join(SRC,'10/usaspending-awards-2025-10-01-to-07.json'),'utf8'));
const detail=JSON.parse(fs.readFileSync(path.join(SRC,'23/usaspending-award-FA872625FB025.json'),'utf8'));
const keys=['Award ID','Recipient Name','Award Amount','Description','Start Date','End Date','Awarding Agency'];
const leftRows=search.results.map(row=>Object.fromEntries(keys.map(k=>[k,row[k]])));
const rightRows=[{'Award ID':detail.piid,'Recipient Name':detail.recipient.recipient_name,'Award Amount':detail.total_obligation,'Description':detail.description,'Start Date':detail.period_of_performance.start_date,'End Date':detail.period_of_performance.end_date,'Awarding Agency':detail.awarding_agency.toptier_agency.name}];
const leftTable=await put('usaspending-search-rows.json',Buffer.from(JSON.stringify(leftRows)),'从查询原文 results 抽出的 8 行，列和数值未改');
const rightTable=await put('usaspending-detail-row.json',Buffer.from(JSON.stringify(rightRows)),'从 FA872625FB025 详情原文抽出的 1 行，列名与左侧对齐，数值未改');
let vllmOne=null,llamaOne=null;
if(vllm.truncated){const first=JSON.parse(fs.readFileSync(path.join(SRC,'12/vllm-releases.json'),'utf8'))[0];vllmOne=await put('vllm-first-release.json',Buffer.from(JSON.stringify(first)),'完整发布列表超过 6 万字被拒，这是接口返回的第一条');}
if(llama.truncated){const first=JSON.parse(fs.readFileSync(path.join(SRC,'12/llama.cpp-releases.json'),'utf8'))[0];llamaOne=await put('llama-first-release.json',Buffer.from(JSON.stringify(first)),'完整发布列表超过 6 万字被拒，这是接口返回的第一条');}

const plan=[
 {id:'01',files:[boston,denver],rules:'这两份是公开的市议会日程，不是个人日历或邮件。只根据正文列出能核对的会议时间，缺的留空。'},
 {id:'02',files:[boston],rules:'这是已经公布的会议表，不是双方协商记录。没有对方确认就不要写成已经约好。'},
 {id:'03',files:[opinion,brief428],rules:'意见是会前文件，4月28日吹风会是当场说明。分开上次文件和这次发言，不把建议写成已经办完。'},
 {id:'04',files:[brief428,brief413],rules:'这是官方文字实录，不是录音。只提取原文里写明的事项、人和时间。'},
 {id:'05',files:[mail],rules:'这是公开邮件列表页面的正文。先判断有没有回复，不要把已有回复写成未回复，也不要说已经发出催办。'},
 {id:'06',files:[tender,award],rules:'招标公告和中标候选人公示是同一项目 070GXH2026096。候选人公示不是客户确认邮件，也不是已签合同。'},
 {id:'07',files:[boston,denver,dicp,esit].filter(usable),rules:'按文件里能核对的项目和年月归档。不能确定的放待确认。不要删除原件。'},
 {id:'08',files:[tender,correction],rules:'旧版是招标公告，新版是更正公告。只列原文里的日期和技术条款变化。'},
 {id:'09',files:[invoiceA,invoiceB,tax].filter(usable),rules:'票样如果没有发票号码和价税合计，列入异常，不要编金额。'},
 {id:'11',files:[brief227],rules:'这是部门办理建议提案的公开吹风会，不是个人周报。没有完成证据的不要写成已完成。'},
 {id:'12',files:[vllmOne||vllm,llamaOne||llama].filter(usable),rules:'这是发布接口返回的快照，不是本机已安装版本，也没有性能实测。'},
 {id:'13',files:[livekit,funasr,cosy].filter(usable),rules:'只比较这三份 README 写明的版本、许可和能力。没有运行记录的标成文档宣称。'},
 {id:'14',files:[gitlab,tax].filter(usable),rules:'把这两份公开说明入库，并检索其中的入职或发票原句。'},
 {id:'15',files:[rdap,awardJson].filter(usable),rules:'只提取原文里的到期时间。没有时区的日期不要当成已经可以提醒。不要付款。'},
 {id:'16',files:[dicp,esit].filter(usable),rules:'这是两场公开会议日程，没有机票和酒店。只提取正文里的时间，不编交通耗时。'},
 {id:'19',files:[code,issue].filter(usable),rules:'修 CSVExporter 在未指定编码时按系统默认编码写入失败的问题。before 必须是源码里的唯一原文。不要运行代码，不要创建 PR。'},
 {id:'20',files:[],rules:'只检查固定内网接口。不要重启，不要编 GPU 或磁盘数字。'},
 {id:'21',files:[credit,wenyu].filter(usable),rules:'这两份是不同项目的招标文件。分别提取能核对的需求，模糊处标待确认。'},
 {id:'22',files:[accept,award].filter(usable),rules:'濮阳公示如果写验收合格，就不要改成缺项。候选人公示不是这份验收的交付物。'},
 {id:'23',files:[leftTable,rightTable].filter(usable),rules:'按 Award ID 对上这两张从 USAspending 原文抽出的表，金额用原数字。'},
 {id:'24',files:[tender,correction].filter(usable),rules:'更正公告相对招标公告改了开标时间和技术指标。没有写出的下游负责人和新期限留空。'},
 {id:'25',files:[correction,mail].filter(usable),rules:'只根据原文写阻塞和该找谁。原文没有任务编号或依赖链就不要编。'},
 {id:'26',files:[mockito,mail].filter(usable),rules:'整理交接现状。没有明确接手确认，不要写成已经接手。'},
 {id:'27',files:[bun,bunComments].filter(usable),rules:'按评论时间区分已回复、声称修好和后来仍然复现。仍然复现的不要关闭。'},
 {id:'28',files:[gitlab].filter(usable),rules:'这是制度说明，不是某人的开通回执。没有登录成功或领取记录的，不要写成已经可用。'}
];
plan.push({id:'17',files:[],rules:'',skip:'公开材料里没有运单，未跑。没有查询别人的快递。'});
plan.push({id:'18',files:[],rules:'',skip:'会议录音没有下到，未跑。V6 这一项只接受已核对的 WAV。'});

async function finish(job){
  const started=Date.now();
  while(['queued','running'].includes(job.status)){
    if(Date.now()-started>330000)throw Error('等待超过 330 秒');
    await new Promise(resolve=>setTimeout(resolve,400));
  }
}
const results=[];
for(const item of plan){
  if(item.skip){results.push({id:item.id,status:'not_run',summary:item.skip,artifacts:[]});console.log(item.id,'SKIP',item.skip);continue;}
  const bad=item.files.filter(f=>!usable(f));
  if(item.id!=='20'&&(!item.files.length||bad.length)){
    const summary='材料不能进入这一项：'+(bad.length?bad.map(f=>f.name+' '+((f.parseError)||(f.truncated?'正文超过 6 万字':f.parseStatus))).join('；'):'没有可用文件');
    results.push({id:item.id,status:'blocked',summary,artifacts:[]});console.log(item.id,'BLOCKED',summary);continue;
  }
  try{
    const job=workspace.start({scenarioId:item.id,fileIds:item.files.map(f=>f.id),rules:item.rules});
    console.log(item.id,'started',job.id);
    await finish(job);
    const dir=path.join(OUT,item.id);
    fs.mkdirSync(dir,{recursive:true});
    const artifacts=[];
    for(const artifact of job.artifacts){
      const {bytes}=resolveArtifact(store,job.id,artifact.id);
      fs.writeFileSync(path.join(dir,artifact.name),bytes);
      artifacts.push(artifact.name);
    }
    results.push({id:item.id,status:job.status,summary:job.summary,error:job.error,warnings:job.warnings,artifacts});
    console.log(item.id,job.status,job.summary||job.error);
  }catch(error){
    results.push({id:item.id,status:'error',summary:error.message,artifacts:[]});
    console.log(item.id,'ERROR',error.message);
  }
}
const report={model:harness.modelStatus(),uploads:notes,results,finishedAt:new Date().toISOString()};
fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
const lines=['# V6 对公开材料的实际产出','','数据目录是单独的 qa-output/real-run-data，没有写入 8801 正在用的对话。','', '模型：'+(report.model.configured?report.model.modelName+' @ '+report.model.baseUrl:'未就绪'),''];
for(const row of results)lines.push(`- ${row.id} ${row.status}：${row.summary||row.error||''}${row.artifacts?.length?' → '+row.artifacts.join('、'):''}`);
fs.writeFileSync(path.join(OUT,'产出说明.md'),lines.join('\n'));
console.log('DONE',OUT);
