// Formatting only. Never evaluates embedded HTML, code or links.
export function inlineRuns(value){
 const text=String(value??''),out=[];
 const pattern=/\\([\\`*_[\]{}()#+.!|~-])|(`+)([\s\S]*?)\2|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
 let cursor=0;for(const m of text.matchAll(pattern)){if(m.index>cursor)out.push({text:text.slice(cursor,m.index)});
  if(m[1])out.push({text:m[1]});else if(m[2])out.push({text:m[3],font:'Consolas'});else if(m[4]||m[5])out.push({text:m[4]||m[5],bold:true});else if(m[6])out.push({text:m[6],strike:true});else out.push({text:m[7]+' ('+m[8]+')'});cursor=m.index+m[0].length;
 }if(cursor<text.length)out.push({text:text.slice(cursor)});return out.length?out:[{text:''}];
}
export const plainInline=value=>inlineRuns(value).map(r=>r.text).join('');
export function tableCells(line){
 const cells=[];let cell='',fence=0;const s=line.trim();
 for(let i=0;i<s.length;i++){
  if(s[i]==='\\'&&i+1<s.length){cell+=s[i]+s[++i];continue;}
  if(s[i]==='`'){let n=1;while(s[i+n]==='`')n++;if(!fence)fence=n;else if(fence===n)fence=0;cell+='`'.repeat(n);i+=n-1;continue;}
  if(s[i]==='|'&&!fence){cells.push(cell.trim());cell='';}else cell+=s[i];
 }cells.push(cell.trim());if(s.startsWith('|'))cells.shift();if(s.endsWith('|')&&cells.at(-1)==='')cells.pop();return cells;
}
export function wordBlocks(text){
 const lines=String(text||'').replace(/\r\n/g,'\n').split('\n'),blocks=[];let fence=null;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],mark=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if(fence){if(mark&&mark[1][0]===fence[0]&&mark[1].length>=fence.length&&!mark[2].trim()){fence=null;continue;}blocks.push({kind:'paragraph',text:line,code:true});continue;}
  if(mark){fence=mark[1];continue;}if(!line.trim()||/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))continue;
  const headers=tableCells(line),separator=i+1<lines.length?tableCells(lines[i+1]):[];
  if(headers.length>1&&separator.length===headers.length&&separator.every(c=>/^:?-{3,}:?$/.test(c))){const rows=[headers];i++;while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){const row=tableCells(lines[i+1]);if(row.length!==headers.length)throw Error('Word table must have rectangular rows');rows.push(row);i++;}blocks.push({kind:'table',rows});continue;}
  const heading=line.match(/^(#{1,6})\s+(.*?)\s*#*$/),bullet=line.match(/^\s*[-+*]\s+(.*)$/);blocks.push({kind:'paragraph',text:heading?heading[2]:bullet?bullet[1]:line,heading:heading?.[1].length,bullet:!!bullet});
 }return blocks;
}
