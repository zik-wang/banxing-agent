"""Audit real functional-module entities and attached ports, not model text claims."""
import math
import ezdxf
from ezdxf import bbox
from cad_harness.engine import tags
from cad_harness.audit import simple_outline,contains_point

MODULE_IDS=['mount_module','locate_module','fasten_module']
CONNECTIONS=[('support_to_locate','mount_module','locate_module'),('locate_to_fasten','locate_module','fasten_module')]

def audit_modules(path):
 doc=ezdxf.readfile(path);block=doc.blocks.get('VIEW_functional');checks=[];shapes={}
 def add(cid,ok,actual):checks.append({'id':cid,'status':'PASS' if ok else 'FAIL','actual':actual})
 if block is None:
  add('functional_view_exists',False,False)
  return {'status':'MODULE_FAILED','checks':checks,'failures':checks,'scope':'functional schematic only, not manufacturing acceptance'}
 add('functional_view_exists',True,True)
 for cid in ['outline']+MODULE_IDS:
  entities=[e for e in block if tags(e)==['polyline',cid] and e.dxftype()=='LWPOLYLINE' and e.dxf.layer not in ['REFERENCE','NOTES','DIMENSIONS']]
  valid=len(entities)==1 and simple_outline(entities[0])
  add('closed_entity_'+cid,valid,{'entity_count':len(entities),'simple_closed':valid})
  if valid:shapes[cid]=entities[0]
 if all(cid in shapes for cid in MODULE_IDS):
  boxes=[bbox.extents([shapes[cid]]) for cid in MODULE_IDS]
  ordered=all(a.extmax.x<b.extmin.x-1e-6 for a,b in zip(boxes,boxes[1:]))
  add('three_modules_ordered_without_overlap',ordered,[[b.extmin.x,b.extmax.x] for b in boxes])
 else:add('three_modules_ordered_without_overlap',False,'missing or invalid real module boundary')
 for cid in MODULE_IDS:
  contained=cid in shapes and 'outline' in shapes and all(contains_point(shapes['outline'],p[:2]) for p in shapes[cid].get_points('xy'))
  add('inside_diagram_boundary_'+cid,contained,contained)
 for lid,source,target in CONNECTIONS:
  es=[e for e in block if e.dxftype()=='LINE' and tags(e)==['line',lid] and e.dxf.layer not in ['REFERENCE','NOTES','DIMENSIONS']]
  ok=len(es)==1 and source in shapes and target in shapes;actual={'line_count':len(es)}
  if ok:
   a,z=es[0].dxf.start,es[0].dxf.end;left=bbox.extents([shapes[source]]);right=bbox.extents([shapes[target]])
   actual.update(start=list(a)[:2],end=list(z)[:2])
   ok=abs(a.x-left.extmax.x)<=1e-5 and left.extmin.y-1e-5<=a.y<=left.extmax.y+1e-5 and abs(z.x-right.extmin.x)<=1e-5 and right.extmin.y-1e-5<=z.y<=right.extmax.y+1e-5 and math.dist(a,z)>1e-6
  add('attached_ports_'+lid,ok,actual)
 failures=[c for c in checks if c['status']=='FAIL']
 return {'status':'MODULE_FAILED' if failures else 'MODULE_SCOPE_PASS','checks':checks,'failures':failures,'scope':'functional schematic only, not manufacturing acceptance'}
