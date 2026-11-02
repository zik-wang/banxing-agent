import {requestedFormats} from './delivery-format.mjs';
export function turnIntent(request=''){
 const answerOnly=/(?:只|直接)(?:需|要)?(?:回答|告诉|说)|不(?:要|用)?(?:再)?(?:生成|导出|创建).{0,8}(?:文件|表|报告)|不(?:用|要)再生成文件/u.test(request);
 const existing=!answerOnly&&!/(?:转成|转为|转换|导出|生成|修改|补充|加一列)/u.test(request)&&(/^(?:文件呢|成果呢)[？?。!！\s]*$/u.test(request)||/(?:刚才|之前|上轮|已有).{0,15}(?:文件|成果).{0,12}(?:再发|发我|给我|下载)|(?:把|给我|取回|下载).{0,12}(?:刚才|之前|上轮).{0,10}(?:文件|成果)/u.test(request));
 const formats=answerOnly||existing?[]:requestedFormats(request);
 const implicitDelivery=/(?:合并|合.{0,3}(?:起来|一起)|去重|汇总|修改|修订|转换|转成|转为).{0,20}(?:报表|表格|台账|文档|文件)|(?:报表|表格|台账|文档|文件).{0,20}(?:合并|合.{0,3}(?:起来|一起)|去重|汇总|修改|修订|转换|转成|转为)/u.test(request);
 const create=!answerOnly&&!existing&&(implicitDelivery||formats.length>0||/(?:生成|导出|另存|做成|输出).{0,16}(?:文件|表|报告|文档)|(?:补|加|修改|删除).{0,12}(?:列|单元格)/u.test(request));
 const materialTask=/(?:合并|合.{0,3}(?:起来|一起)|对比|比较|转成|转换|读取|阅读|提取|整理)/u.test(request)&&/(?:这个|这份|这两|这些|附件|文件|材料|报表|表格)/u.test(request)&&!/(?:知识库|日历|检索)/u.test(request);
 return {kind:answerOnly?'answer_only':existing?'existing_file':create?'create_file':'answer',noNewFiles:answerOnly,formats,materialTask};
}
export const outputTools=new Set(['convert_to_pdf','export_document','export_xlsx','export_table','export_source_records','revise_table','merge_tables','apply_patch_copy','store_knowledge','split_audio']);
