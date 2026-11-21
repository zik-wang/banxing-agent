import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx';
import {id,now} from './core.mjs';
import {digest,inside,safeName} from './workspace-files.mjs';
export async function makeWorkbook(sheets){const book=new ExcelJS.Workbook();book.creator='伴行 V2';for(const {name,headers,rows} of sheets){const sheet=book.addWorksheet(name.slice(0,31));sheet.addRow(headers);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF3E6651'}};sheet.views=[{state:'frozen',ySplit:1}];for(const row of rows)sheet.addRow(row);sheet.columns.forEach((c,i)=>{c.width=i>1?42:23;});sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};});}return Buffer.from(await book.xlsx.writeBuffer());}
export async function makeDocx(title,sections){const children=[new Paragraph({text:title,heading:HeadingLevel.TITLE})];for(const {heading,lines} of sections){children.push(new Paragraph({text:heading,heading:HeadingLevel.HEADING_1}));for(const line of lines)children.push(new Paragraph({children:[new TextRun({text:String(line),font:'Microsoft YaHei',size:22})]}));}return Packer.toBuffer(new Document({sections:[{children}]}));}
export async function makeZip(entries){const zip=new JSZip();for(const [name,bytes] of entries){if(name.startsWith('/')||name.split('/').some(p=>p==='..')||name.includes('\\'))throw new Error('归档路径不合法');zip.file(name,bytes);}return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
export function writeArtifact(store,job,name,bytes,kind='file'){
  if(job.status==='cancelled')throw new Error('任务已取消');const artifactId=id(),target=inside(store.directory,'deliverables',job.id,artifactId+'-'+safeName(name));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
  const result={id:artifactId,name:safeName(name),bytes:Buffer.byteLength(bytes),sha256:digest(bytes),kind,createdAt:now(),relativePath:path.relative(store.directory,target)};job.artifacts.push(result);store.save();return result;
}
export function resolveArtifact(store,jobId,artifactId){const job=store.state.jobs.find(j=>j.id===jobId),artifact=job?.artifacts.find(a=>a.id===artifactId);if(!artifact)throw new Error('交付物不存在');const target=inside(store.directory,artifact.relativePath);const bytes=fs.readFileSync(target);if(digest(bytes)!==artifact.sha256)throw new Error('交付物校验失败');return {artifact,bytes};}
