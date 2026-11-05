"""Source contract is immutable. All measurements come from saved CAD entities."""
import math
import ezdxf
from ezdxf import bbox
from ezdxf.math import bulge_to_arc
from ezdxf.path import make_path
from .engine import tags
def outline(block,feature='outline'):
 return next((e for e in block if tags(e)==['polyline',feature]),None)
def vertices(e):return list(e.get_points('xyb'))
def segments(e):
 p=vertices(e)
 return [(p[i],p[(i+1)%len(p)]) for i in range(len(p) if e.closed else len(p)-1)]
def angles(e):
 for a,b in segments(e):
  if abs(a[2])<1e-12 and math.dist(a[:2],b[:2])>1e-10:yield math.degrees(math.atan2(abs(b[1]-a[1]),abs(b[0]-a[0])))
def radii(e):
 for a,b in segments(e):
  if abs(a[2])>1e-12:yield float(bulge_to_arc(a[:2],b[:2],a[2])[3])
def near(a,b,t=1e-5):return abs(a-b)<=t
def same_point(a,b):return near(a[0],b[0]) and near(a[1],b[1])
def on_outline(point,shape):
 if shape is None:return False
 for a,b in segments(shape):
  if same_point(point,a) or same_point(point,b):return True
  if abs(a[2])>1e-12:continue
  u=(b[0]-a[0],b[1]-a[1]);v=(point[0]-a[0],point[1]-a[1]);n=u[0]*u[0]+u[1]*u[1]
  if n and -1e-8<=(u[0]*v[0]+u[1]*v[1])/n<=1+1e-8 and abs(u[0]*v[1]-u[1]*v[0])/math.sqrt(n)<1e-5:return True
 return False
def boundary_contains(boundary,channel):
 edges=segments(boundary)
 return all(any((same_point(a,c) and same_point(b,d) and near(a[2],c[2])) or (same_point(a,d) and same_point(b,c) and near(a[2],-c[2])) for c,d in edges) for a,b in segments(channel))
def simple_outline(e):
 if e is None or not e.closed:return False
 pp=[]
 for v in make_path(e).flattening(.001):
  q=(v.x,v.y)
  if not pp or math.dist(q,pp[-1])>1e-8:pp.append(q)
 if len(pp)>1 and math.dist(pp[0],pp[-1])<1e-8:pp.pop()
 if len(pp)<3:return False
 if abs(sum(pp[i][0]*pp[(i+1)%len(pp)][1]-pp[(i+1)%len(pp)][0]*pp[i][1] for i in range(len(pp))))<1e-10:return False
 edges=[(pp[i],pp[(i+1)%len(pp)],i) for i in range(len(pp))]
 def orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 ordered=sorted(edges,key=lambda e:min(e[0][0],e[1][0]));active=[];n=len(edges)
 for a,b,i in ordered:
  lo=min(a[0],b[0]);active=[e for e in active if max(e[0][0],e[1][0])>=lo-1e-8]
  for c,d,j in active:
   if abs(i-j) in [1,n-1]:continue
   if max(min(a[1],b[1]),min(c[1],d[1]))>min(max(a[1],b[1]),max(c[1],d[1]))+1e-8:continue
   if any(math.dist(x,y)<1e-8 for x in [a,b] for y in [c,d]):return False
   o1,o2,o3,o4=orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)
   if o1*o2<-1e-16 and o3*o4<-1e-16:return False
   if max(abs(o1),abs(o2),abs(o3),abs(o4))<1e-10:
    axis=0 if abs(a[0]-b[0])>=abs(a[1]-b[1]) else 1
    if min(max(a[axis],b[axis]),max(c[axis],d[axis]))-max(min(a[axis],b[axis]),min(c[axis],d[axis]))>1e-8:return False
  active.append((a,b,i))
 return True

