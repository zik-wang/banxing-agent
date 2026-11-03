// Shared, host-owned task interpretation. Document text never reaches this parser.
const formatPatterns=[['docx',/\b(?:word|docx)\b/ig],['xlsx',/\b(?:excel|xlsx)\b/ig],['pdf',/\bpdf\b/ig],['md',/\b(?:markdown|md)\b/ig],['txt',/\btxt\b/ig],['srt',/\bsrt\b/ig],['pptx',/\bpptx?\b|powerpoint/ig],['csv',/\bcsv\b/ig],['rtf',/\brtf\b/ig]];
const ordinal=s=>({一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[s]||Number(s));
export function outputFormats(request=''){
 const formats=new Set();
 for(const clause of String(request).split(/[，,。；;\n]/)){
  const hits=formatPatterns.flatMap(([format,re])=>[...clause.matchAll(re)].map(m=>({format,at:m.index,word:m[0]}))).sort((a,b)=>a.at-b.at);
  let previousOutput=null;
  for(const hit of hits){const before=clause.slice(0,hit.at),after=clause.slice(hit.at+hit.word.length);
   if(/(?:不要|不用|无需|不需要|别)(?:生成|导出|再|提供|给我|输出|新的|任何|一个|一份|版|格式|\s){0,8}$/u.test(before))continue;
   const afterRequest=/^\s*(?:版|版本|文件|文档)?(?:也|再)?(?:请)?(?:给我|发我|交付|下载)/u.test(after);
   const sourceMention=/(?:原|原始|输入|源|对照|参考|依据|读取|阅读|这份|这个|附件)\s*$/u.test(before)||/^\s*(?:页面|原件|作为来源|作为输入|转成|转为)/u.test(after);
   const direct=/(?:导出|生成|做成|做个|存成|存为|转成|转为|转换为|输出|给我|给个|提供|需要|我要)(?:一份|一个|个|为|成|版|格式|可下载的|新的|\s){0,6}$/u.test(before);
   const joined=previousOutput!==null&&/^(?:\s|和|及|与|以及|或|、|\/|版|文件|格式)*$/u.test(clause.slice(previousOutput,hit.at));
   if(afterRequest||!sourceMention&&(direct||joined||/(?:给我|取回|下载)(?:之前|刚才|上轮|已有|那个|那份|的|一份|一个|格式|\s){0,8}$/u.test(before)||clause.trim().toLowerCase()===hit.word.toLowerCase())){formats.add(hit.format);previousOutput=hit.at+hit.word.length;}
  }
 }
 return [...formats];
}
export function executionIntent(request=''){
 request=String(request);const clauses=request.split(/[，,。；;\n]/).map(x=>x.trim()),active=clauses.filter(c=>!/^避免|^别只|^不要只|^不(?:要|应)仅/u.test(c));
 const formats=outputFormats(request),affirmativeExport=active.some(c=>!/^不(?:要|用|需要)|^无需|^别/u.test(c)&&/(?:生成|导出|实际生成|做成|存成|转成|给我).{0,18}(?:Word|Excel|PDF|文件|报告|文档)/iu.test(c));
 const answerOnly=!affirmativeExport&&active.some(c=>/^(?:请)?(?:只|直接)(?:需|要)?(?:回答|告诉|说)|^(?:请)?(?:不要|不用|无需)(?:再)?(?:生成|导出|创建).{0,8}(?:文件|表|报告)/u.test(c));
 const reviewAgain=/(?:重新|再次|重做|补充材料后).{0,8}(?:审核|审查|复核)|重审|(?:改为|换成|从|按).{0,8}(?:采购方|供方|卖方|买方|中立).{0,8}(?:立场|角度)/u.test(request);
 const referenceReview=/(?:刚才|之前|上轮|已有|这份).{0,10}(?:审核|审查).{0,8}(?:重点|结果|结论|报告)/u.test(request);
 const freshReview=reviewAgain||!referenceReview&&/(?:审核|审查|重审|复核|补审|检查)/u.test(request.replace(/(?:审核|审查)(?:报告|重点|结果|结论)/gu,'报告'));
 const modification=/(?:修改|修订|更正|补列|加一列|增加|补充说明|删掉|删除列)/u.test(request);
 const conversion=/(?:转成|转为|转换|导出|做成|做个|存成|存为)|(?:Word|Excel|PDF)(?:版)?给我|用(?:Word|Excel|PDF)给我/iu.test(request);
 const retrieve=!answerOnly&&!modification&&!reviewAgain&&!/(?:转成|转为|转换|导出|生成|做成|做个|存成|存为)/u.test(request)&&(/^(?:文件呢|成果呢)[？?。!！\s]*$/u.test(request)||/(?:之前|刚才|已有|那先把|先把).{0,15}(?:Word|Excel|PDF|文件|成果).{0,10}(?:给我|发我|取回|下载)/iu.test(request)||/(?:给我|取回|下载).{0,10}(?:之前|刚才|已有|上轮).{0,12}(?:Word|Excel|PDF|文件|成果)/iu.test(request));
 const summary=/说重点|讲重点|核心(?:问题|风险)|最重要|总结/u.test(request);
 const implicitDelivery=/(?:合并|合.{0,3}(?:起来|一起)|去重|汇总|修改|修订|转换|转成|转为).{0,20}(?:报表|表格|台账|文档|文件)|(?:报表|表格|台账|文档|文件).{0,20}(?:合并|合.{0,3}(?:起来|一起)|去重|汇总|修改|修订|转换|转成|转为)/u.test(request);
 const operation=reviewAgain?'review':answerOnly?'answer':retrieve?'retrieve':modification?'modify':formats.length&&conversion&&!freshReview?'convert':freshReview?'review':formats.length||implicitDelivery?'create':summary?'summarize':'answer';
 const only=request.match(/(?:只|仅)(?:用|使用|处理|看)第([一二三四五六七八九十\d]+)(?:份|个)/u);
 const excludes=[...request.matchAll(/(?:不要|不用|排除)第([一二三四五六七八九十\d]+)(?:份|个)|第([一二三四五六七八九十\d]+)(?:份|个)(?:不(?:用|要)了?|排除)/gu)].map(m=>ordinal(m[1]||m[2]));
 const oneParagraph=/一(?:个自然)?段(?!.{0,2}时间)/u.test(request)&&/写|汇报|报告|整理|说明/u.test(request),limit=request.match(/(\d+)\s*字(?:以内|内|以下)/u);
 const create=['convert','create','modify','review'].includes(operation),kind=answerOnly?'answer_only':retrieve?'existing_file':create?'create_file':'answer';
 return {version:'host-intent-2',operation,kind,noNewFiles:answerOnly,formats:answerOnly?[]:formats,targetFormats:answerOnly?[]:formats,reviewAgain,requiresReprocessing:reviewAgain||modification,purpose:/给领导|领导(?:看|汇报)/u.test(request)?'leader':'unspecified',length:{paragraphs:oneParagraph?1:null,minChars:oneParagraph&&!limit?200:null,maxChars:limit?Number(limit[1]):oneParagraph?350:null},onlyOrdinal:only?ordinal(only[1]):null,excludedOrdinals:excludes,wantsSummary:summary,materialTask:/(?:合并|合.{0,3}(?:起来|一起)|对比|比较|转成|转换|读取|阅读|提取|整理|做成)/u.test(request)&&/(?:这个|这份|这两|这些|附件|文件|材料|报表|表格)/u.test(request)&&!/(?:知识库|日历|检索)/u.test(request)};
}
