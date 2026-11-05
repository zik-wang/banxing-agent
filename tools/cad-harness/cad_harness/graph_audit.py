"""Check a host-owned functional graph against real, editable DXF entities."""
import math
import ezdxf
from ezdxf import bbox
from .engine import tags
from .audit import simple_outline,contains_point,on_outline

def audit_graph(path,spec):
 doc=ezdxf.readfile(path);block=doc.blocks.get('VIEW_functional');checks=[];shapes={}
 def add(cid,ok,actual):checks.append({'id':cid,'status':'PASS' if ok else 'FAIL','actual':actual})
 if block is None:
  add('functional_view',False,'missing');return {'failures':checks,'checks':checks}
 expected=['outline']+[n['id'] for n in spec['nodes']]
 for cid in expected:
  es=[e for e in block if e.dxftype()=='LWPOLYLINE' and tags(e)==['polyline',cid] and e.dxf.layer not in ['NOTES','REFERENCE','DIMENSIONS']]
  ok=len(es)==1 and simple_outline(es[0])
  if ok and cid!='outline':
   ps=list(es[0].get_points('xyb'));bb=bbox.extents(es)
   corners={(round(bb.extmin.x,7),round(bb.extmin.y,7)),(round(bb.extmax.x,7),round(bb.extmin.y,7)),(round(bb.extmax.x,7),round(bb.extmax.y,7)),(round(bb.extmin.x,7),round(bb.extmax.y,7))}
   ok=len(ps)==4 and all(abs(p[2])<1e-10 for p in ps) and {(round(p[0],7),round(p[1],7)) for p in ps}==corners
  add('closed_'+cid,ok,len(es))
  if ok:shapes[cid]=es[0]
 actual_count=len([e for e in block if e.dxftype()=='LWPOLYLINE' and e.dxf.layer not in ['NOTES','REFERENCE','DIMENSIONS']])
 add('module_count',actual_count==len(expected),actual_count)
 for cid in expected[1:]:
  ps=list(shapes[cid].get_points('xy')) if cid in shapes else []
  samples=[q for a,b in zip(ps,ps[1:]+ps[:1]) for q in [a,((a[0]+b[0])/2,(a[1]+b[1])/2)]]
  ok=cid in shapes and 'outline' in shapes and all(contains_point(shapes['outline'],p[:2]) for p in samples)
  add('contained_'+cid,ok,ok)
 ids=expected[1:]
 for i,a in enumerate(ids):
  for b in ids[i+1:]:
   ok=a in shapes and b in shapes
   if ok:
    x,y=bbox.extents([shapes[a]]),bbox.extents([shapes[b]])
    ok=x.extmax.x<y.extmin.x-1e-6 or y.extmax.x<x.extmin.x-1e-6 or x.extmax.y<y.extmin.y-1e-6 or y.extmax.y<x.extmin.y-1e-6
   add('nonoverlap_'+a+'_'+b,ok,ok)
 def port(e,p,side):
  bb=bbox.extents([e]);x=bb.extmin.x if side=='left' else bb.extmax.x
  return abs(p.x-x)<=1e-5 and bb.extmin.y-1e-5<=p.y<=bb.extmax.y+1e-5 and on_outline(p,e)
 lines=[e for e in block if e.dxftype()=='LINE' and e.dxf.layer not in ['NOTES','REFERENCE','DIMENSIONS']]
 add('connection_count',len(lines)==len(spec['edges']),len(lines))
 for edge in spec['edges']:
  es=[e for e in lines if tags(e)==['line',edge['id']]];a,b=edge['from'],edge['to'];ok=len(es)==1 and a in shapes and b in shapes
  if ok:
   e=es[0];ok=port(shapes[a],e.dxf.start,'right') and port(shapes[b],e.dxf.end,'left') and math.dist(e.dxf.start,e.dxf.end)>1e-6
  add('attached_'+edge['id'],ok,len(es))
 return {'checks':checks,'failures':[x for x in checks if x['status']=='FAIL'],'scope':'host-defined schematic topology, not manufacturing acceptance'}
