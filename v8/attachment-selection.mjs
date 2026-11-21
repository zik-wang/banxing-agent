// A negative constraint on an action is not a request to remove an input.
export function attachmentExclusionRequest(request=''){
 const clauses=String(request).split(/[，,；;。\n]/).map(s=>s.trim()).filter(Boolean);
 return clauses.length>0&&clauses.every(c=>/^(?:请)?(?:不要(?:使用|用|分析|引用)?|不用|不再(?:使用|用)|排除|忽略|移除|删除|删掉)\s*(?:第[一二12](?:个|份)(?:文件)?(?:了)?|(?:这个|那个|这份|那份|所有|全部)?(?:附件|文件)(?:了)?|[^，,；;。\n]+\.(?:pdf|md|txt|xlsx|docx|png|jpg)(?:了)?)$/i.test(c));
}
