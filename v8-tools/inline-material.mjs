export const MAX_MESSAGE_CHARS=240000;
const taskLine=/^(?:请|帮我|麻烦|审核|审查|分析|检查|总结|提取|整理|比较|评估|解读|翻译|校对|生成|导出|把|根据|对这|看一下|看下)/u;
export function inlineMaterial(message){
 const text=String(message||'');
 if(!(text.length>=800&&(text.match(/\n/g)||[]).length>=3)&&text.length<=12500)return null;
 const lines=text.split(/\r\n|\r|\n/).map(s=>s.trim()).filter(Boolean),first=lines[0]||'',last=lines.at(-1)||'';
 const task=last.length<=1000&&taskLine.test(last)?last:first.length<=500&&taskLine.test(first)?first:text.length<=12500?text:'用户提供了完整消息正文，请先读取本轮正文材料；若其中没有清楚的处理要求，请询问用户的目标。';
 return {task,text,chars:text.length,keepPreviousResult:/(?:刚才|上轮|之前|上面|已有|现有|原来的|当前成果)/u.test(task)};
}
