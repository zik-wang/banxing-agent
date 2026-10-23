const QUESTION_START=/^(?:我问一个问题|你+|你们|那你|他有没有|他又没有|知道|是什么情况|怎么|为什么|有没有)/;
const RHETORICAL=/对吧[？?]?$/;
const BACKCHANNEL=/^(?:对+|嗯+|啊+|哦+|噢+|唉|哎|是|OK|ok)[。！]?$/;

function bodyOf(raw){
  return String(raw||'').replace(/\r\n/g,'\n').replace(/^\[整段\]\s*/,'').trim();
}
function sentencesOf(text){
  return text.split(/(?<=[。？！?!])/).map(s=>s.trim()).filter(Boolean);
}
function backchannel(sentence){
  return BACKCHANNEL.test(sentence.replace(/[，,\s]/g,''));
}
function question(sentence){
  if(RHETORICAL.test(sentence)||sentence.length>42)return false;
  if(/^(?:[哎呃嗯啊哦噢]+\s*[，,]?\s*)?我(?!问)/.test(sentence))return false;
  if(/[？?]$/.test(sentence)&&/你|你们|吗|呢|多少|多久|为什么|怎么|有没有|是不是/.test(sentence))return true;
  if(/[？?]$/.test(sentence)&&sentence.length<=18&&/什么|哪|谁/.test(sentence))return true;
  return QUESTION_START.test(sentence);
}
function mentions(text){
  const skip=new Set('的了个下到系是和与及这那有在把被给让向对从院医'.split(''));
  const found=new Set();
  for(const match of text.matchAll(/[\u4e00-\u9fa5]老师/g)){
    const surname=match[0][0];
    if(!skip.has(surname))found.add(surname+'老师');
  }
  for(const word of ['学长','学姐','博士生'])if(text.includes(word))found.add(word);
  if(/人工智能专家/.test(text))found.add('人工智能专家');
  return [...found];
}
function selfNotes(text){
  const found=[];
  for(const match of text.matchAll(/我是[^，。！？?]{2,24}/g)){
    const note=match[0];
    if(/[哎呃嗯啊]/.test(note)||/^我是(?:寒假|昨天|之前|刚才)/.test(note))continue;
    found.push(note);
  }
  return [...new Set(found)].slice(0,6);
}
function group(sentences){
  const turns=[];
  let speaker=1,asking=false;
  const push=(who,sentence)=>{
    const last=turns.at(-1);
    if(last?.speaker===who)last.sentences.push(sentence);
    else turns.push({speaker:who,sentences:[sentence]});
  };
  for(const sentence of sentences){
    if(backchannel(sentence)&&turns.length){turns.at(-1).sentences.push(sentence);continue;}
    const ask=question(sentence);
    if(ask&&!asking){speaker=speaker===1?2:1;asking=true;}
    else if(!ask&&asking&&sentence.replace(/[。！？?，,\s]/g,'').length>2){speaker=speaker===1?2:1;asking=false;}
    push(speaker,sentence);
  }
  return turns;
}
function blocks(sentences,size=3){
  const rows=[];
  for(let i=0;i<sentences.length;i+=size)rows.push(sentences.slice(i,i+size).join(''));
  return rows;
}
export function structureTranscript(raw){
  const source=String(raw||'').trim();
  const timed=[...source.matchAll(/^\[(\d{2}:\d{2})–(\d{2}:\d{2})\]\s*(.+)$/gm)];
  const text=timed.length?timed.map(item=>item[3]).join(''):bodyOf(source);
  if(!text)return source;
  const turns=group(sentencesOf(text));
  const people=mentions(text),notes=selfNotes(text);
  const speakers=new Set(turns.map(turn=>turn.speaker));
  const lines=['【文字后处理】按问句和接话分段、分人。说话人编号不是声纹，也不是姓名识别。录音里没有人自报姓名。'];
  if(timed.length)lines.push('时间是转写分段范围，不是每一句的起止。');
  if(speakers.size<2)lines.push('问句太少，文字里分不出第二个人，下面只按内容分段。');
  else lines.push('现场只标出说话人'+[...speakers].sort((a,b)=>a-b).join('、')+'。提问若来自好几个人，文字分不开。');
  if(people.length)lines.push('提到、但没有确认是谁在开口：'+people.join('、')+'。');
  if(notes.length)lines.push('自述摘录：'+notes.join('；')+'。');
  lines.push('');
  if(timed.length){
    timed.forEach((item,index)=>{
      lines.push(`[${item[1]}–${item[2]}]`);
      const part=group(sentencesOf(item[3].trim()));
      for(const turn of part)for(const block of blocks(turn.sentences))lines.push(`说话人${turn.speaker}：${block}`);
      if(index<timed.length-1)lines.push('');
    });
    return lines.join('\n');
  }
  let section=1;
  for(const turn of turns){
    lines.push(`第${section}段 · 说话人${turn.speaker}`);
    lines.push(blocks(turn.sentences,4).join('\n\n'));
    lines.push('');
    section++;
  }
  return lines.join('\n').trim();
}
