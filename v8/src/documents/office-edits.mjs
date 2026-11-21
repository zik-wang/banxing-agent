import {createHash} from 'node:crypto';
export const AGGREGATE_METRICS=Object.freeze(['sum','mean','count','min','max']);
const clean=s=>String(s??'').trim().replace(/^[“"'「]|[”"'」]$/g,'');
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
export function describeWorkbook(input){return (input.sheets||[]).map((s,i)=>({sheetId:'s'+(i+1),name:s.name,rowCount:s.rows.length,columns:s.headers.map((name,c)=>({columnId:'c'+(c+1),name})),sample:s.rows.slice(0,5),rowReference:'r1 = first data row, excluding header'}));}
function sheetOf(input,step){const sheets=input.sheets||[];if(step.sheet){const found=sheets.filter((s,i)=>s.name===step.sheet||'s'+(i+1)===step.sheet);if(found.length!==1)throw Error('工作表不唯一或不存在：'+step.sheet);return found[0];}const candidates=sheets.filter(s=>!/^报告正文|^正文$|重复来源$|汇总$|统计$/.test(s.name));if(candidates.length!==1)throw Error('存在多张明细表，请指定工作表');return candidates[0];}
function column(s,name){const exact=s.headers.map((v,i)=>({v,i})).filter(x=>x.v===name);if(exact.length===1)return exact[0].i;if(/^c[1-9]\d*$/.test(name)&&+name.slice(1)<=s.headers.length)return +name.slice(1)-1;throw Error('字段不唯一或不存在：'+name);}
function scalar(value){if(value!==null&&!['string','number','boolean'].includes(typeof value))throw Error('单元格只接受文本、数字、布尔或空值');if(typeof value==='number'&&!Number.isFinite(value))throw Error('数值无效');return value;}
function userValue(value,request){scalar(value);if(value!==null&&String(value)!==''&&!request.includes(String(value)))throw Error('更正值必须由用户本轮明确提供；没有依据的字段请留空');return value;}
function decimalSum(values){let max=0;for(const n of values){if(!numeric(n))throw Error('汇总含缺失或非数值字段，请先明确处理方式');const s=String(n);if(/[eE]/.test(s))throw Error('科学计数值需明确精度');max=Math.max(max,(s.split('.')[1]||'').length);}if(max>8)throw Error('精度超过当前安全范围');const scale=10**max;let sum=0;for(const n of values){const v=Math.round(n*scale);if(!Number.isSafeInteger(v)||!Number.isSafeInteger(sum+v))throw Error('合计超过安全精度');sum+=v;}return sum/scale;}
const fingerprint=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
export function applyOfficeEdits(original,steps,request){
 if(!Array.isArray(steps)||!steps.length||steps.length>12)throw Error('每轮需要1至12个明确修改');
 const input=structuredClone(original),results=[],changes=[];
 for(const [index,step] of steps.entries()){
  const before=fingerprint(input.sheets);let detail='',state='applied';
  if(step.type==='recipient'){
   const s=input.sheets.find(s=>s.headers.some(h=>/账单编号|票据号码|发票号码|收票人|金额|价税合计/.test(h)));if(!s)throw Error('当前成果没有可对应的发票明细');
   let col=s.headers.findIndex(h=>/^收票人|^收件人/.test(h));if(col<0){col=s.headers.length;s.headers.push('收票人（原标签）');for(const r of s.rows)r.push(null);}
   let evidence=s.headers.indexOf('收票人依据');if(evidence<0){evidence=s.headers.length;s.headers.push('收票人依据');for(const r of s.rows)r.push(null);}
   const fileCol=s.headers.findIndex(h=>['原始文件','来源文件'].includes(h)),invoiceCol=s.headers.findIndex(h=>/^(?:发票号码|票据号码|账单编号|Invoice Number)$/i.test(h));let missing=0;
   for(const r of s.rows){if(r[col]!==null&&r[col]!==''&&r[col]!==undefined)continue;const matches=(input.recipientRecords||[]).filter(x=>(fileCol>=0&&x.fileName===r[fileCol]&&(invoiceCol<0||!x.invoiceNumber||String(r[invoiceCol])===x.invoiceNumber))||(fileCol<0&&invoiceCol>=0&&x.invoiceNumber&&String(r[invoiceCol])===x.invoiceNumber));if(matches.length===1){r[col]=matches[0].value;r[evidence]='原文角色依据：'+matches[0].sourceId+'；'+matches[0].status;}else{missing++;r[evidence]='待补：没有可核实收票人依据';}}
   state=missing?'needs_input':'applied';detail='已保留收票人字段；'+missing+'条仍缺少明确角色依据';
  }else if(step.type==='report'){
   const main=input.sheets.filter(s=>!/^报告正文|^正文$|重复来源$/.test(s.name)),counts=main.map(s=>s.name+'：'+s.rows.length+'条'),missing=main.reduce((n,s)=>n+s.rows.filter(r=>r.some(v=>v===null||v==='')).length,0);
   const summaries=main.filter(s=>/汇总|统计/.test(s.name)).map(s=>s.name+'：'+s.rows.slice(0,12).map(r=>r.join(' / ')).join('；'));
   input.content='## 工作概况\n'+counts.join('；')+'。统计基于当前成果，不推断业务因果。\n## 关键数字\n'+(summaries.join('\n')||'当前尚无已生成的统计表；以下保留来源明细。')+'\n## 异常与待核\n'+missing+'条记录含空字段；来源中的待核、冲突和异常标记继续保留。\n## 下一步\n优先补齐缺失字段并核对待核记录；本报告未指定原文没有提供的负责人和期限。\n## 附件明细\n以下附完整工作表，保持原始数值与来源对应。';detail='已生成概况、统计、待核及后续事项，并保留全部明细';
  }else{
   const s=sheetOf(input,step);
   if(step.type==='add_column'){
    const name=clean(step.name);if(!name||name.length>100)throw Error('新列名称无效');if(s.headers.includes(name))throw Error('列已存在：'+name+'；如需补值，请明确行与值');
    const value=step.value===undefined?null:userValue(step.value,request);s.headers.push(name);s.rows.forEach(r=>r.push(value));state=value===null?'needs_input':'applied';detail='已新增“'+name+'”列'+(value===null?'；无依据的值留空':'，使用用户明确提供的值');
   }else if(step.type==='set_cell'){
    const col=column(s,step.column),row=Number(String(step.row).replace(/^r/,''))-1;if(!Number.isInteger(row)||row<0||row>=s.rows.length)throw Error('数据行不存在');const value=userValue(step.value,request);changes.push({sheet:s.name,row:row+1,column:s.headers[col],before:s.rows[row][col]??null,after:value,source:'user_correction',request});s.rows[row][col]=value;detail='已更正第'+(row+1)+'条记录的“'+s.headers[col]+'”；原版本保留';
   }else if(step.type==='rename_column'){
    const col=column(s,step.column),name=clean(step.name);if(!name||s.headers.includes(name))throw Error('新列名为空或重复');s.headers[col]=name;detail='已更名为“'+name+'”';
   }else if(step.type==='sort'){
    const col=column(s,step.column);if(!['asc','desc'].includes(step.direction))throw Error('排序方向无效');const sign=step.direction==='desc'?-1:1;s.rows=s.rows.map((r,i)=>({r,i})).sort((a,b)=>{const x=a.r[col],y=b.r[col];if(x==null||x==='')return y==null||y===''?a.i-b.i:1;if(y==null||y==='')return -1;return sign*(numeric(x)&&numeric(y)?x-y:String(x).localeCompare(String(y),'zh-CN',{numeric:true}))||a.i-b.i;}).map(x=>x.r);detail='已按“'+s.headers[col]+'”'+(sign===1?'升序':'降序')+'排序';
   }else if(step.type==='filter'){
    const col=column(s,step.column),v=scalar(step.value);if(!['eq','neq','gt','gte','lt','lte','contains'].includes(step.operator))throw Error('筛选操作不支持');const kept=[],excluded=[];
    for(const r of s.rows){const x=r[col];let ok;if(['gt','gte','lt','lte'].includes(step.operator)){if(!numeric(v))throw Error('大小比较的阈值必须为数字');ok=numeric(x)&&({gt:x>v,gte:x>=v,lt:x<v,lte:x<=v})[step.operator];}else ok=step.operator==='contains'?String(x??'').includes(String(v)):step.operator==='eq'?x===v:x!==v;(ok?kept:excluded).push(r);}
    const name=s.name+'筛除记录';if(input.sheets.some(x=>x.name===name))throw Error('已有同名筛除记录，请明确新的筛选范围');s.rows=kept;if(excluded.length)input.sheets.push({name,headers:[...s.headers],rows:excluded});detail='保留'+kept.length+'条，筛除'+excluded.length+'条另表保留';
   }else if(step.type==='aggregate'){
    const metric=step.metric??'sum';if(!AGGREGATE_METRICS.includes(metric))throw Error('统计类型不支持：metric 仅支持 '+AGGREGATE_METRICS.join('/')+'；统计列名或字段ID请放在 column，operator 仅用于筛选');const col=metric==='count'?-1:column(s,step.column);if(metric==='sum'&&/%|百分|比例|单价|平均|率$/.test(s.headers[col])&&!request.includes('求和'))throw Error('该列不能默认求和，请明确统计口径');
    const grouped=(step.groupBy||[]).map(c=>column(s,c)),currency=s.headers.findIndex(h=>h==='币种');if(currency>=0&&metric!=='count'&&!grouped.includes(currency))grouped.push(currency);
    const groups=new Map();for(const r of s.rows){const key=JSON.stringify(grouped.map(i=>r[i]??null)),g=groups.get(key)||{keys:grouped.map(i=>r[i]??null),values:[]};g.values.push(col<0?1:r[col]);groups.set(key,g);}
    const rows=[...groups.values()].map(g=>{let value;if(metric==='count')value=g.values.length;else{if(g.values.some(v=>!numeric(v)))throw Error('统计列包含空值或非数值，未生成不完整汇总');value=metric==='sum'?decimalSum(g.values):metric==='mean'?decimalSum(g.values)/g.values.length:metric==='min'?Math.min(...g.values):Math.max(...g.values);}return [...g.keys,value];});
    const name=clean(step.outputName||((grouped.length?s.headers[grouped[0]]:'')+(metric==='count'?'计数':'汇总')));input.sheets=input.sheets.filter(x=>x.name!==name);input.sheets.push({name,headers:[...grouped.map(i=>s.headers[i]),metric==='count'?'记录数':s.headers[col]+({sum:'合计',mean:'平均',min:'最小',max:'最大'})[metric]],rows});detail='已按明确字段生成“'+name+'”，币种分别统计';
   }else throw Error('尚不支持该修改：'+step.type);
  }
  results.push({id:'requirement-'+(index+1),type:step.type,state,detail,beforeHash:before,afterHash:fingerprint(input.sheets)});
 }
 input.content=(input.content||'')+'\n## 本轮修改\n'+results.map(x=>x.detail).join('\n');return {input,results,changes};
}

// One normalizer for office modifications. Unrecognized clauses are left for the
// constrained model tool; no partial fast-path execution of a compound request.
export function parseOfficeRequest(text){
 const request=String(text||'').trim(),formats=[...new Set([/excel|excal|xlsx/i.test(request)?'xlsx':null,/word|docx/i.test(request)?'docx':null,/pdf/i.test(request)?'pdf':null].filter(Boolean))];
 const clauses=request.split(/[，,；;。\n]|然后|并且|并转/).map(s=>s.trim()).filter(Boolean),steps=[],unknown=[];let conversion=false;
 for(let clause of clauses){clause=clause.replace(/^(?:请|帮我|麻烦|把|再|也|并|最后|同时)+/g,'').trim();let m;
  if(/^(?:(?:上一轮|刚才|当前|这个|这份|上一个)的?(?:成果|文件|表格|表)?\s*)?(?:转(?:换)?(?:成|为)?|做成|弄成|导出(?:成|为)?|生成|给我|来(?:一份)?|保存(?:成|为)?)?\s*(?:word|docx|pdf|excel|excal|xlsx)(?:文件|格式|版本|吧|一下|可以吗|好吗|吗|\s)*$/i.test(clause)){conversion=true;continue;}
  if(/^(?:我觉得还不够|还不够|还需要|我需要|修改上一个)$/.test(clause))continue;
  if(/^(?:你需要)?(?:把)?(?:收件人|收票人)(?:信息|之类的)?(?:也)?(?:加上|加进去|补上|补齐|加一下|补充)(?:一下|吧)?$|^(?:加上|补上|增加)(?:收件人|收票人)(?:信息)?$/.test(clause)){steps.push({type:'recipient'});continue;}
  if((m=clause.match(/^(?:新增|增加|加|补)(?:一)?列[“"']?([^“”"'，,]+?)[”"']?(?:列)?(?:[，,]?全部(?:填|设为|填写)(.+))?$/))){steps.push({type:'add_column',name:clean(m[1]),...(m[2]?{value:clean(m[2])}:{})});continue;}
  if((m=clause.match(/^第(\d+)(?:行|条)(?:记录)?(?:的)?[“"']?(.+?)[”"']?(?:改为|改成|更正为|设为)(.+)$/))){const raw=clean(m[3]);steps.push({type:'set_cell',row:'r'+m[1],column:clean(m[2]),value:/^-?\d+(?:\.\d+)?$/.test(raw)?Number(raw):raw});continue;}
  if((m=clause.match(/^[“"']?(.+?)[”"']?(?:列)?(?:改名为|重命名为)(.+)$/))){steps.push({type:'rename_column',column:clean(m[1]),name:clean(m[2])});continue;}
  if((m=clause.match(/^按[“"']?(.+?)[”"']?(升序|降序|从大到小|从小到大)(?:排列|排序|排|一下)?$/))){steps.push({type:'sort',column:clean(m[1]),direction:/降|大到小/.test(m[2])?'desc':'asc'});continue;}
  if((m=clause.match(/^(?:只保留|筛选)(.+?)(大于等于|小于等于|大于|小于|等于|不等于)(.+?)(?:的记录|的行)?$/))){const raw=clean(m[3]);steps.push({type:'filter',column:clean(m[1]),operator:({'大于等于':'gte','小于等于':'lte','大于':'gt','小于':'lt','等于':'eq','不等于':'neq'})[m[2]],value:/^-?\d+(?:\.\d+)?$/.test(raw)?+raw:raw});continue;}
  if((m=clause.match(/^按(.+?)(?:分组)?(?:汇总|求和|合计)(.+)$/))){steps.push({type:'aggregate',groupBy:[clean(m[1])],column:clean(m[2]),metric:'sum'});continue;}
  if((m=clause.match(/^(?:汇总|合计|求和)(.+?)(?:一下|吧)?$/))&&!/一下/.test(m[1])){steps.push({type:'aggregate',column:clean(m[1]),metric:'sum'});continue;}
  if(/^(?:金额给我汇总一下|金额汇总|合计一下|汇总一下|(?:算|计算)(?:一下)?总金额)$/.test(clause)){steps.push({type:'legacy_sum'});continue;}
  if(/^(?:重复的不要|去重|去掉重复项|删除重复记录)$/.test(clause)){steps.push({type:'legacy_dedupe'});continue;}
  if(/^(?:部门分开统计一下|按部门统计|按部门分组统计)$/.test(clause)){steps.push({type:'legacy_group'});continue;}
  if(/领导.*(?:报告|版本|看)|(?:报告|版本).*领导/.test(clause)){steps.push({type:'report'});continue;}
  unknown.push(clause);
 }
 return {version:'office-request-1',request,steps,formats,conversion,unknown,complete:unknown.length===0&&(steps.length>0||conversion)};
}
