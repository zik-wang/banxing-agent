import {pathToFileURL} from 'node:url';
import {inlineRuns,plainInline,wordBlocks} from './word-markdown.mjs';
const reportHeadings=new Set(['阅读要点','审核立场范围和材料限制','最重要的候选风险','待补材料和待确认事项','原有批注的核实结果','必审项执行台账','未获支持的候选（保留审计记录）','以下为原始候选审计明细（不代表独立风险数）','27B与本地微调的前后复核','反馈与受控改进']);
const cellText=v=>v?.kind==='excel_temporal'?v.display:String(v??'');
export async function buildWord({title,text,tables=[],modulePath}){
 const d=await import(modulePath?pathToFileURL(modulePath).href:'docx');
 const {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType,TableLayoutType,PageOrientation}=d;
 const blocks=wordBlocks(text);
 if(blocks[0]?.kind==='paragraph'&&plainInline(blocks[0].text).trim()===title.trim())blocks.shift();
 for(const table of tables){
  blocks.push({kind:'table',name:table.sheet||'',literal:true,rows:[table.headers,...table.rows].map(r=>r.map(cellText))});
  if(table.reviewRows?.length)
   blocks.push({kind:'table',name:'待核',literal:true,rows:[table.headers,...table.reviewRows].map(r=>r.map(cellText))});
 }
 const all=blocks.filter(b=>b.kind==='table'),columns=Math.max(0,...all.map(t=>t.rows[0]?.length||0)),wide=columns>6,pageWidth=columns>8?23811:wide?16838:11906,pageHeight=columns>8?16838:wide?11906:16838,usable=pageWidth-1800;
 const expected={paragraphs:[],tables:[],blocks:[]},children=[];let readingOverview=false;
 function runs(value,{literal=false,...defaults}={}){return (literal?[{text:value}]:inlineRuns(value)).flatMap(r=>r.text.split('\n').map((text,i)=>new TextRun({...defaults,...r,text,...(i?{break:1}:{})})));}
 function paragraph(value,heading,{bullet=false,code=false}={}){
  const visible=code?value:plainInline(value);if(visible==='阅读要点')readingOverview=true;if(/^附录[：:]/u.test(visible))readingOverview=false;
  expected.paragraphs.push(visible);expected.blocks.push({kind:'paragraph',text:visible});
  children.push(new Paragraph({children:runs(value,{literal:code,...(code?{font:'Consolas'}:{})}),heading,bullet:bullet?{level:0}:undefined,pageBreakBefore:!!heading&&/^附录[：:]/u.test(visible),spacing:{after:!visible&&!code?0:readingOverview?60:80,...(!visible&&!code?{line:20}:{})},keepNext:!!heading}));
 }
 paragraph(title,HeadingLevel.TITLE);
 for(const b of blocks){
  if(b.kind==='paragraph'){
   const plain=b.code?b.text:plainInline(b.text),h=b.heading?[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][Math.min(3,b.heading)-1]:reportHeadings.has(plain.trim())||/^附录[：:]/u.test(plain.trim())?HeadingLevel.HEADING_1:/^(?:M|F|C|X)\d+\s.{1,70}$/u.test(plain)?HeadingLevel.HEADING_2:undefined;
   paragraph(b.text,h,b);continue;
  }
  if(b.name)paragraph(b.name,HeadingLevel.HEADING_1);
  const n=b.rows[0]?.length;if(!n||b.rows.some(r=>r.length!==n))throw Error('Word table must have rectangular rows');
  const values=b.rows.map(r=>r.map(v=>b.literal?v:plainInline(v)));expected.tables.push(values);expected.blocks.push({kind:'table',rows:values});
  const weights=values[0].map((_,c)=>Math.min(55,Math.max(wide?18:10,...values.map(r=>[...r[c]].reduce((sum,ch)=>sum+(ch.charCodeAt(0)>255?2:1),0))))),sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>Math.floor(usable*w/sum));widths[widths.length-1]+=usable-widths.reduce((a,b)=>a+b,0);
  children.push(new Table({width:{size:usable,type:WidthType.DXA},layout:TableLayoutType.FIXED,columnWidths:widths,rows:b.rows.map((row,i)=>new TableRow({tableHeader:i===0,cantSplit:true,children:row.map((value,c)=>new TableCell({width:{size:widths[c],type:WidthType.DXA},margins:{top:70,bottom:70,left:80,right:80},shading:i===0?{fill:'EAEFEC'}:undefined,children:[new Paragraph({spacing:{after:40},children:runs(value,{literal:b.literal,bold:i===0,size:wide?19:21,font:'Microsoft YaHei',color:'000000'})})]}))}))}));
  paragraph('');
 }
 const doc=new Document({creator:'伴行 V8',title,styles:{default:{document:{run:{font:'Microsoft YaHei',size:22,color:'000000'}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',run:{color:'000000',size:36,bold:true}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',run:{color:'000000',size:26,bold:true}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',run:{color:'000000',size:24,bold:true}}]},sections:[{properties:{page:{size:{width:wide?pageHeight:pageWidth,height:wide?pageWidth:pageHeight,orientation:wide?PageOrientation.LANDSCAPE:PageOrientation.PORTRAIT},margin:{top:900,bottom:900,left:900,right:900}}},children}]});
 return {bytes:await Packer.toBuffer(doc),expected};
}
