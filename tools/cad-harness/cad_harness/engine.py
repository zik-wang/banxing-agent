import math,textwrap,io
from pathlib import Path
import ezdxf
from ezdxf import bbox
from ezdxf.addons.drawing import RenderContext,Frontend,layout,pymupdf,config
from PIL import Image,ImageChops,ImageOps
def fillet_vertices(ps,fillets):
 if not fillets:return ps
 p=[(x[0],x[1]) for x in ps];trim={};n=len(p)
 for f in fillets:
  i=int(f['vertex']);r=float(f['radius'])
  if i in trim or not 0<=i<n or r<=0:raise ValueError('invalid corner fillet')
  a,o,z=p[(i-1)%n],p[i],p[(i+1)%n];la=math.dist(a,o);lz=math.dist(z,o)
  if min(la,lz)<1e-10:raise ValueError('degenerate fillet corner')
  u=((a[0]-o[0])/la,(a[1]-o[1])/la);v=((z[0]-o[0])/lz,(z[1]-o[1])/lz);alpha=math.acos(max(-1,min(1,u[0]*v[0]+u[1]*v[1])))
  if not 1e-6<alpha<math.pi-1e-6:raise ValueError('fillet on straight/degenerate vertex')
  t=r/math.tan(alpha/2)
  if t>=min(la,lz):raise ValueError('fillet exceeds adjacent segment')
  cross=(-u[0])*v[1]-(-u[1])*v[0];bulge=math.copysign(math.tan((math.pi-alpha)/4),cross)
  trim[i]=(t,(o[0]+u[0]*t,o[1]+u[1]*t,bulge),(o[0]+v[0]*t,o[1]+v[1]*t,0))
 for i in range(n):
  if trim.get(i,(0,))[0]+trim.get((i+1)%n,(0,))[0]>=math.dist(p[i],p[(i+1)%n]):raise ValueError('adjacent fillets overlap')
 out=[]
 for i,q in enumerate(ps):out.extend(trim[i][1:] if i in trim else [q])
 return out
def profile_path(c):
 out=[tuple(c['start'])]
 for step in c['steps']:
  x,y=out[-1][:2]
  if 'to' in step:x,y=step['to']
  elif 'to_x' in step:x=step['to_x']
  elif 'to_y' in step:
   yy=step['to_y']
   if 'angle' in step:
    tangent=math.tan(math.radians(step['angle']))
    if abs(tangent)<1e-10:raise ValueError('to_y slope cannot be horizontal')
    x+=(yy-y)/tangent
   y=yy
  else:raise ValueError('unknown profile step')
  out.append((x,y))
 if out[-1]==out[0]:out.pop()
 return fillet_vertices(out,c.get('fillets',[]))
def tag(e,kind,name):e.set_xdata('CAD_AUDIT',[(1000,kind),(1000,name)])
def tags(e):
 return [a.value for a in e.get_xdata('CAD_AUDIT')] if e.has_xdata('CAD_AUDIT') else []
def num(v):
 if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v):raise ValueError('Invalid numeric geometry')
 if abs(v)>10000:raise ValueError('Geometry out of bounds')
 return v
def points(ps):
 if not isinstance(ps,list) or not 2<=len(ps)<=5000:raise ValueError('Invalid point list')
 return [tuple(num(x) for x in p) for p in ps]
def centers(c):
 g,k=int(c['groups']),int(c['channels'])
 if not 1<=g*k<=2000:raise ValueError('Invalid array size')
 return [num(c['first'])+i*num(c['group_step'])+j*num(c['pitch']) for i in range(g) for j in range(k)]
def vpath(x,c):
 h,depth,angle=c['height'],c['depth'],c['angle'];a=math.radians(angle/2);half=depth*math.tan(a);r=c.get('root_radius',0)
 if not r:return [(x-half,h,0),(x,h-depth,0),(x+half,h,0)]
 distance=r/math.tan(a);dx=distance*math.sin(a);dy=distance*math.cos(a)
 return [(x-half,h,0),(x-dx,h-depth+dy,math.tan((math.pi-2*a)/4)),(x+dx,h-depth+dy,0),(x+half,h,0)]
def reverse_path(p):
 return [(q[0],q[1],-p[len(p)-2-i][2] if i<len(p)-1 else 0) for i,q in enumerate(reversed(p))]
