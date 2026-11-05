"""Deterministic synthetic drawings. Raster/SVG inputs are drawn independently of DXF.

The generator and reference plans are test authoring tools, never model outputs.
Only PNG + the separate module brief are sent to the model, not truth/contracts.
"""
import json,math,html
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from .storage import write,sha

BATCH_ID='df73d272-cd31-4ffb-8dfc-54de8cce579b'

def polygon(cid,points):return {'op':'polyline','id':cid,'points':points,'closed':True}
def rect(w,h):return [[0,0],[w,0],[w,h],[0,h]]
def graph(variant):
 count=3+variant%3;roles=['mount','locate','guide','clamp','inspect'][:count]
 nodes=[{'id':r+'_module','role':r} for r in roles]
 pairs=[(i,i+1) for i in range(count-1)]
 if count==5:pairs=[(0,1),(0,2),(1,3),(2,3),(3,4)]
 return {'nodes':nodes,'edges':[{'id':f'link_{a}_{b}','from':nodes[a]['id'],'to':nodes[b]['id']} for a,b in pairs]}

def functional(g):
 commands=[polygon('outline',[[-2,-8],[68,-8],[68,16],[-2,16]])];boxes={}
 for i,n in enumerate(g['nodes']):
  x=i*12;y=0
  if len(g['nodes'])==5:
   x=[0,15,15,34,49][i];y=[2,8,-4,2,2][i]
  boxes[n['id']]=[x,y,x+8,y+4];commands.append(polygon(n['id'],[[x,y],[x+8,y],[x+8,y+4],[x,y+4]]))
 for e in g['edges']:
  a,b=boxes[e['from']],boxes[e['to']];commands.append({'op':'line','id':e['id'],'points':[[a[2],(a[1]+a[3])/2],[b[0],(b[1]+b[3])/2]]})
 return {'id':'functional','title':'FUNCTIONAL SCHEMATIC - NOT MANUFACTURING','commands':commands}

