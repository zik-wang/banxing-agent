import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const context={window:{},Event};vm.runInNewContext(fs.readFileSync(new URL('../v8-web/reply-presentation.js',import.meta.url),'utf8'),context);const ui=context.window.ReplyPresentation;
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function form(value=''){
 const suggestions=ui.suggestions({request:'预约会议'}),events=[],feedback={textContent:''},input={value,maxLength:4000,dispatchEvent:e=>events.push(e.type),focus(){this.focused=true},setSelectionRange(a,b){this.selection=[a,b]}};
 return {dataset:{},input,events,feedback,querySelector(selector){if(selector==='textarea')return input;if(selector==='.decision-feedback')return feedback;const m=selector.match(/suggestion="(\d+)"/);return m&&suggestions[m[1]]?{dataset:{suggestionText:suggestions[m[1]].text}}:null;}};
}
test('pending clarification shows exactly three contextual buttons without submitting or authorizing a calendar',()=>{
 const html=ui.question({id:'turn',request:'预约会议',status:'needs_input',clarification:{state:'pending',choices:[],question:'缺少双方free/busy'}},esc);
 assert.equal((html.match(/data-decision-suggestion=/g)||[]).length,3);assert.equal((html.match(/type="button"/g)||[]).length,3);assert.match(html,/填写双方空闲时间/);assert.match(html,/提供日历快照/);assert.match(html,/填写已确定的安排/);assert(!html.includes('张三'));assert(!html.includes('2026'));assert.match(html,/〔请填写〕/);
});
test('suggestion selection fills editable input and emits only input, without network or submit',()=>{
 const f=form();assert(ui.fillSuggestion(f,0));assert.match(f.input.value,/会议主题/);assert.deepEqual(f.events,['input']);assert.equal(f.input.focused,true);assert.equal(f.input.value.slice(...f.input.selection),'〔请填写〕');assert.match(f.feedback.textContent,/才会发送/);
});
test('changing an untouched suggestion replaces it; user edits survive subsequent choices',()=>{
 const f=form();ui.fillSuggestion(f,0);ui.fillSuggestion(f,1);assert(!f.input.value.includes('各自空闲时段'));f.input.value+='\n请保留我写的要求';const edited=f.input.value;ui.fillSuggestion(f,2);assert(f.input.value.startsWith(edited));const once=f.input.value;ui.fillSuggestion(f,2);assert.equal(f.input.value,once);
});
test('long hand-written drafts are preserved, never silently truncated',()=>{
 const f=form('字'.repeat(3999));assert.equal(ui.fillSuggestion(f,0),false);assert.equal(f.input.value.length,3999);assert.equal(f.events.length,0);assert.match(f.feedback.textContent,/精简/);
});
test('file scope remains an explicit selection and question content is escaped',()=>{
 const turn={id:'id',request:'导出文件',status:'needs_input',clarification:{state:'pending',choices:[{id:'a',name:'<img onerror="x">',kind:'original'}]}};
 const html=ui.question(turn,esc);assert.match(html,/分别处理所选材料/);assert(!html.includes('<img'));assert(!html.includes('checked'));turn.clarification.state='answered';assert(!ui.question(turn,esc).includes('data-decision-suggestion'));
});
test('other task categories offer three editable options without claiming source facts',()=>{
 for(const request of ['报销金额','审核合同','转写录音','整理材料']){const a=ui.suggestions({request});assert.equal(a.length,3);assert.equal(new Set(a.map(x=>x.text)).size,3);assert(a.every(x=>x.text.length<4000));}
});
