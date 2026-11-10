import {randomUUID} from 'node:crypto';
// Only explicit, unambiguous user operations are compiled here. Originals do not
// supply instructions or permissions; ambiguous columns/keywords ask the user.
const normal=x=>String(x).replace(/[\s_（）()]/g,'').toLowerCase();
export function uniqueKnowledgeSpans(matches,seen=new Set()){
 return matches.filter(m=>{const key=JSON.stringify([m.documentId||m.sourceName,m.sourceSha256,m.start,m.end,m.quote]);if(seen.has(key))return false;seen.add(key);return true;});
}
export function resolveMergeKeys(request,headers){
 const m=request.match(/(?:去重键|主键)(?:建议)?\s*[：:]\s*([^\n。；（(]+)/u);if(!m)return null;
 const requested=m[1].split(/[+＋、,，]/u).map(x=>x.trim()).filter(Boolean);if(!requested.length||requested.length>10)return{ambiguous:true};
 const aliases={供应商:/^(?:供应商(?:名称)?|中标人|中标供应商(?:名称)?|supplier|vendor)$/iu,报价:/^(?:报价|报价金额|中标金额|投标报价|投标金额|中标报价|金额|总金额|amount)(?:元|cny|rmb)?$|价税合计|含税金额|不含税金额|税前金额|金额不含税/iu,项目名称:/^(?:项目名称|采购项目名称|projectname)$/iu};
 const keys=[];for(const key of requested){const exact=headers.filter(h=>normal(h)===normal(key)),group=Object.values(aliases).find(re=>re.test(normal(key))),matched=exact.length?exact:headers.filter(h=>group?.test(normal(h)));if(matched.length!==1)return{ambiguous:true,requested,headers};keys.push(matched[0]);}return{keys,requested};
}
export async function officePreflight({docs,records,harness,config,request}){
 if(!config.documentComposition||config.meetingPolicy||docs.turnIntent.noNewFiles||docs.turnIntent.requiresExternalAction)return null;
 const inputs=[...docs.assets.values()].filter(a=>a.id===a.sourceId);if(!inputs.length)return null;
 const call=async(name,args)=>{const r=await harness.execute(name,args);if(r.status!=='ok')throw Object.assign(Error(r.error?.message||'办公工具执行失败'),{code:r.error?.code});return r.data;};
 if(docs.factProfile==='expiry'&&inputs.length===1&&['text','pdf'].includes(inputs[0].kind)&&docs.turnIntent.formats.length){
  let offset=0,ids=[],complete=false;for(let batch=0;batch<4;batch++){const r=await call('read_source_records',{asset_id:inputs[0].id,offset,limit:100});ids.push(...r.records.map(r=>r.id));if(r.nextOffset===null||r.nextOffset===undefined){if(r.totalRecords>ids.length)return{needsInput:true,message:'到期事实仍有未读部分，请缩小范围后继续；已取得的原文和记录保留。'};complete=true;break;}offset=r.nextOffset;}
  if(!ids.length)return{needsInput:true,message:'当前未提取到明确的到期事实，不能把其他日期猜作到期日。请确认材料或补充范围。'};
  if(!complete||ids.length>400)return{needsInput:true,message:'到期事实超过本次导出预算，请分批选择，已有记录保留。'};
  await call('export_source_records',{record_ids:ids,title:'到期事实清单',formats:docs.turnIntent.formats.filter(f=>['xlsx','docx','csv','json','md'].includes(f))});
  return{completed:true,message:records.summary()+'\n\n本轮由程序按原文事实台账导出，没有调用云模型；这不是完整语义召回或当前续约情况的证明。'};
 }
 if(/入库/u.test(request)&&!/不要.{0,8}入库|无需.{0,8}入库|别.{0,8}入库/u.test(request)&&inputs.every(a=>a.kind==='text')){
  // A fixed literal query compiler cannot select translated/synonymous terms.
  // Keep those requests on the ordinary source-reading + knowledge tool path.
  if(/(?:英文|原文语言|跨语言|同义词|翻译).{0,25}(?:原词|检索|搜索)|(?:检索|搜索).{0,25}(?:英文|跨语言|同义词)/u.test(request))return null;
  const match=request.match(/(?:检索|搜索)[\s\S]{0,35}[「“"]([^」”"]{1,150})[」”"]/u);if(!match)return null;
  const queries=match[1].split(/[\/、，,]/u).map(s=>s.trim()).filter(Boolean);if(!queries.length||queries.length>10)return null;
  const stored=[];for(const a of inputs)stored.push(await call('store_knowledge',{asset_id:a.id,title:a.name}));
  const sections=[],fullSections=[],seen=new Set();for(const query of queries){const r=await call('search_knowledge',{query,limit:100}),unique=uniqueKnowledgeSpans(r.matches,seen);fullSections.push('## '+query+'：'+r.totalMatches+'处关键词字面匹配；本节新增'+unique.length+'段不同来源位置的原句（跨查询相同位置去重）'+(r.nextOffset!==null?'（本文件仅含已取得的一页；仍有未取回范围）':'')+'\n'+unique.map(m=>m.sourceName+' 第'+m.line+'行 ['+m.start+'..'+m.end+'] SHA256 '+m.sourceSha256+'\n'+m.quote).join('\n\n'));sections.push('### '+query+'\n字面匹配 '+r.totalMatches+' 处；本节新增'+unique.length+'段不同来源位置的原句。'+(r.nextOffset!==null?'原句仍有未取回范围。':'')+'聊天仅摘录最多4处，完整已取得命中见下载文件。\n'+unique.slice(0,4).map(m=>'- '+m.sourceName+' 第'+m.line+'行：'+m.quote.trim()).join('\n'));}
  const allowed=['docx','txt','md'],formats=docs.turnIntent.formats.length?docs.turnIntent.formats.filter(f=>allowed.includes(f)):['txt'];if(!formats.length)return{needsInput:true,message:'条目和检索结果已保存；请指定Word或TXT等可用的原句交付格式，未擅自替换所需格式。'};const resultId=randomUUID();docs.results.set(resultId,{resultId,method:'knowledge_search_report',answer:'# 知识原句检索结果\n\n这是字面检索，不是语义完整性或个人事项办结证明。\n\n'+fullSections.join('\n\n'),sourceIds:inputs.map(a=>a.id)});docs.save();for(const format of formats)await call('export_document',{title:'知识原句检索结果',format,result_ids:[resultId]});
  return{completed:true,message:'# 知识入库与原句检索\n\n已持久保存以下全文条目，附件登记不代替入库：\n'+stored.map(x=>'- '+x.title+' · 文档ID '+x.documentId+' · SHA256 '+x.sourceSha256).join('\n')+'\n\n'+sections.join('\n\n')+'\n\n这是字面检索，不保证语义召回；没有个人办理回执，不能据此认定个人事项已办结。'};
 }
 if(inputs.length>=2&&inputs.every(a=>a.kind==='workbook')&&/合并|追加|合起来/u.test(request)&&!/不要.{0,5}去重|保留重复/u.test(request)){
  const preliminary=resolveMergeKeys(request,[]);if(!preliminary)return null;
  const tables=[];for(const a of inputs){const inspected=await call('inspect_material',{asset_id:a.id}),sheets=inspected.sheets||a.sheets;if(sheets?.length!==1)return{needsInput:true,message:'材料含多个或未识别的工作表，请明确选用工作表；未擅自选择。'};const sheet=typeof sheets[0]==='string'?sheets[0]:sheets[0].name;tables.push(await call('read_workbook',{asset_id:a.id,sheet,header_row:1}));}
  const headers=[...new Set(tables.flatMap(t=>t.headers))],resolved=resolveMergeKeys(request,headers);
  if(resolved.ambiguous)return{needsInput:true,message:'去重字段或金额口径仍有歧义，请明确使用哪些原始列：'+headers.join('、')+'。原文件保留，未合并或猜测。'};
  const result=await call('merge_tables',{table_ids:tables.map(t=>t.tableId),mode:'deduplicate',key_columns:resolved.keys});await call('export_table',{table_id:result.tableId,title:'合并报表'});
  return{completed:true,message:'已按你指定的业务键（'+resolved.keys.join('＋')+'）合并并去重，字段类型、来源和冲突按工具回执保留。Excel可从下方下载；原件没有修改。\n\n本轮是程序执行明确表格操作，不是模型自行计算；不构成完整年度审计。'};
 }
 return null;
}