def contains_point(shape,point,tol=1e-5):
 if shape is None:return False
 ps=[(v.x,v.y) for v in make_path(shape).flattening(.0001)]
 x,y=point;inside=False
 for a,b in zip(ps,ps[1:]+ps[:1]):
  vx,vy=b[0]-a[0],b[1]-a[1];n=vx*vx+vy*vy
  if n:
   t=max(0,min(1,((x-a[0])*vx+(y-a[1])*vy)/n))
   if math.hypot(x-a[0]-t*vx,y-a[1]-t*vy)<=tol:return True
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
 return inside
def audit_file(path,spec):
 d=ezdxf.readfile(path);checks=[]
 for rule in spec['rules']:
  kind=rule['kind'];view=rule['view'];actual=None;why='';ok=False
  block=d.blocks.get('VIEW_'+view)
  try:
   if block is None:raise ValueError('missing view '+view)
   shape=outline(block,rule.get('feature','outline'))
   if kind in ['bbox','edge_angle','parallel_edges','radius','short_vertical','horizontal_levels','horizontal_span','turn_angle'] and shape is None:raise ValueError('missing outline feature')
   if kind=='bbox':
    bb=bbox.extents([shape]);actual=bb.size.x if rule['axis']=='x' else bb.size.y;ok=near(actual,rule['value'],rule.get('tol',1e-5))
   elif kind=='same_extent':
    other=d.blocks.get('VIEW_'+rule['other_view']);second=outline(other,rule.get('other_feature','outline')) if other else None
    if shape is None or second is None:raise ValueError('missing corresponding material outline')
    i=0 if rule['axis']=='x' else 1;actual=[bbox.extents([shape]).size[i],bbox.extents([second]).size[i]];ok=near(*actual,rule.get('tol',1e-5))
   elif kind=='upper_profile':
    if shape is None:raise ValueError('missing material outline')
    level=rule['level']+1e-7;ps=[(p.x,p.y) for p in make_path(shape).flattening(.0001)];upper=[p for p in ps if p[1]>=level]
    for a,z in zip(ps,ps[1:]+ps[:1]):
     if (a[1]<level<z[1]) or (z[1]<level<a[1]):upper.append((a[0]+(z[0]-a[0])*(level-a[1])/(z[1]-a[1]),level))
    actual={'points_above_base':len(upper)};ok=False
    if upper:
     lo=min(p[0] for p in upper);hi=max(p[0] for p in upper);actual.update(width=hi-lo,height=max(p[1] for p in upper)-rule['level']);ok=rule['width_min']<=hi-lo<=rule['width_max'] and actual['height']>1e-6
     if rule.get('centered'):
      bb=bbox.extents([shape]);ok=ok and near((lo+hi)/2,(bb.extmin.x+bb.extmax.x)/2,rule.get('tol',.001))
   elif kind=='edge_angle':
    actual=list(angles(shape));ok=any(near(a,rule['value'],rule.get('tol',1e-5)) for a in actual)
   elif kind=='parallel_edges':
    p=vertices(shape)
    if len(p)!=4:raise ValueError('expected quadrilateral outline')
    u=(p[3][0]-p[0][0],p[3][1]-p[0][1]);v=(p[2][0]-p[1][0],p[2][1]-p[1][1]);n=math.hypot(*u)*math.hypot(*v)
    actual=abs(u[0]*v[1]-u[1]*v[0])/n if n else None;ok=actual is not None and actual<=rule.get('tol',1e-5)
   elif kind=='turn_angle':
    p=vertices(shape);actual=[]
    for i,o in enumerate(p):
     a,z=p[i-1],p[(i+1)%len(p)]
     if abs(a[2])+abs(o[2])>1e-10:continue
     u=(a[0]-o[0],a[1]-o[1]);v=(z[0]-o[0],z[1]-o[1]);n=math.hypot(*u)*math.hypot(*v)
     if n>1e-12:actual.append(math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/n)))))
    ok=any(near(x,rule['value'],rule.get('tol',1e-5)) for x in actual)
   elif kind=='radius':
    actual=list(radii(shape));ok=any(rule['min']-1e-6<=x<=rule['max']+1e-6 for x in actual)
   elif kind=='short_vertical':
    actual=[abs(b[1]-a[1]) for a,b in segments(shape) if near(a[0],b[0]) and abs(b[1]-a[1])>1e-8];ok=any(rule['min']-1e-6<=x<=rule['max']+1e-6 for x in actual)
   elif kind=='horizontal_levels':
    actual=sorted({round(a[1],7) for a,b in segments(shape) if near(a[1],b[1]) and abs(b[0]-a[0])>1e-5});ok=len(actual)>=rule['min']
   elif kind=='horizontal_span':
    bb=bbox.extents([shape]);middle=(bb.extmin.x+bb.extmax.x)/2
    actual=[abs(b[0]-a[0]) for a,b in segments(shape) if near(a[1],rule['y']) and near(b[1],rule['y']) and abs(a[2])<1e-10 and (not rule.get('centered') or near((a[0]+b[0])/2,middle))]
    ok=any(rule['min']-1e-5<=x<=rule['max']+1e-5 for x in actual)
   elif kind=='dimension':
    es=[e for e in block if tags(e)==['dimension',rule['feature']]]
    actual=[float(e.get_measurement()) for e in es];ok=len(actual)==1 and near(actual[0],rule['value'],rule.get('tol',1e-5))
    if ok:
     bad=[list(getattr(es[0].dxf,k)) for k in ['defpoint2','defpoint3'] if not on_outline(getattr(es[0].dxf,k),outline(block))]
     if bad:why='Measured value matches, but dimension anchors are off the actual material outline: '+str(bad)+'. Use real outline vertices (on oblique edges use the actual shifted top corner), not an unshifted bounding rectangle.';ok=False
   elif kind=='line_position':
    e=next((e for e in block if tags(e)==['line',rule['feature']]),None)
    if e is None:raise ValueError('missing real line feature')
    i=0 if rule['axis']=='x' else 1;actual=[e.dxf.start[i],e.dxf.end[i]];span=abs(e.dxf.end[1-i]-e.dxf.start[1-i]);ok=all(near(x,rule['value'],rule.get('tol',1e-5)) for x in actual) and span>1e-6
    if 'span' in rule:ok=ok and near(span,rule['span'],rule.get('span_tol',1e-5))
   elif kind=='circle_relationship':
    cs=[e for e in block if e.dxftype()=='CIRCLE' and e.dxf.layer not in ['REFERENCE','NOTES','DIMENSIONS']]
    pairs=[(a,b) for a in cs for b in cs if a.dxf.radius+rule.get('min_wall',.01)<b.dxf.radius<=rule['max_radius'] and math.dist(a.dxf.center,b.dxf.center)<=rule.get('tol',1e-5)]
    actual={'concentric_pairs':[{'center':list(a.dxf.center)[:2],'radii':[a.dxf.radius,b.dxf.radius]} for a,b in pairs]};ok=bool(pairs)
    if rule.get('all_concentric'):ok=ok and all(math.dist(e.dxf.center,cs[0].dxf.center)<=rule.get('tol',1e-5) and e.dxf.radius<=rule['max_radius'] for e in cs)
   elif kind=='line_bundle':
    base=outline(block,rule.get('base','box'))
    if base is None:raise ValueError('missing actual attachment base')
    bb=bbox.extents([base]);axis=0 if rule.get('axis','x')=='x' else 1;j=1-axis;side=rule.get('side','max');anchor=bb.extmax[axis] if side=='max' else bb.extmin[axis];sign=1 if side=='max' else -1;levels=[]
    for e in block:
     if e.dxftype()!='LINE' or e.dxf.layer in ['REFERENCE','NOTES','DIMENSIONS']:continue
     for a,z in [(e.dxf.start,e.dxf.end),(e.dxf.end,e.dxf.start)]:
      if near(a[axis],anchor) and near(a[j],z[j]) and sign*(z[axis]-a[axis])>=rule.get('min_run',1) and bb.extmin[j]<a[j]<bb.extmax[j]:levels.append(a[j]);break
    actual={'transverse_levels':sorted({round(x,6) for x in levels}),'attachment_coordinate':anchor};ok=len(actual['transverse_levels'])==rule['count']
   elif kind=='outline_edges':
    if shape is None:raise ValueError('missing material outline')
    tol=rule.get('tol',1e-5);actual=[];ok=True
    for a,b in rule['edges']:
     found=any(abs(u[2])<1e-12 and ((math.dist(a,u[:2])<=tol and math.dist(b,v[:2])<=tol) or (math.dist(a,v[:2])<=tol and math.dist(b,u[:2])<=tol)) for u,v in segments(shape))
     actual.append({'edge':[a,b],'present':found});ok=ok and found
   elif kind=='circle_pattern':
    # Read actual circles, never labels or model supplied radii in metadata.
    circles=[e for e in block if e.dxftype()=='CIRCLE' and e.dxf.layer not in ['REFERENCE','NOTES','DIMENSIONS']]
    targets=rule['radii'];tol=rule.get('tol',1e-5);remaining=list(circles);matched=[]
    for i,r in enumerate(targets):
     candidates=[e for e in remaining if near(e.dxf.radius,r,tol) and ('centers' not in rule or math.dist(list(e.dxf.center)[:2],rule['centers'][i])<=rule.get('position_tol',tol))]
     if not candidates:break
     e=candidates[0];matched.append(e);remaining.remove(e)
    actual={'radii':[e.dxf.radius for e in circles],'centers':[list(e.dxf.center)[:2] for e in circles]}
    ok=len(matched)==len(targets)
    if rule.get('boundary_circle'):
     boundary=outline(block);arcs=[]
     if boundary is not None:
      for a,z in segments(boundary):
       if abs(a[2])<1e-12:arcs=[];break
       arc=bulge_to_arc(a[:2],z[:2],a[2]);arcs.append((arc[0],arc[3]))
     actual['boundary_arcs']=[{'center':list(c),'radius':r} for c,r in arcs]
     ok=ok and bool(arcs) and all(all(math.dist(c,list(e.dxf.center)[:2])<=tol and near(r,e.dxf.radius,tol) for c,r in arcs) for e in matched)
     if not ok:why='The actual circular material boundary and its reference outer circle must share center and radius. Do not draw two displaced outer bodies in one end view.'
    if rule.get('material_contained'):
     outside=[list(e.dxf.center)[:2] for e in matched if not all(contains_point(outline(block),(e.dxf.center.x+e.dxf.radius*math.cos(i*math.tau/32),e.dxf.center.y+e.dxf.radius*math.sin(i*math.tau/32))) for i in range(32))]
     actual['outside_material']=outside;ok=ok and not outside
     if outside:why='Actual hole circumferences extend outside material. Fix the actual material/positions, not radius labels.'
    if rule.get('below_feature'):
     feature=outline(block,rule['below_feature'])
     if feature is None:raise ValueError('missing feature for hole relationship')
     limit=bbox.extents([feature]).extmin.y;actual['below_feature_limit_y']=limit
     ok=ok and all(e.dxf.center.y+e.dxf.radius<=limit+tol for e in matched)
    if rule.get('exact'):ok=ok and len(circles)==len(targets)
    if 'pair_spacing' in rule:
     # A two-hole pattern must match both actual radii and center spacing.
     pairs=[(a,b) for i,a in enumerate(circles) for b in circles[i+1:] if near(a.dxf.radius,targets[0],tol) and near(b.dxf.radius,targets[1],tol)]
     actual['pair_vectors']=[[b.dxf.center.x-a.dxf.center.x,b.dxf.center.y-a.dxf.center.y] for a,b in pairs]
     if rule.get('pair_axis')=='x':pairs=[(a,b) for a,b in pairs if near(a.dxf.center.y,b.dxf.center.y,tol)]
     if rule.get('pair_axis')=='y':pairs=[(a,b) for a,b in pairs if near(a.dxf.center.x,b.dxf.center.x,tol)]
     actual['pair_distances']=[math.dist(a.dxf.center,b.dxf.center) for a,b in pairs]
     ok=ok and any(near(x,rule['pair_spacing'],rule.get('spacing_tol',tol)) for x in actual['pair_distances'])
   elif kind=='channel_array':
    mode=rule['mode'];es=[e for e in block if tags(e) and tags(e)[0]==mode+'_channel'];es.sort(key=lambda e:int(tags(e)[1]));ps=[vertices(e) for e in es]
    cs=[(p[0][0]+p[-1][0])/2 for p in ps];actual={'count':len(es),'centers':cs};target=rule['centers']
    compared=[x-cs[0] for x in cs] if rule.get('relative') and cs else cs
    ok=len(cs)==len(target) and all(near(a,b,rule.get('tol',1e-5)) for a,b in zip(compared,target))
    if mode=='section':
     aa=[];rr=[]
     for e,p in zip(es,ps):
      u=(p[0][0]-p[1][0],p[0][1]-p[1][1]);v=(p[-1][0]-p[-2][0],p[-1][1]-p[-2][1]);n=math.hypot(*u)*math.hypot(*v)
      aa.append(math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/n)))));rr+=list(radii(e))
     actual.update(angles=aa,root_radii=rr);ok=ok and len(aa)==len(target) and all(near(a,rule.get('angle',60),rule.get('angle_tol',2)) for a in aa)
     overlaps=[i for i in range(len(ps)-1) if max(p[0] for p in ps[i])>min(p[0] for p in ps[i+1])+1e-6]
     actual['overlapping_neighbors']=overlaps;ok=ok and not overlaps
     if overlaps:why='Actual adjacent V mouths overlap. Re-read source depth; do not use body height as groove depth.'
     if 'root_radius' in rule:ok=ok and len(rr)==len(target) and all(rule['root_radius']['min']-1e-6<=r<=rule['root_radius']['max']+1e-6 for r in rr)
     # Every facet/fillet must be in the actual closed material contour.
     boundary=outline(block)
     ok=ok and boundary is not None and boundary.closed and all(boundary_contains(boundary,e) for e in es)
    if mode=='plan' and 'run' in rule:
     bounds=[min(p[1] for q in ps for p in q),max(p[1] for q in ps for p in q)] if ps else [];actual['run']=bounds;ok=ok and len(bounds)==2 and all(near(a,b) for a,b in zip(bounds,rule['run']))
   else:raise ValueError('Unknown audit kind '+kind)
  except Exception as exc:why=str(exc);ok=False
  checks.append({'id':rule['id'],'kind':kind,'view':view,'status':'PASS' if ok else 'FAIL','actual':actual,'requirement':rule,'reason':why})
 for view in spec['required_views']:
  b=d.blocks.get('VIEW_'+view);valid=simple_outline(outline(b)) if b else False
  checks.append({'id':'simple_closed_material_'+view,'status':'PASS' if valid else 'FAIL','actual':valid,'reason':'main material boundary must be closed and cannot self-intersect'})
  channels=[e for e in b if tags(e) and tags(e)[0]=='plan_channel'] if b else []
  if channels:
   bad=[tags(e)[1] for e in channels if not all(contains_point(outline(b),p) for a,z in segments(e) for p in [a[:2],((a[0]+z[0])/2,(a[1]+z[1])/2)])]
   checks.append({'id':'plan_channels_contained_'+view,'status':'FAIL' if bad else 'PASS','actual':bad,'reason':'all plan groove boundaries must lie inside actual material, including edge midpoints'})
 errors=len(d.audit().errors);checks.append({'id':'dxf_structure','status':'PASS' if errors==0 else 'FAIL','actual':errors})
 failed=[x for x in checks if x['status']=='FAIL']
 status='GEOMETRY_FAILED' if failed else ('ACCEPTED' if spec.get('coverage_complete') else 'CHECKS_PASS_SCOPE_LIMITED')
 return {'status':status,'checks':checks,'failures':failed,'coverage_complete':spec.get('coverage_complete',False),'excluded_from_acceptance':spec.get('unresolved',[])}
