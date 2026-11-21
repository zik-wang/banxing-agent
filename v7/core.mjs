import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const TOPICS = Object.freeze({
  ai: { label: 'AI 与本地模型', query: 'LLM' },
  coding: { label: '编程与开发', query: 'programming' },
  productivity: { label: '效率与工具', query: 'productivity' },
});
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function isBase64Payload(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false;
  if (!value) return true;
  let body = value;
  if (value.endsWith('==')) body = value.slice(0, -2);
  else if (value.endsWith('=')) body = value.slice(0, -1);
  if (!body || body.includes('=')) return false;
  for (let i = 0; i < body.length; i += 262144) if (!/^[A-Za-z0-9+/]+$/.test(body.slice(i, i + 262144))) return false;
  return true;
}
export function text(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 个字符`);
  return value.trim();
}

export function initialState() {
  return {
    version: 1,
    profile: { name: '朋友', goal: '把团队的项目材料、承诺和进展关联起来，有依据地跟进协作事项与风险。', preference: '用中文，先讲重点；结论要有文件依据。', topics: ['ai'], quietStart: 22, quietEnd: 8 },
    notes: [
      { id: 'demo-preparation', title: '个人助手 · 演示准备', body: '这是虚构的示例笔记。\n当前目标：做一个通用个人助手 Demo。\n演示内容：读取笔记、处理文件、核对识别文字、设置提醒。\n已经完成：确定通用内核、Harness/Pi 执行、内网 Qwen 与内网识别 API 的分工。\n还需准备：实际运行截图、演示讲解顺序、断网时的说明。\n偏好：先给能执行的小步骤，不要堆很多框架。', updatedAt: now() },
      { id: 'demo-interests', title: '我的兴趣 · 示例', body: '这是虚构的示例笔记。\n我关注本地大模型、Agent 工具调用，以及能改善日常工作的小工具。\n我希望了解：事情为什么与我有关，而不是收到一堆新闻标题。\n没有验证过的消息请说明；不把旧文章当作今日新闻。', updatedAt: now() },
    ], tasks: [], approvals: [], runs: [], notifications: [],
    publicFeed: { items: [], fetchedAt: null, errors: [], topicIds: [] },
  };
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    fs.mkdirSync(directory, { recursive: true });
    try{this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : initialState();}catch{throw Error('state.json无法读取；已停止写入以保留原件。请从已校验备份恢复到独立目录。');}
    this.state.researchPlans ||= [];
    for (const run of this.state.runs) {
      if (run.status === 'running') { run.status = 'interrupted'; run.error = '服务已重启，此次执行中断；已保存的任务仍然保留。'; }
    }
    this.save();
  }
  save() {
    const temporary = this.file + '.tmp';
    const fd=fs.openSync(temporary,'w');try{fs.writeFileSync(fd,JSON.stringify(this.state,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.bak');
    fs.renameSync(temporary, this.file);
  }
  updateProfile(input) {
    const topics = input.topics;
    if (!Array.isArray(topics) || !topics.length || topics.length > 3 || topics.some(t => !Object.hasOwn(TOPICS, t))) throw new Error('请选择允许的公开主题');
    this.state.profile = {
      name: text(input.name, 40), goal: text(input.goal, 1800), preference: text(input.preference, 1200),
      topics: [...new Set(topics)], quietStart: 22, quietEnd: 8,
    };
    this.save();
  }
  saveNote(input) {
    const note = { id: id(), title: text(input.title, 100), body: text(input.body, 16000), updatedAt: now() };
    if (this.state.notes.length >= 40) throw new Error('Demo 最多保存 40 份笔记');
    this.state.notes.push(note); this.save(); return note;
  }
  proposeResearch(runId, input) {
    const objective = text(input.objective, 600);
    if (!Array.isArray(input.queries) || !input.queries.length || input.queries.length > 3) throw new Error('请提出 1–3 条公开检索词');
    const queries = input.queries.map(q => text(q, 160));
    if (queries.some(q => /[\r\n\x00]/.test(q))) throw new Error('检索词不能含换行或控制字符');
    const duplicate = this.state.researchPlans.find(p => p.runId === runId && p.status === 'pending');
    if (duplicate) return duplicate;
    const plan = { id: id(), runId, objective, queries, status: 'pending', createdAt: now() };
    this.state.researchPlans.push(plan); this.save(); return plan;
  }
  proposeTask(runId, input) {
    const title = text(input.title, 140), details = text(input.details, 2500);
    const dueAt = input.dueAt || null;
    if (dueAt && (!Number.isFinite(Date.parse(dueAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(dueAt))) throw new Error('提醒时间必须包含时区');
    const duplicate = this.state.approvals.find(a => a.runId === runId && a.title === title && a.status === 'pending');
    if (duplicate) return duplicate;
    const item = { id: id(), runId, title, details, dueAt, status: 'pending', createdAt: now() };
    this.state.approvals.push(item); this.save(); return item;
  }
  createLocalTask(runId, input) {
    const title=text(input.title,140),details=text(input.details,2500),dueAt=input.dueAt||null;
    if(dueAt&&(!Number.isFinite(Date.parse(dueAt))||!/(Z|[+-]\d{2}:\d{2})$/.test(dueAt)))throw Error('提醒时间必须包含时区');
    const existing=this.state.approvals.find(a=>a.runId===runId&&a.title===title&&a.status!=='rejected');
    if(existing?.status==='approved'){const task=this.state.tasks.find(t=>t.id===existing.taskId);if(!task)throw Error('待办记录缺失，请到设置检查');return task;}
    if(dueAt&&Date.parse(dueAt)<=Date.now())throw Error('提醒时间已过去，请确认一个将来的时间');
    const task={id:id(),title,details,dueAt,done:false,notifiedAt:null,createdAt:now(),sourceRunId:runId};
    const receipt=existing||{id:id(),runId,title,details,dueAt,createdAt:now()};
    Object.assign(receipt,{status:'approved',taskId:task.id,autoCreated:true,approvedAt:now()});
    if(!existing)this.state.approvals.push(receipt);
    this.state.tasks.push(task);this.save();return task;
  }
  activatePendingReminders() {
    let count=0;
    for(const a of this.state.approvals.filter(a=>a.status==='pending'&&!a.forkPaused&&typeof a.dueAt==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(a.dueAt)&&Date.parse(a.dueAt)>Date.now())){
      this.createLocalTask(a.runId,a);count++;
    }
    return count;
  }
  approve(approvalId, dueAt) {
    const item = this.state.approvals.find(a => a.id === approvalId);
    if (!item) throw new Error('找不到这项提议');
    if (item.status === 'approved') return this.state.tasks.find(t => t.id === item.taskId);
    if (item.status !== 'pending') throw new Error('这项提议已处理');
    const reminder = dueAt === undefined ? item.dueAt : dueAt;
    if (reminder && (!Number.isFinite(Date.parse(reminder)) || !/(Z|[+-]\d{2}:\d{2})$/.test(reminder))) throw new Error('提醒时间必须包含时区');
    const task = { id: id(), title: item.title, details: item.details, dueAt: reminder || null, done: false, notifiedAt: null, createdAt: now() };
    this.state.tasks.push(task); item.status = 'approved'; item.taskId = task.id; this.save(); return task;
  }
  scheduleTask(taskId, dueAt) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task || task.done) throw new Error('请选择未完成的待办');
    if (typeof dueAt !== 'string' || !Number.isFinite(Date.parse(dueAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(dueAt)) throw new Error('请设置包含时区的有效提醒时间');
    task.dueAt = dueAt; task.notifiedAt = null; delete task.forkPaused;
    for (const n of this.state.notifications.filter(n => n.taskId === taskId && !n.read)) { n.read = true; n.acknowledgedAt = now(); n.response = 'rescheduled'; }
    this.save(); return task;
  }
  respondNotification(notificationId, action, date = new Date()) {
    if (!['ack','snooze','complete'].includes(action)) throw new Error('未知提醒操作');
    const item = this.state.notifications.find(n => n.id === notificationId);
    if (!item) throw new Error('找不到这条提醒');
    const task = this.state.tasks.find(t => t.id === item.taskId);
    if (item.acknowledgedAt) return { notification: item, task };
    if (action !== 'ack' && (!task || task.done)) throw new Error('待办已完成或不存在');
    if (action === 'snooze') { task.dueAt = new Date(date.getTime() + 5 * 60000).toISOString(); task.notifiedAt = null; }
    if (action === 'complete') task.done = true;
    const affected = item.taskId ? this.state.notifications.filter(n => n.taskId === item.taskId && !n.read) : [item];
    for (const n of new Set([item, ...affected])) { n.read = true; n.acknowledgedAt = date.toISOString(); n.response = action; }
    this.save(); return { notification: item, task };
  }
  tick(date = new Date(), { forceQuiet = false } = {}) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(date));
    if (forceQuiet || hour >= this.state.profile.quietStart || hour < this.state.profile.quietEnd) return 0;
    let count = 0;
    for (const task of this.state.tasks) {
      if (!task.done && !task.forkPaused && task.dueAt && !task.notifiedAt && Date.parse(task.dueAt) <= date.getTime()) {
        this.state.notifications.unshift({ id: id(), kind: 'task-reminder', title: '待办到时间了', body: task.title, taskId: task.id, dueAt: task.dueAt, createdAt: date.toISOString(), read: false });
        task.notifiedAt = date.toISOString(); count++;
      }
    }
    if (count) this.save();
    return count;
  }
}