def make_case(family,i):
 w=12+2*i;l=18+3*i;h=4+i*.5;cs=[];features=[];caption=[];extra={}
 front=rect(w,h);top=rect(w,l);front_commands=[];top_commands=[]
 if family=='groove':
  n=[2,3,4,6,8][i];pitch=[1.2,1.3,1.4,1.5,1.6][i];a=[60,90,120,60,90][i];depth=.25+.03*i;first=(w-(n-1)*pitch)/2
  cs=[first+j*pitch for j in range(n)];half=depth*math.tan(math.radians(a/2));cut=[]
  for x in reversed(cs):cut.extend([[x+half,h],[x,h-depth],[x-half,h]])
  front=[[0,0],[w,0],[w,h]]+cut+[[0,h]]
  arr={'op':'groove_array','id':'channels','groups':1,'channels':n,'pitch':pitch,'group_step':n*pitch,'first':first,'angle':a,'height':h,'depth':depth,'root_radius':0}
  front_commands=[{**arr,'mode':'section'}];top_commands=[{**arr,'mode':'plan','run_start':1,'run_end':l-1}]
  # Compiler receives uncut rectangle, while independent raster/reference truth uses explicit V cuts.
  caption=[f'{n} V GROOVES; PITCH {pitch:g}; FIRST X {first:g}',f'INCLUDED ANGLE {a:g} deg; DEPTH {depth:g}; SHARP ROOT',f'TOP GROOVES Y=1 TO {l-1:g}; NO HOLES']
  extra={'channels':{'count':n,'pitch':pitch,'centers':cs,'angle':a,'depth':depth,'run':[1,l-1]}}
 elif family=='step':
  step=1+.25*i;left=3+.5*i;right=w-left
  front=[[0,0],[w,0],[w,h-step],[right,h-step],[right,h],[left,h],[left,h-step],[0,h-step]]
  cs=[[left*.5,l*.35],[w-left*.5,l*.35]];r=.6+.08*i
  top_commands=[{'op':'circle','id':f'hole_{j}','center':p,'radius':r} for j,p in enumerate(cs)]
  # Top-view shoulder projection, actual edges separate from closed outline.
  for j,x in enumerate([left,right]):top_commands.append({'op':'line','id':f'shoulder_{j}','points':[[x,0],[x,l]]})
  caption=[f'SHOULDER HEIGHT {h-step:g}; UPPER SPAN X={left:g} TO {right:g}',f'2 THRU HOLES DIA {2*r:g}; CENTERS ({cs[0][0]:g},{cs[0][1]:g}) / ({cs[1][0]:g},{cs[1][1]:g})','TOP SHOULDER PROJECTIONS AT UPPER SPAN LIMITS']
 elif family=='chamfer':
  c=1+.25*i;angle=[30,45,60,45,30][i];rise=c*math.tan(math.radians(angle))
  front=[[0,0],[w,0],[w,h-rise],[w-c,h],[c,h],[0,h-rise]]
  r=.7+.08*i;cs=[[w*.25,l*.3],[w*.75,l*.7]]
  top_commands=[{'op':'circle','id':f'hole_{j}','center':p,'radius':r} for j,p in enumerate(cs)]
  for j,x in enumerate([c,w-c]):top_commands.append({'op':'line','id':f'chamfer_{j}','points':[[x,0],[x,l]]})
  caption=[f'TWO FRONT UPPER CORNERS: HORIZONTAL CHAMFER {c:g}; ANGLE TO X {angle:g} deg',f'2 THRU HOLES DIA {2*r:g}; CENTERS ({cs[0][0]:g},{cs[0][1]:g}) / ({cs[1][0]:g},{cs[1][1]:g})','TOP CHAMFER PROJECTIONS AT FRONT UPPER HORIZONTAL EDGE ENDS']
 else:
  n=[1,2,4,6,8][i];r=.65+.05*i;cs=[[w*.25,l*.25],[w*.75,l*.25]]
  top_commands=[{'op':'circle','id':f'hole_{j}','center':p,'radius':r} for j,p in enumerate(cs)]
  top_commands.append({'op':'line','id':'input_lead','points':[[0,l*.5],[-3-i,l*.5]]})
  for j in range(n):
   y=l*(j+1)/(n+1);top_commands.append({'op':'line','id':f'output_{j}','points':[[w,y],[w+4+i,y]]})
  caption=[f'2 THRU HOLES DIA {2*r:g}; CENTERS ({cs[0][0]:g},{cs[0][1]:g}) / ({cs[1][0]:g},{cs[1][1]:g})',f'ONE INPUT LEFT: Y={l*.5:g}, LENGTH {3+i:g}; {n} OUTPUTS RIGHT LENGTH {4+i:g}',f'OUTPUT Y= LENGTH * k/({n+1}), k=1..{n}; LEADS ARE SCHEMATIC']
  extra={'outputs':n}
 name=f'S20-{["groove","step","chamfer","breakout"].index(family)*5+i+1:02d}-{family}.png';g=graph(i)
 outlines={'front':front,'top':top}
 dims=lambda axis,value:{'op':'dimension','id':'overall_'+axis,'measure':'outline_extent','axis':axis,'feature':'outline','text':str(value)}
 views=[{'id':'front','title':'FRONT','commands':[polygon('outline',rect(w,h) if family=='groove' else front)]+front_commands+[dims('x',w),dims('y',h)]},{'id':'top','title':'TOP','commands':[polygon('outline',top)]+top_commands+[dims('x',w),dims('y',l)]},functional(g)]
 row={'source':name,'title':'SYNTHETIC REFERENCE - NOT MODEL OUTPUT','notes':['Synthetic deterministic validation fixture, mm'],'uncertainties':['No manufacturing acceptance; no GD&T/material specification'],'views':views}
 rules=[]
 def rule(kind,view,**kw):rules.append({'id':f'r{len(rules)+1}','kind':kind,'view':view,**kw})
 for v,y in [('front',h),('top',l)]:
  for axis,value in [('x',w),('y',y)]:rule('bbox',v,axis=axis,value=value);rule('dimension',v,feature='overall_'+axis,value=value)
 rule('same_extent','front',axis='x',other_view='top')
 if family=='groove':
  ch=extra['channels'];rule('channel_array','front',mode='section',centers=ch['centers'],angle=ch['angle'],angle_tol=.01);rule('channel_array','top',mode='plan',centers=ch['centers'],run=ch['run']);rule('circle_pattern','top',radii=[],exact=True)
 else:
  rule('circle_pattern','top',radii=[c['radius'] for c in top_commands if c['op']=='circle'],centers=cs,exact=True,material_contained=True)
 if family=='breakout':
  rule('line_bundle','top',base='outline',axis='x',side='min',count=1,min_run=3+i);rule('line_bundle','top',base='outline',axis='x',side='max',count=extra['outputs'],min_run=4+i)
 rule('horizontal_levels','functional',min=2)
 spec={'required_views':['front','top','functional'],'nominal_length':l,'coverage_complete':False,'rules':rules,'unresolved':['Synthetic controlled geometry only; not a real-world holdout or manufacturing acceptance']}
 truth={'family':family,'variant':i,'outlines':outlines,'commands':{'top':top_commands},'graph':g,'extra':extra,'width':w,'length':l,'height':h,'captions':caption}
 return name,{'drawings':[row]},spec,truth

