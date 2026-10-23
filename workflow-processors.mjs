import ExcelJS from 'exceljs';
import {comparisonPreflight} from './comparison-preflight.mjs';
import {guardInterpretationFields} from './field-relations.mjs';
import {diffArrays} from 'diff';
import {readOriginal,digest,safeName} from './workspace-files.mjs';
import {makeWorkbook,makeDocx,makeZip,writeArtifact} from './artifacts.mjs';
import {coveredAnalysis,coverageMarkdown,transitionMarkdown,writeCoverageArtifacts} from './source-coverage.mjs';
import {renderReliabilityItems,expectDelivery} from './reliability.mjs';

const bounded=(value,max=200)=>Array.isArray(value)?value.slice(0,max):[];
const str=(value,max=5000)=>typeof value==='string'?value.slice(0,max):'';
const sourceOf=(files,id)=>files.find(f=>f.id===id);
const cited=(file,quote)=>!!file&&typeof quote==='string'&&quote.trim().length>=3&&file.content.includes(quote);
const warn=(ctx,message)=>{if(!ctx.job.warnings.includes(message))ctx.job.warnings.push(message);};
function pointOut(ctx,message){warn(ctx,message);ctx.job.softNotices||=[];if(!ctx.job.softNotices.some(n=>n.text===message))ctx.job.softNotices.push({text:message});}
function docs(files){return files.map(f=>({id:f.id,name:f.name,text:f.content}));}
function requireText(files){for(const file of files)if(!file.content||file.truncated)throw new Error(`需要完整文字：${file.name}（${file.parseError||'文件文字缺失或已截断'}）。请补充文字稿或缩小文档。`);if(files.reduce((n,f)=>n+f.content.length,0)>60000)throw new Error('本批文字超过60000字符，请拆分任务');}
function quoteLocation(file,quote){const at=file.content.indexOf(quote);return `${file.name} · 第${file.content.slice(0,at).split('\n').length}行`;}
function done(ctx,summary){ctx.job.summary=summary;ctx.job.status=ctx.job.warnings.length?'partial':'completed';}

