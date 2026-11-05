"""Independent raw-PDF-to-saved-DXF coverage check; not writer self-attestation.

Uses original PDF line endpoints/text baselines, not the converter's provenance.
Physical scale must be separately supported by source dimension anchors.
"""
from collections import Counter
import math
import fitz,ezdxf

def audit_source(pdf,dxf,mm_per_pt,offset=(0,0),page_no=0,point_digits=5):
 doc=fitz.open(pdf);page=doc[page_no];height=page.rect.height
 def pt(p):return (round(p[0]*mm_per_pt+offset[0],point_digits),round((height-p[1])*mm_per_pt+offset[1],point_digits))
 def segment(a,b):return tuple(sorted((a,b)))
 expected=Counter();unsupported=[];text_expected=Counter()
 for di,d in enumerate(page.get_drawings()):
  last=None;first=None
  def close_fill():
   if first is not None and last is not None and first!=last and 'f' in d['type']:expected[segment(last,first)]+=1
  for ii,item in enumerate(d['items']):
   if item[0]=='l':
    a,b=pt(item[1]),pt(item[2])
    if a==b:continue
    if last is not None and last!=a:close_fill();first=None
    if first is None:first=a
    last=b;expected[segment(a,b)]+=1
   elif item[0] in ['re','qu']:
    close_fill();last=first=None;r=item[1]
    ps=[pt(p) for p in ([r.tl,r.tr,r.br,r.bl] if item[0]=='re' else [r.ul,r.ur,r.lr,r.ll])]
    for a,b in zip(ps,ps[1:]+ps[:1]):expected[segment(a,b)]+=1
   else:unsupported.append({'drawing':di,'item':ii,'op':item[0]})
  close_fill()
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    if span['text'].strip():text_expected[(span['text'],pt(span['origin']))]+=1
 saved=ezdxf.readfile(dxf);actual=Counter();text_actual=Counter();by_type=Counter()
 def q(p):return (round(float(p[0]),point_digits),round(float(p[1]),point_digits))
 for e in saved.modelspace():
  by_type[e.dxftype()]+=1;ps=[];closed=False
  if e.dxftype()=='LINE':actual[segment(q(e.dxf.start),q(e.dxf.end))]+=1
  elif e.dxftype()=='LWPOLYLINE':
   ps=[q(p) for p in e.get_points('xy')];closed=e.closed
  elif e.dxftype()=='HATCH':
   for ring in e.paths:
    if not hasattr(ring,'vertices'):unsupported.append({'dxf_handle':e.dxf.handle,'reason':'edge hatch audit not implemented'});continue
    pp=[q(p) for p in ring.vertices]
    for a,b in zip(pp,pp[1:]+pp[:1]):
     if a!=b:actual[segment(a,b)]+=1
  elif e.dxftype()=='TEXT':text_actual[(e.dxf.text,q(e.dxf.insert))]+=1
  elif e.dxftype() not in ['SPLINE']:unsupported.append({'dxf_handle':e.dxf.handle,'type':e.dxftype()})
  if ps:
   for a,b in zip(ps,ps[1:]+ps[:1] if closed else ps[1:]):
    if a!=b:actual[segment(a,b)]+=1
 missing=expected-actual;extra=actual-expected;missing_text=text_expected-text_actual;extra_text=text_actual-text_expected
 source_ok=not(missing or extra or missing_text or extra_text or unsupported)
 return {'source_geometry_exact_within_rounding':source_ok,'dxf_units_mm':saved.units==4,'source_segments':sum(expected.values()),'dxf_segments':sum(actual.values()),'missing_segments':sum(missing.values()),'unexpected_segments':sum(extra.values()),'source_text_spans':sum(text_expected.values()),'dxf_text_spans':sum(text_actual.values()),'missing_or_moved_text':sum(missing_text.values()),'extra_or_changed_text':sum(extra_text.values()),'dxf_types':dict(by_type),'unsupported':unsupported,'mm_per_pt':mm_per_pt,'coordinate_rounding_mm':10**-point_digits,'dimension_scale_and_function_semantics':'REQUIRE_SEPARATE_CHECK','complete_replication_claim':False}