def draw_source(path,name,truth):
 """Independent PIL+SVG linework, using explicit source geometry rather than ezdxf."""
 image=Image.new('RGB',(1800,1280),'white');d=ImageDraw.Draw(image);svg=[]
 fp=next((p for p in ['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'] if Path(p).exists()),None)
 def font(n):return ImageFont.truetype(fp,n) if fp else ImageFont.load_default()
 def line(points,color='#172638',width=3):
  d.line(points,fill=color,width=width);svg.append('<polyline points="'+ ' '.join(f'{x:.3f},{y:.3f}' for x,y in points)+f'" fill="none" stroke="{color}" stroke-width="{width}"/>')
 def text(x,y,s,n=24):
  d.text((x,y),s,font=font(n),fill='#172638');svg.append(f'<text x="{x}" y="{y+n*.85}" font-size="{n}" fill="#172638">{html.escape(s)}</text>')
 text(55,25,name+'  |  SYNTHETIC TECHNICAL DRAWING',30);text(55,75,'ALL DIMENSIONS mm. Sharp edges unless shown. Origin (0,0) at each view bottom-left.',24)
 width,length,height=truth['width'],truth['length'],truth['height']
 scale=min(560/(width+15),610/length);origins={'front':(160,650),'top':(1030,820)}
 for v,(ox,oy) in origins.items():
  def p(q):return (ox+q[0]*scale,oy-q[1]*scale)
  pts=truth['outlines'][v];line([p(q) for q in pts+[pts[0]]]);text(ox,oy+65,v.upper()+'   x ->, y ^',25);text(ox-40,oy+12,'(0,0)',20)
  if v=='top':
   for c in truth['commands']['top']:
    if c['op']=='circle':
     x,y=p(c['center']);r=c['radius']*scale;d.ellipse([x-r,y-r,x+r,y+r],outline='#172638',width=3);svg.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#172638" stroke-width="3"/>')
    elif c['op']=='line':line([p(q) for q in c['points']])
    elif c['op']=='groove_array':
     ch=truth['extra']['channels'];half=ch['depth']*math.tan(math.radians(ch['angle']/2))
     for x in ch['centers']:line([p([x-half,1]),p([x-half,length-1]),p([x+half,length-1]),p([x+half,1]),p([x-half,1])])
  yy=height if v=='front' else length
  line([p([0,-1]),p([width,-1])],width=2);text(ox+width*scale/2-24,oy+scale+8,f'{width:g}',23)
  xdim=-1.5;line([p([xdim,0]),p([xdim,yy])],width=2);text(ox-95,oy-yy*scale/2,f'{yy:g}',23)
  for x in [0,width]:line([p([x,0]),p([x,-1.25])],width=1)
  for y in [0,yy]:line([p([0,y]),p([-1.8,y])],width=1)
 text(55,955,'DRAWING NOTES / DATUM DIMENSIONS',26)
 for i,c in enumerate(truth['captions']):text(55,1005+i*42,c,23)
 text(55,1160,'Functional roles and links are specified separately in functional_modules.md.',24)
 text(55,1210,'Synthetic development case: not a manufacturer drawing, not an independent blind test.',23)
 image.save(path);path.with_suffix('.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1280" viewBox="0 0 1800 1280"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif">'+''.join(svg)+'</g></svg>',encoding='utf-8')

