"""One HTTP attempt per frozen case. No retries, seed answers, or repair rounds."""
import contextlib,datetime,hashlib,json,math,os,subprocess,time,urllib.request,urllib.error
from pathlib import Path
import ezdxf
from ezdxf.path import make_path
from .storage import read,write,sha,contained
from .provider import SYSTEM,LANGUAGE,RELIABILITY,materials
from .runner import evaluate
from .comparison import sheets
from .engine import tags
from .audit import outline
from .graph_audit import audit_graph
from .synth20 import BATCH_ID

ENDPOINT='https://api.deepseek.com/chat/completions'
MODEL='deepseek-flash'
DEADLINE=datetime.datetime.fromisoformat('2026-11-05T14:00:00+08:00')
class BatchBlocked(RuntimeError):pass

class LocalControl:
 def __init__(self,node,script):self.node=str(node);self.script=Path(script).resolve()
 def check(self):
  r=subprocess.run([self.node,str(self.script),'check'],capture_output=True,encoding='utf-8',timeout=20,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
  if r.returncode:raise BatchBlocked('Local control rejected new work')
  c=json.loads(r.stdout)
  if c.get('mode')!='running' or c.get('paused') or c.get('expired'):raise BatchBlocked('Paused or expired')
  remaining=(DEADLINE-datetime.datetime.now(datetime.timezone.utc)).total_seconds()
  if remaining<=0:raise BatchBlocked('Authorized deadline reached')
  return min(remaining,(datetime.datetime.fromisoformat(c['deadline'])-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
 def authorization(self):
  p=Path(os.environ.get('BOARD_DATA',str(self.script.parent/'data')))/'budget-authorization.json'
  a=read(p).get('cad_batch_authorizations',[])
  hits=[x for x in a if x.get('id')==BATCH_ID and x.get('worker_id')=='worker-03' and x.get('additional_images')==20 and x.get('max_inference_requests')==20]
  if len(hits)!=1:raise BatchBlocked('Matching 20-case authorization missing')
  if datetime.datetime.fromisoformat(hits[0]['deadline'])>DEADLINE:raise BatchBlocked('Authorization unexpectedly extends deadline')

def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def exact_geometry(path,truth):
 """Symmetric boundary distance + exact real circles/lines, independent of labels."""
 d=ezdxf.readfile(path);checks=[]
 def add(cid,ok,actual):checks.append({'id':cid,'status':'PASS' if ok else 'FAIL','actual':actual})
 add('millimetre_units',d.units==4,d.units)
 def dist(p,a,b):
  v=(b[0]-a[0],b[1]-a[1]);n=v[0]**2+v[1]**2;t=max(0,min(1,((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/n)) if n else 0
  return math.hypot(p[0]-a[0]-t*v[0],p[1]-a[1]-t*v[1])
 def distance(points,other):return max(min(dist(p,a,b) for a,b in zip(other,other[1:]+other[:1])) for p in points)
 for view,expected in truth['outlines'].items():
  block=d.blocks.get('VIEW_'+view);e=outline(block) if block else None
  if e is None:add('exact_boundary_'+view,False,'missing');continue
  primitives=[x for x in block if x.dxf.layer not in ['NOTES','DIMENSIONS','REFERENCE','CHANNELS']]
  polygons=[x for x in primitives if x.dxftype()=='LWPOLYLINE']
  add('one_material_boundary_'+view,len(polygons)==1,len(polygons))
  expected_circles=sum(c['op']=='circle' for c in truth['commands'].get(view,[]));actual_circles=sum(x.dxftype()=='CIRCLE' for x in primitives)
  add('exact_circle_count_'+view,actual_circles==expected_circles,actual_circles)
  actual=[(q.x,q.y) for q in make_path(e).flattening(.0005)]
  delta=max(distance(actual,expected),distance(expected,actual))
  add('exact_boundary_'+view,delta<=.002,{'max_distance_mm':delta})
 for view,commands in truth['commands'].items():
  block=d.blocks.get('VIEW_'+view)
  if block is None:add('exact_features_'+view,False,'missing');continue
  expected=[c for c in commands if c['op']=='line'];actual=[e for e in block if e.dxftype()=='LINE' and e.dxf.layer not in ['NOTES','DIMENSIONS','REFERENCE','CHANNELS']]
  add('exact_line_count_'+view,len(actual)==len(expected),len(actual))
  for c in expected:
   es=[e for e in actual if tags(e)==['line',c['id']]]
   ok=len(es)==1 and min(max(math.dist(list(es[0].dxf.start)[:2],c['points'][0]),math.dist(list(es[0].dxf.end)[:2],c['points'][1])),max(math.dist(list(es[0].dxf.start)[:2],c['points'][1]),math.dist(list(es[0].dxf.end)[:2],c['points'][0])))<=.002
   add('exact_line_'+c['id'],ok,len(es))
 return {'checks':checks,'failures':[x for x in checks if x['status']=='FAIL']}

def verify_candidate(job,plan,output,render_images=True):
 job=Path(job);output=Path(output);contract=read(job/'contract.json');base=evaluate(plan,contract,output,render_images)
 source=next(iter(contract['drawings']));path=output/(Path(source).stem+'_deepseek_harness.dxf')
 exact=exact_geometry(path,read(job/'truth.json'));graph=audit_graph(path,read(job/'truth.json')['graph'])
 result={'status':'FAIL' if base['failures'] or exact['failures'] or graph['failures'] else 'PASS_SCOPE_LIMITED','json_schema':'PASS','dxf_parsed':True,'geometry':base,'source_truth':exact,'functional_graph':graph,'user_acceptance':'NOT_PERFORMED','manufacturing_acceptance':False}
 if render_images:sheets(job,read(job/'job.json'),output)
 write(output/'verification.json',result);return result

class Batch:
 def __init__(self,root,control):self.root=Path(root).resolve();self.control=control
 def manifest(self):
  p=self.root/'manifest.json'
  if sha(p)!=read(self.root/'manifest.sha256.json')['sha256']:raise BatchBlocked('Frozen manifest changed')
  m=read(p)
  if m.get('batch_id')!=BATCH_ID or m.get('endpoint')!=ENDPOINT or m.get('model')!=MODEL or m.get('max_inference_requests')!=20 or len(m.get('entries',[]))!=20:raise BatchBlocked('Batch identity/endpoint/model/count changed')
  return m
 def inputs(self,entry):
  job=(self.root/entry['path']).resolve()
  if not job.is_relative_to(self.root):raise BatchBlocked('Case escapes batch root')
  for p,digest in entry['files'].items():
   if sha(contained(job,p))!=digest:raise BatchBlocked('Frozen case file changed: '+p)
  return job
 @contextlib.contextmanager
 def locked(self):
  lock=self.root/'.batch-lock'
  try:lock.mkdir()
  except FileExistsError:raise BatchBlocked('Batch lock held or orphaned; no replay/lease stealing') from None
  try:yield
  finally:lock.rmdir()
 def state(self):
  path=self.root/'state.json'
  return read(path) if path.exists() else {'rows':{e['id']:{'status':'NOT_RUN','attempts':0} for e in self.manifest()['entries']},'stop_reason':None,'first_format_verified':False}
 def save(self,s):write(self.root/'state.json',s)
 def status(self):
  m=self.manifest();s=self.state();rows=s['rows'];attempts=sum(r['attempts'] for r in rows.values());returned=sum(bool(r.get('supplier_response_received')) for r in rows.values());passed=sum(r['status']=='PASS_SCOPE_LIMITED' for r in rows.values());failed=sum(r['status'] in ['FAIL','FORMAT_FAILED'] for r in rows.values());notrun=sum(r['attempts']==0 for r in rows.values())
  return {'batch_id':m['batch_id'],'prepared':20,'submitted_attempts':attempts,'returned':returned,'validation_passed':passed,'validation_failed':failed,'not_run':notrun,'blocked_or_indeterminate':20-notrun-passed-failed,'stop_reason':s['stop_reason'],'endpoint':ENDPOINT,'model':MODEL,'sf_slot':'NON_SF_EXEMPT','first_format_verified':s['first_format_verified'],'synthetic_not_blind':True,'rows':rows}
 def tool_verify(self,case_id,plan):
  self.control.check()
  with self.locked():
   entry=next((e for e in self.manifest()['entries'] if e['id']==case_id),None)
   if entry is None:raise ValueError('Unknown case id')
   job=self.inputs(entry);raw=json.dumps(plan,allow_nan=False).encode()
   out=self.root/'candidate_checks'/case_id/hashlib.sha256(raw).hexdigest()
   return verify_candidate(job,plan,out)
 def run_next(self):
  remaining=self.control.check();self.control.authorization()
  with self.locked():
   m=self.manifest();s=self.state()
   if s['stop_reason'] and s['stop_reason']!='AUTH_ENV_MISSING':raise BatchBlocked('Batch stopped: '+s['stop_reason'])
   if not os.environ.get('DEEPSEEK_API_KEY'):
    s['stop_reason']='AUTH_ENV_MISSING';self.save(s);return self.status()
   if any(r['status']=='IN_FLIGHT' for r in s['rows'].values()):raise BatchBlocked('Unknown in-flight request; do not replay')
   entry=next((e for e in m['entries'] if s['rows'][e['id']]['attempts']==0),None)
   if entry is None:return self.status()
   if sum(x['attempts'] for x in s['rows'].values())>=20:raise BatchBlocked('20-request ceiling reached')
   if any(x['attempts'] for x in s['rows'].values()) and not s['first_format_verified']:raise BatchBlocked('First-case end-to-end format not verified')
   job=self.inputs(entry);cfg=read(job/'job.json');source=entry['source']
   # No contract, truth file, seed plan, previous result or hidden numeric target in request.
   content=[{'type':'text','text':LANGUAGE+'\n'+RELIABILITY+'\nRead this PNG and its separate functional brief. Produce one complete JSON plan. Use the front/top local origin shown. Include real overall_x/overall_y dimensions in both physical views.'}]+materials(job,cfg)
   body={'model':MODEL,'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':content}],'thinking':{'type':'enabled'},'reasoning_effort':'medium','max_tokens':20000,'response_format':{'type':'json_object'},'stream':False}
   payload=json.dumps(body,ensure_ascii=False).encode();out=self.root/'results'/entry['id'];out.mkdir(parents=True,exist_ok=True)
   receipt={'endpoint':ENDPOINT,'configured_model':MODEL,'payload_sha256':hashlib.sha256(payload).hexdigest(),'payload_bytes':len(payload),'input_fingerprints':entry['files'],'implementation':{p.name:sha(p) for p in Path(__file__).parent.glob('*.py')},'contract_exposed':False,'previous_response':False,'numeric_feedback':False,'image_parts':sum(x['type']=='image_url' for x in content),'separate_module_input':True,'sf_slot':'NON_SF_EXEMPT','queue_wait_seconds':0,'automatic_retries':0,'source':source}
   write(out/'request_conditions.json',receipt)
   # Check again at actual dispatch; reserve durably before networking, including uncertain failures.
   remaining=min(remaining,self.control.check())
   if remaining<10:raise BatchBlocked('Insufficient remaining authorized time for a request')
   row=s['rows'][entry['id']];row.update(status='IN_FLIGHT',attempts=1,dispatch_at=utc(),result_path=str(out));s['stop_reason']=None;self.save(s)
   start=time.monotonic();key=os.environ['DEEPSEEK_API_KEY']
   try:
    req=urllib.request.Request(ENDPOINT,data=payload,headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
    with urllib.request.urlopen(req,timeout=min(220,remaining)) as response:
     row['http_status']=response.status
     row['supplier_request_id']=response.headers.get('x-request-id') or response.headers.get('request-id')
     row['supplier_headers_received']=True;chunks=[];size=0
     while True:
      if time.monotonic()-start>min(220,remaining):raise TimeoutError('Total response deadline exceeded')
      part=(response.read1 if hasattr(response,'read1') else response.read)(65536)
      if not part:break
      size+=len(part)
      if size>64*1024*1024:raise ValueError('Response too large')
      chunks.append(part)
     raw=b''.join(chunks);row['supplier_response_received']=True
    row['supplier_seconds']=time.monotonic()-start
    if len(raw)>64*1024*1024:raise ValueError('Response too large')
    raw=raw.decode('utf-8').replace(key,'[REDACTED]');(out/'response.json').write_text(raw,encoding='utf-8')
    j=json.loads(raw);row['supplier_response_id']=j.get('id');row['actual_model']=j.get('model');row['usage']=j.get('usage',{})
    if row['actual_model'] not in [MODEL,'DeepSeek-V4.1-Flash-1017']:
     row.update(status='SERVICE_BLOCKED',finished_at=utc());s['stop_reason']='UNVERIFIED_ACTUAL_MODEL';write(out/'receipt.json',row);self.save(s);return self.status()
    if j['choices'][0]['finish_reason']!='stop':raise ValueError('Incomplete JSON output: '+str(j['choices'][0]['finish_reason']))
    plan=json.loads(j['choices'][0]['message']['content']);write(out/'model_plan.json',plan)
    # Deadline/pause also blocks starting a new offline experiment. Preserve raw response first.
    self.control.check()
    result=verify_candidate(job,plan,out/'cad');row['status']=result['status'];row['json_schema']='PASS';row['dxf_parsed']=True
    if entry==m['entries'][0]:s['first_format_verified']=True
   except urllib.error.HTTPError as exc:
    row.update(status='RATE_LIMITED' if exc.code==429 else 'SERVICE_BLOCKED',http_status=exc.code,supplier_seconds=time.monotonic()-start,retry_after=exc.headers.get('Retry-After'))
    s['stop_reason']='HTTP_'+str(exc.code)
   except (TimeoutError,urllib.error.URLError,OSError) as exc:
    row.update(status='INDETERMINATE',error_type=type(exc).__name__,supplier_seconds=time.monotonic()-start);s['stop_reason']='TRANSPORT_UNCERTAIN_NO_RETRY'
   except BatchBlocked:
    row.update(status='RETURNED_NOT_VALIDATED');s['stop_reason']='CONTROL_PAUSE_OR_DEADLINE'
   except Exception as exc:
    row.update(status='FORMAT_FAILED',error_type=type(exc).__name__,error=str(exc).replace(key,'[REDACTED]')[:600],supplier_seconds=row.get('supplier_seconds',time.monotonic()-start))
    if entry==m['entries'][0]:s['stop_reason']='FIRST_CASE_FORMAT_FAILED'
   row['finished_at']=utc();write(out/'receipt.json',row);self.save(s);return self.status()
