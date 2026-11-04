import sys,json,pathlib
p=pathlib.Path(sys.argv[1]);suffix=p.suffix.lower()
if suffix=='.xlsx':
 from openpyxl import load_workbook
 b=load_workbook(p,read_only=True,data_only=False)
 result={'sheets':[{'name':s.title,'rows':list(s.values)} for s in b]};b.close()
elif suffix=='.docx':
 from docx import Document
 d=Document(p);result={'text':'\n'.join(x.text for x in d.paragraphs),'tables':[[[c.text for c in r.cells] for r in t.rows] for t in d.tables]}
elif suffix=='.pdf':
 from pypdf import PdfReader
 r=PdfReader(p);result={'text':'\n'.join(x.extract_text() or '' for x in r.pages),'pages':len(r.pages)}
else:result={'text':p.read_text(encoding='utf-8-sig')}
print(json.dumps(result,ensure_ascii=True,default=str))
