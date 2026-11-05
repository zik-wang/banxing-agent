"""Small declarative CAD language. Model output is data, never executable code."""
import math,re
ID=re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}$')
OPS={'polyline','profile_path','line','circle','dimension','groove_array'}
class PlanError(ValueError):pass
def validate_contract(contract):
 kinds={'bbox','same_extent','upper_profile','dimension','channel_array','circle_pattern','circle_relationship','line_bundle','outline_edges','turn_angle','edge_angle','parallel_edges','radius','short_vertical','horizontal_levels','horizontal_span','line_position'}
 if not isinstance(contract.get('drawings'),dict) or not contract['drawings']:raise PlanError('empty source contract')
 for src,s in contract['drawings'].items():
  if type(s.get('coverage_complete'))!=bool:raise PlanError('coverage_complete must be a boolean owned by host')
  views=s.get('required_views',[])
  if not views or any(not ID.fullmatch(v) for v in views) or len(set(views))!=len(views):raise PlanError('invalid required views')
  rules=s.get('rules',[]);ids=set()
  if not rules:raise PlanError('empty rules cannot establish acceptance')
  for r in rules:
   if r.get('kind') not in kinds or r.get('view') not in views or not ID.fullmatch(r.get('id','')) or r['id'] in ids:raise PlanError('invalid/duplicate audit rule')
   ids.add(r['id'])
  if set(views)-{r['view'] for r in rules}:raise PlanError('required view without geometry rules')
 return contract
def validate(plan,contract):
 validate_contract(contract)
 if not isinstance(plan,dict) or not isinstance(plan.get('drawings'),list):raise PlanError('drawings must be a list')
 def finite(x):
  if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or abs(x)>10000:raise PlanError('invalid finite coordinate')
 def point(p):
  if not isinstance(p,list) or not 2<=len(p)<=3:raise PlanError('invalid point')
  for x in p:finite(x)
 expected=set(contract['drawings']);seen=set();expanded=0
 for row in plan['drawings']:
  src=row.get('source')
  if src not in expected or src in seen:raise PlanError('unexpected/duplicate source')
  seen.add(src);views=set()
  for v in row.get('views',[]):
   name=v.get('id','')
   if not ID.fullmatch(name) or name in views:raise PlanError('invalid/duplicate view id')
   views.add(name);ids=set()
   if len(v.get('commands',[]))>500:raise PlanError('too many commands')
   for c in v['commands']:
    expanded+=1
    op=c.get('op');cid=c.get('id')
    if op not in OPS:raise PlanError('unsupported operation: '+str(op))
    if cid is not None:
     if not ID.fullmatch(cid) or cid in ids:raise PlanError(f'{src}/{name}: invalid or repeated feature id {cid!r}; use unique ASCII identifiers per view')
     ids.add(cid)
    if op=='profile_path':
     point(c['start'])
     if not 2<=len(c.get('steps',[]))<=200:raise PlanError('invalid profile path steps')
     for s in c['steps']:
      if sum(k in s for k in ['to','to_x','to_y'])!=1:raise PlanError('each profile step needs exactly one target')
      if 'to' in s:point(s['to'])
      for k in ['to_x','to_y','angle']:
       if k in s:finite(s[k])
    for f in c.get('fillets',[]):
     if type(f.get('vertex'))!=int or f['vertex']<0:raise PlanError('invalid fillet vertex')
     finite(f['radius'])
    if op in ['polyline','line']:
     ps=c.get('points')
     if not isinstance(ps,list) or not 2<=len(ps)<=5000:raise PlanError('invalid vertex count')
     for p in ps:point(p)
     expanded+=len(ps)
     if op=='line' and len(ps)!=2:raise PlanError(f'{src}/{name}/{cid}: line needs exactly two points; use polyline for multi-point path')
     for k,i in c.get('feature_segments',{}).items():
      if not ID.fullmatch(k) or type(i)!=int or not 0<=i<len(ps):raise PlanError('invalid feature segment')
    if op=='circle':
     point(c['center']);finite(c['radius'])
     if c['radius']<=0:raise PlanError('radius must be positive')
    if op=='dimension':
     if c.get('measure')=='outline_extent':
      if c.get('axis') not in ['x','y']:raise PlanError('outline extent dimension needs x/y axis')
     else:point(c['p1']);point(c['p2']);finite(c.get('angle',0))
    if op=='groove_array':
     if c.get('mode') not in ['plan','section']:raise PlanError('invalid array mode')
     for k in ['groups','channels']:
      if type(c.get(k))!=int or c[k]<1:raise PlanError('array counts must be positive integers')
     if c['groups']*c['channels']>2000:raise PlanError('array expansion limit')
     expanded+=c['groups']*c['channels']*8
     for k in ['pitch','group_step','first','depth','height','angle','run_start','run_end','lean_deg','width','root_radius']:
      if k in c:finite(c[k])
     depth=c.get('depth',.155884572681);angle=c.get('angle',60)
     if (depth<=0 and not (c['mode']=='plan' and c.get('width',0)>0)) or not 0<angle<180 or c['pitch']<=0:raise PlanError(f'{src}/{name}/{cid}: section needs depth>0; plan needs depth>0 or explicit width>0; 0<included angle<180, pitch>0 even for one channel. Got depth={depth}, angle={angle}, pitch={c["pitch"]}')
     radius=c.get('root_radius',0)
     if radius<0 or (c['mode']=='section' and radius*(1/math.sin(math.radians(angle/2))-math.sin(math.radians(angle/2)))>=depth):raise PlanError('root fillet exceeds groove facets')
     if c['mode']=='plan' and c['run_end']<=c['run_start']:raise PlanError('invalid groove run')
    if expanded>50000:raise PlanError('whole-plan geometry expansion limit exceeded')
  if not set(contract['drawings'][src]['required_views'])<=views:raise PlanError('missing required views for '+src+': '+str(sorted(set(contract['drawings'][src]['required_views'])-views))+'; provided: '+str(sorted(views)))
 if seen!=expected:raise PlanError('plan must include exactly the contracted drawings')
 return plan