def prepare(root):
 root=Path(root).resolve()
 if (root/'manifest.json').exists():raise ValueError('Frozen batch already exists; do not regenerate')
 root.mkdir(parents=True,exist_ok=True);entries=[]
 for family in ['groove','step','chamfer','breakout']:
  for i in range(5):
   name,plan,spec,truth=make_case(family,i);cid=Path(name).stem;job=root/'cases'/cid;(job/'sources').mkdir(parents=True)
   draw_source(job/'sources'/name,name,truth);g=truth['graph']
   meaning={'groove':'支承光纤并通过V槽阵列定位','step':'利用台阶支承及两孔安装定位','chamfer':'利用倒斜角轮廓避让并通过两孔固定','breakout':'通过盒体安装孔固定并保留输入及输出引线'}[family]
   brief=f'# {cid} 独立功能模块说明\n\n合成非敏感要求，不是制造商规格。制造视图功能：{meaning}。尺寸、角度、孔位和数量只从PNG读；本文件不提供验收真值。\n\n只为PNG输出一份drawing，包含front、top和functional。front/top采用图示局部原点。functional标题注明功能示意、非制造尺寸，增加一个真实闭合outline系统边界。以下每个模块各一个真实闭合polyline，用精确ID：\n'
   brief+='\n'.join('- '+n['id']+'：'+n['role'] for n in g['nodes'])
   brief+='\n\n模块互不重叠且在outline内；尺寸和布局可自行选取。以下每条连接各一个真实LINE，端点从来源框右边界连接到目标框左边界，不能用文字替代：\n'
   brief+='\n'.join('- '+e['id']+': '+e['from']+' -> '+e['to'] for e in g['edges'])
   brief+='\n\n引线是功能示意，不是加工长度要求。不得将本说明作为第二张drawing；未知制造公差保留待确认。\n'
   (job/'sources/functional_modules.md').write_text(brief,encoding='utf-8')
   contract={'version':'synthetic20-frozen-1','model_instructions':[],'drawings':{name:spec}}
   write(job/'contract.json',contract);write(job/'truth.json',truth);write(job/'reference_plan.json',plan)
   write(job/'job.json',{'model':'deepseek-flash','sources':['sources/'+name,'sources/functional_modules.md'],'expose_contract':False,'max_rounds':1,'max_output_tokens':20000})
   inputs=['sources/'+name,'sources/'+Path(name).with_suffix('.svg').name,'sources/functional_modules.md','contract.json','truth.json','reference_plan.json','job.json']
   entries.append({'id':cid,'family':family,'synthetic':True,'independent_blind_test':False,'source':name,'path':'cases/'+cid,'files':{p:sha(job/p) for p in inputs}})
 manifest={'batch_id':BATCH_ID,'scope':'20 new synthetic development cases, four geometry families; not independent generalization','max_inference_requests':20,'endpoint':'https://api.deepseek.com/chat/completions','model':'deepseek-flash','documented_version':'DeepSeek-V4.1-Flash-1017','first_case_counts_toward_limit':True,'automatic_retries':0,'numeric_contract_exposure':False,'entries':entries}
 write(root/'manifest.json',manifest);write(root/'manifest.sha256.json',{'sha256':sha(root/'manifest.json')})
 return manifest
