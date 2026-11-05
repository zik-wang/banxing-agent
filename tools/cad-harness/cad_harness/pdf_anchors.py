"""Read source arrow/label candidates. Does not infer an accepted part dimension.

All coordinates are original PDF points. Candidate IDs retain the source path
and text span. A model or a separate matcher must establish dimension semantics;
these are source observations, never values from an acceptance contract.
"""
import math,re
from pathlib import Path
import fitz

def subpaths(drawing):
 paths=[];current=[]
 def flush():
  nonlocal current
  if current:paths.append(current)
  current=[]
 for item in drawing['items']:
  if item[0]=='l':
   a,b=(tuple(p) for p in item[1:3])
   if current and math.dist(current[-1],a)>1e-4:flush()
   if not current:current.append(a)
   current.append(b)
  else:flush()
 flush();return paths

def candidates(pdf,page_no=0):
 with fitz.open(pdf) as doc:
  page=doc[page_no];arrows=[];labels=[]
  for index,d in enumerate(page.get_drawings()):
   if 'f' not in d['type']:continue
   for part,points in enumerate(subpaths(d)):
    vertices=[]
    for p in points:
     if not any(math.dist(p,q)<1e-4 for q in vertices):vertices.append(p)
    if len(vertices)!=3:continue
    edges=sorted([(math.dist(vertices[i],vertices[(i+1)%3]),i,(i+1)%3) for i in range(3)])
    small,a,b=edges[0];tip_index=next(i for i in range(3) if i not in [a,b]);tip=vertices[tip_index]
    if not .1<small<12 or edges[-1][0]<1.8*small or edges[-1][0]>35:continue
    base=tuple((vertices[a][j]+vertices[b][j])/2 for j in range(2));length=math.dist(tip,base)
    if length<=0:continue
    direction=tuple((base[j]-tip[j])/length for j in range(2))
    arrows.append({'id':f'p{page_no}_path{index}_sub{part}','path_index':index,'subpath':part,'tip_pt':tip,'base_pt':base,'direction':direction})
  for bi,block in enumerate(page.get_text('dict')['blocks']):
   for li,line in enumerate(block.get('lines',[])):
    for si,span in enumerate(line['spans']):
     # Record every explicit millimetre label; meaning and model selection remain separate.
     for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?)\s*mm\b',span['text'],re.I):
      labels.append({'id':f'p{page_no}_b{bi}_l{li}_s{si}','text':span['text'],'value_mm':float(m.group(1)),'bbox_pt':list(span['bbox']),'origin_pt':list(span['origin'])})
  pairs=[]
  for i,a in enumerate(arrows):
   for b in arrows[i+1:]:
    for axis,j in [('x',0),('y',1)]:
     k=1-j;pa,pb=a['tip_pt'],b['tip_pt'];dot=sum(x*y for x,y in zip(a['direction'],b['direction']))
     if abs(pa[k]-pb[k])>.05 or abs(pa[j]-pb[j])<3 or abs(a['direction'][k])>.02 or abs(b['direction'][k])>.02 or dot>-.99:continue
     pairs.append({'id':f'{a["id"]}__{b["id"]}','axis':axis,'arrow_ids':[a['id'],b['id']],'tips_pt':[pa,pb],'distance_pt':abs(pa[j]-pb[j])})
  return {'source_pdf':str(Path(pdf).resolve()),'page':page_no,'coordinate_units':'original PDF points','arrows':arrows,'explicit_mm_labels':labels,'collinear_opposed_arrow_pairs':pairs,'status':'SOURCE_CANDIDATES_ONLY_NOT_ACCEPTED_DIMENSIONS'}

if __name__=='__main__':
 import sys,json
 print(json.dumps(candidates(sys.argv[1],int(sys.argv[2]) if len(sys.argv)>2 else 0),ensure_ascii=False,indent=2))