export function moneyCents(raw){const s=String(raw).trim().replace(/[￥¥元,，\s]/g,'');if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new Error('金额不是可核验的非负十进制数');const [whole,fraction='']=s.split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(amount>999999999999n)throw new Error('金额超出演示上限');return Number(amount);}
export function verifiedInvoiceAmount(item){
  if(typeof item.amountText!=='string'||typeof item.amountQuote!=='string')throw new Error('合计金额必须提供逐字文字依据');
  const literal=item.amountText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp('(?<![\\d.,])'+literal+'(?![\\d.,])').test(item.amountQuote))throw new Error('金额并非原文完整数值');
  const labeled=[...item.amountQuote.matchAll(/(?:价税合计|小写|含税总额|报销金额|总金额|合计金额)[^\d\n]{0,20}(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/g)].at(-1)?.[1];
  if(!labeled||moneyCents(labeled)!==moneyCents(item.amountText))throw new Error('金额与原文合计字段不一致');return moneyCents(item.amountText);
}
const CN_DIGIT={'零':0,'〇':0,'○':0,'一':1,'壹':1,'二':2,'贰':2,'两':2,'三':3,'叁':3,'四':4,'肆':4,'五':5,'伍':5,'六':6,'陆':6,'七':7,'柒':7,'八':8,'捌':8,'九':9,'玖':9};
const CN_UNIT={'十':10,'拾':10,'百':100,'佰':100,'千':1000,'仟':1000};
const NOTICE_FILL={type:'pattern',pattern:'solid',fgColor:{argb:'FFFDE68A'}};
const NOTICE_FONT={bold:true,color:{argb:'FF9A3412'}};
function cnSection(text){if(!text)return 0;let total=0,current=0,seen=false;for(const ch of text){if(Object.hasOwn(CN_DIGIT,ch)){current=CN_DIGIT[ch];seen=true;}else if(Object.hasOwn(CN_UNIT,ch)){total+=(seen?current:1)*CN_UNIT[ch];current=0;seen=false;}else return null;}return total+current;}
export function chineseMoneyCents(raw){if(typeof raw!=='string'||raw.includes('亿'))return null;let text=raw.trim().replace(/[人民币（）()\s]/g,'').replace(/整|正/g,'').replace(/圆/g,'元');if(!text)return null;const parts=text.split('元');if(parts.length>2)return null;const [yuanPart,frac]=parts.length===2?parts:[text,''];if(parts.length===1&&/[角分]/.test(text))return null;let yuan;if(yuanPart.includes('万')){const bits=yuanPart.split('万');if(bits.length!==2)return null;const high=cnSection(bits[0]),low=cnSection(bits[1]);if(high==null||low==null)return null;yuan=high*10000+low;}else{yuan=cnSection(yuanPart);if(yuan==null)return null;}let cents=yuan*100;if(!frac)return cents;let rest=frac;const jiao=rest.match(/^([零〇○一壹二贰两三叁四肆五伍六陆七柒八捌九玖])角/);if(jiao){cents+=CN_DIGIT[jiao[1]]*10;rest=rest.slice(jiao[0].length);}else if(rest.startsWith('零'))rest=rest.slice(1);if(!rest)return cents;const fen=rest.match(/^([零〇○一壹二贰两三叁四肆五伍六陆七柒八捌九玖])分$/);return fen?cents+CN_DIGIT[fen[1]]:null;}
function labeledMoney(content,source){const found=[...String(content).matchAll(new RegExp('(?:'+source+')[^\\d\\n]{0,16}(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.])','g'))];if(found.length!==1)return null;try{return {raw:found[0][1],cents:moneyCents(found[0][1])};}catch{return null;}}
function quantityAmountCents(qty,price){if(!/^\d+(?:\.\d{1,2})?$/.test(qty))return null;let priceCents;try{priceCents=moneyCents(price);}catch{return null;}const [whole,frac='']=qty.split('.');const prod=(BigInt(whole)*100n+BigInt(frac.padEnd(2,'0')))*BigInt(priceCents);if(prod%100n!==0n||prod/100n>999999999999n)return null;return Number(prod/100n);}
function invalidCalendarDate(text){const m=String(text||'').match(/(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})/);if(!m)return false;const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);if(mo<1||mo>12||d<1||d>31)return true;const dt=new Date(Date.UTC(y,mo-1,d));return dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d;}
export function invoiceSoftIssues(content,totalCents,dateText){const yuan=cents=>'¥'+(cents/100).toFixed(2),issues=[],cols=new Set();
  const net=labeledMoney(content,'不含税金额|金额（不含税）|不含税合计'),tax=labeledMoney(content,'(?<!价)税额');
  if(net&&tax&&net.cents+tax.cents!==totalCents){cols.add(4);issues.push(`不含税金额 ${yuan(net.cents)} 加税额 ${yuan(tax.cents)} 等于 ${yuan(net.cents+tax.cents)}，与价税合计 ${yuan(totalCents)} 相差 ${yuan(Math.abs(net.cents+tax.cents-totalCents))}。`);}
  const upper=String(content).match(/(?:价税合计[（(]大写[）)]|大写)[:：\s]*(?:人民币)?\s*([零〇○一壹二贰两三叁四肆五伍六陆七柒八捌九玖拾十佰百仟千万亿元角分整正圆]+)/);
  if(upper){const parsed=chineseMoneyCents(upper[1]);if(parsed!=null&&parsed!==totalCents){cols.add(4);issues.push(`大写「${upper[1]}」折合 ${yuan(parsed)}，与价税合计 ${yuan(totalCents)} 不一致。`);}}
  for(const match of String(content).matchAll(/数量[:：\s]*(\d+(?:\.\d{1,2})?)[^\n]{0,48}?单价[:：\s]*[￥¥]?(\d[\d,]*(?:\.\d{1,2})?)[^\n]{0,48}?(?<![不含税价合])金额[:：\s]*[￥¥]?(\d[\d,]*(?:\.\d{1,2})?)/g)){const product=quantityAmountCents(match[1],match[2]);let line;try{line=moneyCents(match[3]);}catch{continue;}if(product!=null&&product!==line)issues.push(`数量 ${match[1]} × 单价 ${yuan(moneyCents(match[2]))} = ${yuan(product)}，原文金额写成 ${yuan(line)}。`);}
  if(invalidCalendarDate(dateText)){cols.add(1);issues.push(`开票日期「${dateText}」不是有效日期。`);}
  if(!issues.length)return null;cols.add(8);return {text:issues.join('')+'已按价税合计计入，未从报销合计剔除。',cols:[...cols].sort((a,b)=>a-b)};
}
function paintNoticeCells(sheet,excelRow,columns){const row=sheet.getRow(excelRow);for(const index of columns){const cell=row.getCell(index);cell.style={font:{...NOTICE_FONT},fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFDE68A'}},alignment:{vertical:'top',wrapText:true},numFmt:cell.numFmt};}}
function markWorkbook(book,{sheetName,firstRow,rows,column,noticeRows,widenNotice}){const sheet=book.getWorksheet(sheetName);if(!sheet)return;rows.forEach((notice,i)=>{if(notice)paintNoticeCells(sheet,firstRow+i,notice.cols.map(column).filter(Boolean));});if(widenNotice)sheet.getColumn(9).width=62;if(!noticeRows.length)return;let name='醒目提示';while(book.getWorksheet(name))name+='副本';const extra=book.addWorksheet(name);extra.addRow(['文件','提示','处理']);extra.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};extra.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF9A3412'}};for(const row of noticeRows)extra.addRow([row.file,row.text,'已按价税合计计入，未从报销合计剔除']);extra.getColumn(1).width=28;extra.getColumn(2).width=72;extra.getColumn(3).width=36;extra.eachRow((row,n)=>{row.alignment={vertical:'top',wrapText:true};if(n>1)row.eachCell(cell=>{cell.fill=NOTICE_FILL;cell.font=NOTICE_FONT;});});}
export function paragraphChanges(oldText,newText){
  const a=oldText.replace(/\r\n/g,'\n').split('\n'),b=newText.replace(/\r\n/g,'\n').split('\n');if(a.length>4000||b.length>4000)throw new Error('单份文档超过4000行，请分段比较');
  const changes=diffArrays(a,b,{timeout:4000});if(!changes)throw new Error('差异计算超时，请缩小文档');
  let oldLine=1,newLine=1;const rows=[];
  for(let i=0;i<changes.length;i++){
    const part=changes[i];if(!part.added&&!part.removed){oldLine+=part.count;newLine+=part.count;continue;}
    const removed=part.removed?part.value:[],added=part.added?part.value:changes[i+1]?.added?changes[++i].value:[];
    for(let n=0;n<Math.max(removed.length,added.length);n++)rows.push({type:removed[n]!==undefined&&added[n]!==undefined?'修改':removed[n]!==undefined?'删除':'新增',before:removed[n]??'',after:added[n]??'',oldLine:removed[n]!==undefined?oldLine+n:null,newLine:added[n]!==undefined?newLine+n:null});oldLine+=removed.length;newLine+=added.length;
  }return rows.map(row=>({...row,focus:[[/[￥¥金额价格费用价款万元]|\d+\.\d{2}/,'金额'],[/日期|期限|\d{4}[-年/]\d/,'日期'],[/责任|负责|承担|义务/,'责任'],[/交付|验收|提交|成果/,'交付']].filter(([re])=>re.test(row.before+row.after)).map(([,label])=>label).join('、')||'一般文本'}));
}

export async function meeting(ctx){
  const files=ctx.files;
  for(const file of files)if(file.recognition?.kind==='asr'){
    if(!file.recognition.confirmedAt&&!file.recognition.dispatchedByChat)throw new Error('需要先回听并核对转写稿');
    writeArtifact(ctx.store,ctx.job,safeName(file.name)+'-核对转写稿.txt',Buffer.from(file.content),'transcript');
    writeArtifact(ctx.store,ctx.job,safeName(file.name)+'-原始ASR与修订.json',Buffer.from(JSON.stringify(file.recognition,null,2)),'evidence');
    warn(ctx,file.recognition.confirmedAt?'录音转写经用户核对；时间标识为25秒分段范围，修改文字后不保证逐字对齐。':'转写由对话交给内网语音识别，未经回听核对；人名、金额请抽查。时间标识为分段范围。');
  }
  requireText(files);
  const analysis=await ctx.analyze({kind:'meeting',instruction:ctx.job.rules+'；我的姓名：'+(ctx.job.options.selfName||'未指定')+'。所有结论和行动均需sourceId与逐字quote；负责人或截止日期没明确写则留空。',documents:docs(files),shape:'{"title":"会议主题","decisions":[{"text":"结论","sourceId":"文件id","quote":"原文"}],"actions":[{"title":"行动","owner":"原文中的负责人或空","dueText":"原文截止日期或空","sourceId":"文件id","quote":"包含行动、负责人和日期的原文"}],"unresolved":["待确认的问题"]}'});
  const decisions=[];for(const item of bounded(analysis.decisions)){const file=sourceOf(files,item.sourceId);if(cited(file,item.quote)&&str(item.text))decisions.push({...item,location:quoteLocation(file,item.quote)});else pointOut(ctx,'有结论缺少可核对原文，未写入正式结论。');}
  const actions=[];for(const item of bounded(analysis.actions,50)){const file=sourceOf(files,item.sourceId);if(!cited(file,item.quote)||!str(item.title)){pointOut(ctx,'有行动项缺少原文依据，未加入待确认待办。');continue;}
    const owner=item.owner&&item.quote.includes(item.owner)?str(item.owner,80):'';const dueText=item.dueText&&item.quote.includes(item.dueText)?str(item.dueText,160):'';
    actions.push({id:crypto.randomUUID(),title:str(item.title,140),owner,dueText,quote:item.quote,sourceId:file.id,location:quoteLocation(file,item.quote),dueAt:null,status:'pending'});
  }
  if(!decisions.length&&!actions.length)throw new Error('没有提取到具有原文依据的结论或行动项，请补充有效会议稿');
  ctx.job.actions=actions;ctx.job.analysis={decisions,unresolved:bounded(analysis.unresolved,30).map(x=>str(x,600))};
  const sections=[{heading:'已确认结论',lines:decisions.map((d,i)=>`${i+1}. ${d.text}\n依据：${d.location}\n原文：${d.quote}`)},{heading:'行动项 · 尚未创建待办',lines:actions.map((a,i)=>`${i+1}. ${a.title}\n负责人：${a.owner||'待确认'}；期限：${a.dueText||'待确认'}\n依据：${a.location}\n原文：${a.quote}`)},{heading:'待确认与限制',lines:[...ctx.job.analysis.unresolved,'没有明确时间戳的文字稿仅引用文件行号，不补造时间点。','本地提醒已默认授权；行动范围或提醒时间未明确时仍需补充，不替用户猜测。',...ctx.job.warnings]}];
  writeArtifact(ctx.store,ctx.job,'会议纪要.docx',await makeDocx(str(analysis.title,100)||'会议纪要',sections),'document');
  writeArtifact(ctx.store,ctx.job,'会议纪要.md',Buffer.from(sections.map(s=>'## '+s.heading+'\n\n'+s.lines.join('\n\n')).join('\n\n')),'document');
  writeArtifact(ctx.store,ctx.job,'行动项与来源.json',Buffer.from(JSON.stringify(actions,null,2)),'evidence');
  ctx.job.checks.push({label:'纪要结论与行动均能定位到输入原文',passed:true},{label:'待办创建状态单独记录，未冒充已创建',passed:true});
  ctx.job.summary=`已生成纪要；${actions.length}项行动需补充范围或提醒时间，尚未创建待办。`;ctx.job.status=actions.length?'awaiting_approval':ctx.job.warnings.length?'partial':'completed';
}

export async function organize(ctx){
  const raw=await ctx.analyze({kind:'organize',instruction:ctx.job.rules+'；项目与月份必须有文件名或原文依据，不能确定时留空；只分类，禁止删除原件。',documents:ctx.files.map(f=>({id:f.id,name:f.name,text:f.content.slice(0,1800)})),shape:'{"files":[{"sourceId":"文件id","project":"项目或空","month":"YYYY-MM或空","quote":"支持分类的逐字原文或文件名"}]}'});
  const mapping=[],seen=new Map(),entries=[];
  for(const file of ctx.files){const item=bounded(raw.files).find(x=>x.sourceId===file.id)||{},evidence=typeof item.quote==='string'&&(file.name.includes(item.quote)||file.content.includes(item.quote));
    const project=evidence&&str(item.project,80)&&item.quote.includes(item.project)?safeName(item.project):'待确认项目';
    const month=evidence&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(item.month||'')&&new RegExp(item.month.replace('-','[-年/.]0?')).test(item.quote)?item.month:(file.name+' '+file.content.slice(0,1000)).match(/\b(20\d{2})[-年/.](0?[1-9]|1[0-2])(?:月|[-/.]|\b)/)?.slice(1,3).map((x,i)=>i?x.padStart(2,'0'):x).join('-')||'月份待确认';
    const duplicateOf=seen.get(file.sha256)||null;if(!duplicateOf)seen.set(file.sha256,file.id);
    const target=(duplicateOf?'完全重复/':project+'/'+month+'/')+file.id.slice(0,7)+'_'+safeName(file.name);const bytes=readOriginal(ctx.store,file);entries.push([target,bytes]);mapping.push({sourceId:file.id,original:file.name,target,sha256:file.sha256,duplicateOf,basis:evidence?item.quote:'分类依据不足，保留在待确认目录'});
    if(project==='待确认项目'||month==='月份待确认')pointOut(ctx,'部分文件归属或月份待确认，已保留原件并单独归档。');
  }
  const report=await makeWorkbook([{name:'路径映射',headers:['原文件','新路径','SHA256','完全重复于','分类依据'],rows:mapping.map(m=>[m.original,m.target,m.sha256,m.duplicateOf||'',m.basis])}]);entries.push(['文件清单.xlsx',report],['路径映射.json',Buffer.from(JSON.stringify(mapping,null,2))]);
  const zip=await makeZip(entries);const JSZip=(await import('jszip')).default,opened=await JSZip.loadAsync(zip);for(const m of mapping)if(digest(await opened.file(m.target).async('nodebuffer'))!==m.sha256)throw new Error('归档文件数量或内容核验失败');
  ctx.job.mapping=mapping;writeArtifact(ctx.store,ctx.job,'整理后的文件.zip',zip,'archive');writeArtifact(ctx.store,ctx.job,'文件路径映射.xlsx',report,'spreadsheet');ctx.job.checks.push({label:`${mapping.length}/${ctx.files.length}个文件逐一核对内容哈希，原件可回溯`,passed:mapping.length===ctx.files.length});done(ctx,`已归档${mapping.length}个文件，${mapping.filter(m=>m.duplicateOf).length}个完全重复项单独保存。`);
}

export async function compare(ctx){
  if(ctx.files.length!==2)throw new Error('版本比较需要两份文件，选择顺序为旧版、新版');requireText(ctx.files);const [oldFile,newFile]=ctx.files;
  ctx.log('tool','逐段比较原文',oldFile.name+' → '+newFile.name);const rows=paragraphChanges(oldFile.content,newFile.content);
  const diffRows=rows.map(r=>[r.type,r.oldLine??'',r.newLine??'',r.before,r.after,r.focus]);
  await comparisonPreflight(ctx,rows);
  const coverage=await coveredAnalysis(ctx,{kind:'compare',instruction:'比较旧版与新版，逐项提取有意义的变更。更正公告可能只列变动，不重复旧公告内容不能据此认定条款被删除。技术条款、日期、金额、否定和例外全部逐段核对。status使用changed/unaffected/needs_confirmation。'});
  coverage.raw.items=coverage.raw.items.map(guardInterpretationFields);
  const fieldReviews=coverage.raw.items.filter(i=>i.fieldValidation).map(i=>({key:i.key,candidateId:i.candidateId,owner:i.owner,dueText:i.dueText,modelFieldCandidates:i.modelFieldCandidates,proposedFields:i.proposedFields,...i.fieldValidation}));
  if(fieldReviews.length){const artifact=writeArtifact(ctx.store,ctx.job,'负责人及期限字段关系核验.json',Buffer.from(JSON.stringify({version:'v7-p1-field-relations-1',items:fieldReviews,limit:'原始模型字段保留在候选账本；正式字段仅保留获局部角色支持的值。'},null,2)),'evidence');ctx.job.fieldRelationReview={fields:fieldReviews.reduce((n,r)=>n+r.checks.length,0),withheld:fieldReviews.reduce((n,r)=>n+Object.keys(r.proposedFields).length,0),artifactId:artifact.id};ctx.job.checks.push({label:'角色证据不足的负责人/期限已留空，原候选和关系回执保留',passed:fieldReviews.every(r=>r.checks.every(c=>c.relation.validationStatus==='supported'||!r[c.field]))});}
  if(rows.length&&!coverage.raw.items.length)warn(ctx,'有逐行文字差异，但模型未形成可核查的业务事项；不能据此认定没有业务变化。');
  const detail=renderReliabilityItems(coverage.raw.items),itemRows=coverage.raw.items.map(i=>[i.key,i.title,i.status,i.verification,i.summary,i.owner||'',i.dueText||'']);
  const report=await makeWorkbook([{name:'完整差异',headers:['类型','旧版行号','新版行号','原文','修改后','关注字段'],rows:diffRows},{name:'事项核查',headers:['事项ID','标题','状态','核验类型','说明','负责人','期限'],rows:itemRows},{name:'核验说明',headers:['项目','内容'],rows:[['旧版',oldFile.name],['新版',newFile.name],['旧版SHA256',oldFile.sha256],['新版SHA256',newFile.sha256],['方法','确定性逐行文本差异；更正公告未重复的内容不能据此判为业务删除。'],['限制','仅覆盖解析文字，模型解释需确认，不构成专业审查。']]}]);
  const markdown=`# 版本比较\n\n旧版：${oldFile.name}\n新版：${newFile.name}\n\n共${rows.length}条逐行文字差异；不是业务变更数量。\n\n${detail}\n\n## 全文处理范围与待处理项\n\n${coverageMarkdown(coverage)}\n\n逐行文本核对，不涵盖图片、签章、版式或专业法律审查。`;
  expectDelivery(ctx.job,{items:coverage.raw.items,structuredName:'完整变更事项.json',markdownName:'版本比较说明.md',markdown,sheets:[{artifactName:'版本修改对照表.xlsx',name:'完整差异',rows:diffRows},{artifactName:'版本修改对照表.xlsx',name:'事项核查',rows:itemRows}]},ctx.store);
  writeArtifact(ctx.store,ctx.job,'版本修改对照表.xlsx',report,'spreadsheet');writeArtifact(ctx.store,ctx.job,'完整差异.json',Buffer.from(JSON.stringify(rows,null,2)),'evidence');writeArtifact(ctx.store,ctx.job,'版本比较说明.md',Buffer.from(markdown),'document');
  writeArtifact(ctx.store,ctx.job,'完整变更事项.json',Buffer.from(JSON.stringify(coverage.raw.items,null,2)),'evidence');writeCoverageArtifacts(ctx,coverage);
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(report);if(reopened.getWorksheet('完整差异').rowCount!==rows.length+1)throw new Error('差异表回读行数不一致');ctx.job.checks.push({label:'完整差异表已回读，新增/删除/修改全部保留',passed:true});ctx.job.diffCount=rows.length;done(ctx,`已生成${rows.length}条原文差异和${coverage.raw.items.length}项变更/待确认事项；${coverage.coverage.unresolved}项处理疑点已单列。`);
}

async function invoiceFields(ctx,files){const ready=files.filter(f=>f.content&&!f.truncated&&f.content.length<=20000);const raw=ready.length?await ctx.analyze({kind:'invoice',instruction:ctx.job.rules+'；提取价税合计小写金额，不拿税额或单价作合计。amountText必须是原文金额，amountQuote必须包含“价税合计/小写/含税总额/报销金额/总金额/合计金额”等标签。发票号码与日期都要逐字依据，缺失留空。每份输入都应返回一项。',documents:docs(ready),shape:'{"invoices":[{"sourceId":"文件id","invoiceNumber":"原票据号或空","numberQuote":"票据号原文行","dateText":"原日期或空","dateQuote":"日期原文行","vendor":"原供应商或空","vendorQuote":"原文","amountText":"123.45或空","amountQuote":"价税合计（小写）￥123.45","description":"内容或空","descriptionQuote":"原文"}]}'}):{invoices:[]};return bounded(raw.invoices);}
export async function reimburse(ctx){
  const template=ctx.job.options.templateId?ctx.files.find(f=>f.id===ctx.job.options.templateId):null;if(ctx.job.options.templateId&&(!template||template.extension!=='.xlsx'))throw new Error('请选择有效XLSX报销模板');
  const invoiceFiles=ctx.files.filter(f=>f.id!==template?.id);if(!invoiceFiles.length)throw new Error('需要选择票据文件');
  const fields=await invoiceFields(ctx,invoiceFiles),rows=[],errors=[],entries=[],groups=new Map();
  for(const file of invoiceFiles){const item=fields.find(x=>x.sourceId===file.id);let reason='',cents=null;
    try{if(!item)throw new Error(file.parseError||'未获得可核验字段，需补充文字/OCR');if(!cited(file,item.numberQuote)||typeof item.invoiceNumber!=='string'||!item.invoiceNumber||!item.numberQuote.includes(item.invoiceNumber))throw new Error('票据号码缺失或无原文依据');const fullNumber=item.numberQuote.match(/(?:发票号码|发票号|票据号码|票据号)[:：\s]*([A-Za-z0-9-]+)/)?.[1];if(fullNumber&&fullNumber!==item.invoiceNumber)throw new Error('票据号码不是原文完整值');if(!cited(file,item.dateQuote)||!item.dateText||!item.dateQuote.includes(item.dateText))throw new Error('日期缺失或无原文依据');const fullDate=item.dateQuote.match(/\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?/)?.[0];if(fullDate&&fullDate!==item.dateText)throw new Error('日期不是原文完整值');if(!cited(file,item.amountQuote))throw new Error('合计金额无法核实');cents=verifiedInvoiceAmount(item);}catch(error){reason=error.message;}
    const row={file,item,cents,reason,notice:null};rows.push(row);if(!reason){const previous=groups.get(item.invoiceNumber);if(previous){if(previous.cents!==cents){previous.reason='相同票据号码金额冲突';row.reason='相同票据号码金额冲突';}else row.reason='重复票据号码，未计入合计';}else groups.set(item.invoiceNumber,row);}
  }
  const valid=rows.filter(r=>!r.reason);let totalCents=0;
  for(const row of valid)row.notice=invoiceSoftIssues(row.file.content,row.cents,row.item.dateText);
  const data=valid.map((r,i)=>{const attachment=`附件/${String(i+1).padStart(3,'0')}_${safeName(r.file.name)}`;entries.push([attachment,readOriginal(ctx.store,r.file)]);totalCents+=r.cents;return [i+1,r.item.dateText,r.item.invoiceNumber,cited(r.file,r.item.vendorQuote)&&r.item.vendorQuote.includes(r.item.vendor)?r.item.vendor:'待确认',r.cents/100,attachment,r.file.name,r.item.amountQuote,r.notice?.text||''];});
  for(const row of rows.filter(r=>r.reason)){errors.push([row.file.name,row.reason]);entries.push(['异常附件/'+row.file.id.slice(0,6)+'_'+safeName(row.file.name),readOriginal(ctx.store,row.file)]);}
  const noticeRows=valid.filter(r=>r.notice).map(r=>({file:r.file.name,text:r.notice.text,cols:r.notice.cols}));
  if(errors.length)warn(ctx,`${errors.length}份票据有缺失、重复或冲突，未计入合计，见异常清单。`);
  if(noticeRows.length)warn(ctx,`${noticeRows.length}份票据有小错误，已按价税合计计入，未从合计剔除。报销明细里出错字段为橙色，详见「醒目提示」。`);
  const verifyRows=[['有效票据数',valid.length],['金额合计（元）',totalCents/100],['精确合计（分）',totalCents],['异常票据数',errors.length],['小错误票据数',noticeRows.length],['小错误处理',noticeRows.length?'不剔除合计，橙色标出出错字段':'无'],['状态','仅生成报销材料，未提交审批']];
  let report=await makeWorkbook([{name:'报销明细',headers:['序号','日期','票据号码','供应商','金额（元）','对应附件','来源文件','金额原文','醒目提示'],rows:data},{name:'合计核验',headers:['项目','数值'],rows:verifyRows},{name:'异常清单',headers:['文件','原因'],rows:errors}]);
  {const painted=new ExcelJS.Workbook();await painted.xlsx.load(report);markWorkbook(painted,{sheetName:'报销明细',firstRow:2,rows:valid.map(r=>r.notice),column:index=>index+1,noticeRows,widenNotice:true});report=Buffer.from(await painted.xlsx.writeBuffer());}
  const check=new ExcelJS.Workbook();await check.xlsx.load(report);let readCents=0;check.getWorksheet('报销明细').eachRow((row,n)=>{if(n>1)readCents+=moneyCents(row.getCell(5).value.toFixed(2));});if(readCents!==totalCents)throw new Error('报销金额回读不一致');
  if(template){
    const book=new ExcelJS.Workbook();await book.xlsx.load(readOriginal(ctx.store,template));const sheet=ctx.job.options.sheetName?book.getWorksheet(ctx.job.options.sheetName):book.worksheets[0];if(!sheet)throw new Error('找不到模板工作表');
    const headerRow=Number(ctx.job.options.headerRow||1);if(!Number.isInteger(headerRow)||headerRow<1||headerRow>50||sheet.rowCount>10000)throw new Error('模板表头行或大小超出范围');
    const headers=sheet.getRow(headerRow).values.slice(1).map(x=>String(x??'').trim());const patterns=[/^序号$/,/^(开票日期|日期|票据日期)$/,/^(发票号码|票据号码|发票号|票据号)$/,/^(供应商|销售方|商户|收款方)$/,/^(报销金额|价税合计|合计金额|金额)([（(]元[）)])?$/,/^(附件|附件名称|对应附件|凭证)$/,/^(来源|来源文件)$/,/^金额原文$/];
    const mapping=headers.map(header=>patterns.findIndex(re=>re.test(header)));if(![1,2,4,5].every(required=>mapping.includes(required)))throw new Error('模板需要可识别的日期、票据号码、金额和附件列；请调整表头或使用内置报销表');
    const limits=Object.fromEntries(book.worksheets.map(s=>[s.name,s.rowCount])),before=JSON.stringify(snapshotCells(book));const firstNew=sheet.rowCount+1;
    for(const row of data)sheet.addRow(mapping.map(index=>index>=0?row[index]:''));if(mapping.includes(-1))warn(ctx,'模板中部分列不属于已接入票据字段，已留空待确认。');
    for(const name of ['合计核验','异常清单']){let unique='本次'+name;while(book.getWorksheet(unique))unique+='副本';const extra=book.addWorksheet(unique);extra.addRow(name==='合计核验'?['项目','数值']:['文件','原因']);for(const row of name==='合计核验'?verifyRows:errors)extra.addRow(row);}
    markWorkbook(book,{sheetName:sheet.name,firstRow:firstNew,rows:valid.map(r=>r.notice),column:index=>{const at=mapping.indexOf(index);return at>=0?at+1:0;},noticeRows,widenNotice:false});
    report=Buffer.from(await book.xlsx.writeBuffer());const verify=new ExcelJS.Workbook();await verify.xlsx.load(report);
    const preserved=snapshotCells(verify,limits).filter(s=>Object.hasOwn(limits,s.name));if(JSON.stringify(preserved)!==before)throw new Error('报销模板历史区域核验不一致，未交付模板填写结果');let cents=0;for(let i=0;i<data.length;i++)cents+=moneyCents(verify.getWorksheet(sheet.name).getRow(firstNew+i).getCell(mapping.indexOf(4)+1).value.toFixed(2));if(cents!==totalCents)throw new Error('模板金额回读不一致');ctx.job.checks.push({label:'按模板表头追加明细，历史区域保持一致',passed:true});
  }
  ctx.job.invoiceNotices=noticeRows.map(({file,text})=>({file,text}));if(noticeRows.length)entries.push(['醒目提示.json',Buffer.from(JSON.stringify(ctx.job.invoiceNotices,null,2))]);
  entries.push(['报销表.xlsx',report],['异常清单.json',Buffer.from(JSON.stringify(errors,null,2))]);const zip=await makeZip(entries);
  const JSZip=(await import('jszip')).default,opened=await JSZip.loadAsync(zip);for(let i=0;i<data.length;i++){const row=data[i],source=valid[i].file;if(digest(await opened.file(row[5]).async('nodebuffer'))!==source.sha256)throw new Error('票据附件顺序或内容核验失败');}
  writeArtifact(ctx.store,ctx.job,'报销材料包.zip',zip,'archive');writeArtifact(ctx.store,ctx.job,'报销明细.xlsx',report,'spreadsheet');ctx.job.checks.push({label:'金额按整数分计算，Excel回读核对一致',passed:true},{label:'报销行号与附件逐一对应，异常附件保留',passed:true});ctx.job.totals={valid:valid.length,exceptions:errors.length,totalCents};done(ctx,`有效票据${valid.length}份，合计¥${(totalCents/100).toFixed(2)}；${noticeRows.length?`其中${noticeRows.length}份有小错误，已按价税合计计入，出错处已橙色标出。`:''}异常${errors.length}份，未提交审批。`);
}

export function snapshotCells(workbook,limits){return workbook.worksheets.map(sheet=>({name:sheet.name,merges:[...(sheet.model.merges||[])].sort(),cells:(()=>{const out=[];sheet.eachRow({includeEmpty:true},(row,n)=>{if(limits&&n>(limits[sheet.name]||0))return;row.eachCell({includeEmpty:true},cell=>out.push({address:cell.address,value:cell.value,style:cell.style}));});return out;})()}));}
export async function ledger(ctx){
  const baseline=ctx.files.find(f=>f.id===ctx.job.options.templateId);if(!baseline||baseline.extension!=='.xlsx')throw new Error('请选择现有XLSX台账作为模板/历史版本');
  const sources=ctx.files.filter(f=>f.id!==baseline.id);if(!sources.length)throw new Error('还需要选择要追加的审查文件');requireText(sources);
  const book=new ExcelJS.Workbook();await book.xlsx.load(readOriginal(ctx.store,baseline));const sheet=ctx.job.options.sheetName?book.getWorksheet(ctx.job.options.sheetName):book.worksheets[0];if(!sheet)throw new Error('找不到指定工作表');
  const headerRow=Number(ctx.job.options.headerRow||1);if(!Number.isInteger(headerRow)||headerRow<1||headerRow>50)throw new Error('表头行应为1至50');
  const headers=sheet.getRow(headerRow).values.slice(1).map(v=>String(v??'').trim());if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('表头必须连续、非空且不重复');if(sheet.rowCount>10000||headers.length>50)throw new Error('台账超出演示范围（10000行/50列）');
  const limits=Object.fromEntries(book.worksheets.map(s=>[s.name,s.rowCount])),before=JSON.stringify(snapshotCells(book));
  const prepared=sources.map(f=>{const match=[...f.content.matchAll(/(?:^|\n)\s*(?:终审(?:意见|结论)?|最终(?:审查|意见))[:：]?\s*/g)].at(-1);const metadata=match?f.content.slice(0,match.index).split('\n').filter(line=>/^(?:项目名称|项目编号|采购项目|文件编号|合同名称)[:：]/.test(line.trim())).join('\n'):'';return {...f,content:match?metadata+'\n'+f.content.slice(match.index):f.content,finalOnly:!!match};});
  const raw=await ctx.analyze({kind:'ledger',instruction:ctx.job.rules+'；有终审的只提取提供的终审片段。表头='+JSON.stringify(headers)+'。每个非空value必须有逐字quote包含该value，禁止归纳改写。信息不在原文则留空，不能猜测。',documents:docs(prepared),shape:'{"records":[{"sourceId":"文件id","values":{"表头":"原文逐字值"},"citations":{"表头":"包含对应值的原文"}}]}'});
  const keyColumns=str(ctx.job.options.dedupeColumns,500).split(/[,，]/).map(x=>x.trim()).filter(Boolean);if(keyColumns.some(c=>!headers.includes(c)))throw new Error('去重列不存在');const columns=keyColumns.length?keyColumns:headers;
  const keyOf=values=>JSON.stringify(columns.map(h=>String(values[headers.indexOf(h)]??'').trim()));const seen=new Set();for(let i=headerRow+1;i<=sheet.rowCount;i++)seen.add(keyOf(headers.map((_,n)=>String(sheet.getRow(i).getCell(n+1).text||''))));
  const additions=[],exceptions=[];const covered=new Set();
  for(const record of bounded(raw.records,100)){
    const file=sourceOf(prepared,record.sourceId);if(!file){exceptions.push(['未知文件','模型返回未授权来源']);continue;}covered.add(file.id);const values=[],evidence=[];let invalid=false;
    for(const header of headers){const value=str(record.values?.[header],3000),quote=record.citations?.[header];if(value&&(!cited(file,quote)||!quote.includes(value))){invalid=true;exceptions.push([file.name,header+' 缺少原文依据']);}values.push(value);if(value)evidence.push({column:header,value,quote});}
    if(invalid||!values.some(Boolean))continue;const key=keyOf(values);if(seen.has(key)){exceptions.push([file.name,'重复记录，未追加']);continue;}seen.add(key);
    const row=sheet.addRow(values);row.eachCell(cell=>{cell.font={...cell.font,color:{argb:'FF2563EB'}};cell.alignment={vertical:'top',wrapText:true};});additions.push({row:row.number,sourceId:file.id,source:file.name,finalOnly:file.finalOnly,values,evidence});
  }
  for(const file of prepared)if(!covered.has(file.id))exceptions.push([file.name,'未提取到可核验记录']);
  if(exceptions.length){warn(ctx,`${exceptions.length}条重复或来源异常，见变更清单。`);ctx.job.softNotices=exceptions.slice(0,30).map(([file,text])=>({file,text}));}
  const bytes=Buffer.from(await book.xlsx.writeBuffer()),verified=new ExcelJS.Workbook();await verified.xlsx.load(bytes);
  if(JSON.stringify(snapshotCells(verified,limits))!==before)throw new Error('历史区域值、公式、样式或合并范围发生变化，未交付更新版');
  const verifiedSheet=verified.getWorksheet(sheet.name);for(const item of additions)for(let i=0;i<item.values.length;i++){const cell=verifiedSheet.getRow(item.row).getCell(i+1);if(item.values[i]&&cell.font?.color?.argb!=='FF2563EB')throw new Error('新增蓝色格式校验失败');}
  const log=await makeWorkbook([{name:'新增记录',headers:['新增行','来源文件','终审优先','数据与逐字依据'],rows:additions.map(a=>[a.row,a.source,a.finalOnly?'是':'原文未找到终审',JSON.stringify(a.evidence)])},{name:'未追加与异常',headers:['文件','原因'],rows:exceptions},{name:'历史核验',headers:['检查','结果'],rows:[['历史单元格值/公式/样式/合并范围','回读一致'],['原台账SHA256',baseline.sha256],['写入方式','新文件交付，原台账不覆盖'],['范围限制','不保证ExcelJS不支持的宏、外部连接或复杂对象；仅支持XLSX']]}]);
  writeArtifact(ctx.store,ctx.job,'台账_追加后.xlsx',bytes,'spreadsheet');writeArtifact(ctx.store,ctx.job,'本次变更清单.xlsx',log,'spreadsheet');writeArtifact(ctx.store,ctx.job,'新增记录与来源.json',Buffer.from(JSON.stringify(additions,null,2)),'evidence');ctx.job.checks.push({label:'历史区域单元格值、公式、样式、合并范围回读一致',passed:true},{label:'新增记录为蓝色，有来源与逐字依据',passed:true});ctx.job.appended=additions.length;done(ctx,`已追加${additions.length}条记录至新台账，历史区域核验通过。`);
}