def cut_outline(ps,c):
 """Replace a shared flat top edge with explicit V notches, preserving a closed boundary."""
 h,depth,angle=c['height'],c['depth'],c['angle'];half=depth*math.tan(math.radians(angle/2));cs=centers(c);out=[]
 for i,a in enumerate(ps):
  b=ps[(i+1)%len(ps)];out.append(a)
  if abs(a[1]-h)<1e-8 and abs(b[1]-h)<1e-8 and min(a[0],b[0])<=cs[0]-half and max(a[0],b[0])>=cs[-1]+half:
   reverse=b[0]<a[0]
   for x in (list(reversed(cs)) if reverse else cs):
    q=vpath(x,c)
    out.extend(reverse_path(q) if reverse else q)
 return out
def compile_one(row, output_dir, contract):
 doc=ezdxf.new('R2013');doc.units=4;doc.appids.new('CAD_AUDIT');doc.styles.new('CN',dxfattribs={'font':'simsun.ttc'})
 for name,color in [('GEOMETRY',7),('CHANNELS',4),('NOTES',7),('DIMENSIONS',2),('UNCERTAIN',1),('REFERENCE',8)]:doc.layers.new(name,dxfattribs={'color':color})
 ms=doc.modelspace();font=max(.09,contract.get('nominal_length',10)/110);view_meta=[];blocks=[]
 for view in row['views']:
  if not view['id'].replace('_','').isalnum():raise ValueError('Invalid view id')
  b=doc.blocks.new('VIEW_'+view['id']);cmds=view['commands'];dims=[];section=next((c for c in cmds if c['op']=='groove_array' and c['mode']=='section'),None)
  for c in cmds:
   op=c['op'];layer='UNCERTAIN' if c.get('status')=='uncertain' else 'GEOMETRY';attr={'layer':layer}
   if op in ['polyline','profile_path']:
    ps=profile_path(c) if op=='profile_path' else fillet_vertices(points(c['points']),c.get('fillets',[]));base=ps[:]
    if section and c.get('id')=='outline':ps=cut_outline(ps,section)
    e=b.add_lwpolyline([(p[0],p[1],0,0,p[2] if len(p)>2 else 0) for p in ps],close=c.get('closed',True),dxfattribs=attr);tag(e,'polyline',c.get('id','unnamed'))
    # Feature segments are extracted from the real outline's vertices, never a model assertion.
    for name,idx in c.get('feature_segments',{}).items():
     idx=int(idx);a,z=base[idx],base[(idx+1)%len(base)]
     fe=b.add_line(a[:2],z[:2],dxfattribs={'layer':'REFERENCE'});tag(fe,'outline_feature',name)
   elif op=='line':
    ps=points(c['points']);e=b.add_line(ps[0][:2],ps[1][:2],dxfattribs=attr);tag(e,'line',c.get('id','unnamed'))
   elif op=='circle':b.add_circle(c['center'],num(c['radius']),dxfattribs=attr)
   elif op=='dimension':dims.append(c)
   elif op=='groove_array':
    mode=c['mode'];cs=centers(c);depth=num(c.get('depth',.155884572681));angle=num(c.get('angle',60))
    if (not 0<depth<10 and not (mode=='plan' and c.get('width',0)>0)) or not 0<angle<180:raise ValueError('Invalid V profile: section needs positive depth; plan can use explicit positive width')
    half=c.get('width',2*depth*math.tan(math.radians(angle/2)))/2
    for i,x in enumerate(cs):
     if mode=='section':
      h=num(c['height']);ps=vpath(x,c)
      e=b.add_lwpolyline(ps,format='xyb',dxfattribs={'layer':'CHANNELS'});tag(e,'section_channel',str(i))
     elif mode=='plan':
      lo,hi=num(c['run_start']),num(c['run_end']);dx=(hi-lo)*math.tan(math.radians(c.get('lean_deg',0)))
      e=b.add_lwpolyline([(x-half,lo),(x-half+dx,hi),(x+half+dx,hi),(x+half,lo)],close=True,dxfattribs={'layer':'CHANNELS'});tag(e,'plan_channel',str(i))
      b.add_line((x,lo),(x+dx,hi),dxfattribs={'layer':'CHANNELS'})
     else:raise ValueError('Unknown array mode')
   else:raise ValueError('Unknown CAD operation '+op)
  box=bbox.extents(b);xmin,ymin=box.extmin.x,box.extmin.y;xmax,ymax=box.extmax.x,box.extmax.y
  for i,c in enumerate(dims):
   if c.get('measure')=='outline_extent':
    shape=next((e for e in b if tags(e)==['polyline',c.get('feature','outline')]),None)
    if shape is None:raise ValueError(f'{row["source"]}/{view["id"]}/{c.get("id")}: extent dimension refers to missing polyline feature {c.get("feature","outline")!r}; create it or reference the existing real outline')
    ps=list(shape.get_points('xy'));axis=0 if c['axis']=='x' else 1;lo=min(p[axis] for p in ps);hi=max(p[axis] for p in ps)
    aa=[p for p in ps if abs(p[axis]-lo)<1e-8];zz=[p for p in ps if abs(p[axis]-hi)<1e-8]
    a,z=min(((a,z) for a in aa for z in zz),key=lambda pair:abs(pair[0][1-axis]-pair[1][1-axis]));angle=0 if axis==0 else 90
   else:a,z=c['p1'],c['p2'];angle=c.get('angle',0)
   num(angle)
   offset=font*(4+3*(i//2));base=(xmin-offset,a[1]) if angle==90 else (a[0],ymax+offset)
   dim=b.add_linear_dim(base=base,p1=a,p2=z,angle=angle,text=c.get('text','<>'),override={'dimtxt':font,'dimasz':font*.65,'dimgap':font*.3,'dimtxsty':'CN','dimtad':1},dxfattribs={'layer':'DIMENSIONS'});dim.render();tag(dim.dimension,'dimension',c.get('id','unnamed'))
  box=bbox.extents(b);b.add_text(view['title']+' | 基本视图1:1',dxfattribs={'insert':(box.extmin.x,box.extmin.y-font*3),'height':font,'style':'CN','layer':'NOTES'})
  blocks.append((view,b,bbox.extents(b)))
 # A uniform three-column grid; all inserts have unit scale.
 cellw=max(x[2].size.x for x in blocks)+font*14;cellh=max(x[2].size.y for x in blocks)+font*16
 for i,(v,b,bb) in enumerate(blocks):
  xy=((i%3)*cellw-bb.extmin.x,-(i//3)*cellh-bb.extmin.y)
  ms.add_blockref(b.name,xy);view_meta.append({'view':v['id'],'block':b.name,'origin':xy})
 placed=bbox.extents(ms);head=placed.extmax.y+font*7
 ms.add_text(row['source']+'  '+row['title'],dxfattribs={'insert':(0,head),'height':font*1.7,'style':'CN'})
 ms.add_text('DeepSeek计划 + CAD阵列工具 | mm | 自动检查与人工待核并列记录',dxfattribs={'insert':(0,head-font*3),'height':font*.85,'style':'CN'})
 bottom=placed.extmin.y-font*7
 strings=['技术要求：']+row.get('notes',[])+['仍需人工确认：']+row.get('uncertainties',[])
 line=0
 for text in strings:
  for s in textwrap.wrap(text,90) or ['']:
   ms.add_text(s,dxfattribs={'insert':(0,bottom-line*font*1.9),'height':font*.85,'style':'CN','layer':'NOTES'});line+=1
 f=Path(output_dir)/(Path(row['source']).stem+'_deepseek_harness.dxf');doc.saveas(f)
 return f,view_meta

def render(path):
 d=ezdxf.readfile(path);backend=pymupdf.PyMuPdfBackend();Frontend(RenderContext(d),backend,config=config.Configuration(background_policy=config.BackgroundPolicy.WHITE,color_policy=config.ColorPolicy.BLACK)).draw_layout(d.modelspace(),finalize=True)
 data=backend.get_pixmap_bytes(layout.Page(297,210,margins=layout.Margins.all(8)),dpi=210)
 im=Image.open(io.BytesIO(data)).convert('RGB');bounds=ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox()
 if bounds:im=ImageOps.expand(im.crop(bounds),border=24,fill='white')
 im.save(path.with_suffix('.png'))
