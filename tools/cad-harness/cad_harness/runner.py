import json,time,shutil,zipfile,datetime,threading
from pathlib import Path
from .storage import read,write,freeze,contained,sha
from .schema import validate
from .engine import compile_one,render
from .audit import audit_file
from .provider import invoke,ProviderBlocked
from .comparison import sheets
from .diagnostics import signature
_CAD_LOCK=threading.RLock()
def evaluate(plan,contract,out,render_images=True):
 # ezdxf's font/glyph caches and drawing backends are process-global.
 # Model HTTP calls may overlap; compilation, audit and rendering must not.
 with _CAD_LOCK:return _evaluate(plan,contract,out,render_images)

def _evaluate(plan,contract,out,render_images=True):
 validate(plan,contract);out.mkdir(parents=True,exist_ok=True);reports=[]
 for row in plan['drawings']:
  path,_=compile_one(row,out,contract['drawings'][row['source']]);report=audit_file(path,contract['drawings'][row['source']]);report['source']=row['source'];reports.append(report)
  if render_images:render(path)
 status='GEOMETRY_FAILED' if any(r['failures'] for r in reports) else ('ACCEPTED' if all(r['coverage_complete'] for r in reports) else 'CHECKS_PASS_SCOPE_LIMITED')
 result={'status':status,'drawings':reports,'failures':[{'source':r['source'],'failures':r['failures']} for r in reports if r['failures']]};write(out/'acceptance.json',result);return result
def run(job,run_id='current',resume=False,render_images=True,seed_from_run=None):
 job=Path(job).resolve();cfg=read(job/'job.json');contract=read(job/'contract.json');root=job/'runs'/run_id
 if not run_id.replace('-','').replace('_','').isalnum():raise ValueError('Invalid run id')
 fingerprint=freeze(job)
 options_path=root/'run_options.json'
 if resume and options_path.exists() and seed_from_run is None:seed_from_run=read(options_path).get('seed_from_run')
 seed_override=None
 if seed_from_run:
  if not seed_from_run.replace('-','').replace('_','').isalnum() or seed_from_run==run_id:raise ValueError('Invalid seed run id')
  seed_override=contained(job,'runs/'+seed_from_run+'/latest_plan.json');fingerprint['seed_run/'+seed_from_run]=sha(seed_override)
 if root.exists() and not resume:raise RuntimeError('Run already exists; use --resume or another --run-id')
 root.mkdir(parents=True,exist_ok=True)
 if (root/'frozen_sources.json').exists() and read(root/'frozen_sources.json')!=fingerprint:raise RuntimeError('Source/contract changed; start a new run')
 write(options_path,{'seed_from_run':seed_from_run})
 write(root/'frozen_sources.json',fingerprint)
 state=read(root/'state.json') if (root/'state.json').exists() else {'round':0,'used_tokens':0,'status':'RUNNING','active_seconds':0}
 if state['status'] in ['ACCEPTED','CHECKS_PASS_SCOPE_LIMITED']:return state
 rounds=int(cfg.get('max_rounds',4));budget=int(cfg.get('token_budget',150000));seconds=int(cfg.get('wall_clock_budget_seconds',1800))
 if not 1<=rounds<=12 or not 1000<=budget<=1000000 or not 10<=seconds<=14400:raise ValueError('Invalid bounded run configuration')
 # Recover usage that was recorded just before a process interruption.
 known=sum(read(f).get('total_tokens',0) for f in root.glob('round-*/usage.json'))
 state['used_tokens']=max(state['used_tokens'],known)
 interrupted=[f.parent.name for f in root.glob('round-*/request.json') if not (f.parent/'usage.json').exists() and not (f.parent/'error.json').exists()]
 if interrupted:
  state['unaccounted_request_rounds']=interrupted
  state['used_tokens']=max(state['used_tokens'],known+len(interrupted)*cfg.get('max_output_tokens',24000))
  # An interrupted call is consumed as an attempt, never silently replayed.
  state['round']=max(state['round'],max(int(x.split('-')[-1]) for x in interrupted))
 previous=read(root/'latest_plan.json') if (root/'latest_plan.json').exists() else None
 feedback=read(root/'latest_feedback.json') if (root/'latest_feedback.json').exists() else {'instruction':'Initial generation. Complete all contracted features.'}
 if previous is None and (seed_override or cfg.get('seed_plan')):
  previous=read(seed_override or contained(job,cfg['seed_plan']));write(root/'latest_plan.json',previous)
  try:
   baseline=evaluate(previous,contract,root/'baseline',render_images);feedback=baseline['failures']
   if not feedback:
    state['status']=baseline['status'];write(root/'latest_feedback.json',feedback);write(root/'state.json',state);return state
  except Exception as exc:feedback=[{'stage':'seed_plan','error':type(exc).__name__,'message':str(exc)[:1500]}]
  write(root/'latest_feedback.json',feedback)
 start=time.monotonic();before=state['active_seconds']
 for round_index in range(state['round'],rounds):
  if state['used_tokens']>=budget or before+time.monotonic()-start>=seconds:break
  current=freeze(job)
  if seed_override:current['seed_run/'+seed_from_run]=sha(seed_override)
  if current!=fingerprint:raise RuntimeError('Frozen input changed during execution')
  stage=root/f'round-{round_index+1:02d}';stage.mkdir(exist_ok=True);state['round']=round_index+1;write(root/'state.json',state)
  write(stage/'implementation.json',{p.name:sha(p) for p in Path(__file__).parent.glob('*.py')})
  print(f'Round {round_index+1}/{rounds}: DeepSeek generation',flush=True)
  usage=0
  try:
   call_cfg={**cfg,'remaining_wall_seconds':max(1,seconds-before-(time.monotonic()-start))}
   history=state.get('failure_signatures',[])
   if cfg.get('reasoning_on_stagnation',True) and len(history)>=2 and history[-1]==history[-2]:call_cfg['repair_reasoning']=True
   plan,usage=invoke(job,call_cfg,contract,previous,feedback,stage,budget-state['used_tokens'])
   write(stage/'plan.json',plan);previous=plan;write(root/'latest_plan.json',plan)
   result=evaluate(plan,contract,stage/'artifacts',render_images);feedback=result['failures'];state['status']=result['status']
  except ProviderBlocked as exc:
   feedback=[{'stage':'provider','error':'ProviderBlocked','message':str(exc)}];write(stage/'error.json',feedback);state['status']='SERVICE_BLOCKED'
  except Exception as exc:
   # Keep failure machine-readable; schema/compiler failures are fed back too.
   feedback=[{'stage':'provider_or_compile','error':type(exc).__name__,'message':str(exc)[:1500]}];write(stage/'error.json',feedback);state['status']='ROUND_FAILED'
   if (stage/'usage.json').exists():usage=read(stage/'usage.json')['total_tokens']
  state['used_tokens']+=usage;state['active_seconds']=before+time.monotonic()-start;write(root/'latest_feedback.json',feedback);write(root/'state.json',state)
  state.setdefault('failure_signatures',[]).append(signature(feedback));write(root/'state.json',state)
  print('  '+state['status']+'; feedback entries='+str(len(feedback)),flush=True)
  if state['status'] in ['ACCEPTED','CHECKS_PASS_SCOPE_LIMITED','SERVICE_BLOCKED']:break
 if state['status'] not in ['ACCEPTED','CHECKS_PASS_SCOPE_LIMITED','SERVICE_BLOCKED']:state['status']='REPAIR_BUDGET_EXHAUSTED';write(root/'state.json',state)
 return state
def package(job,run_id):
 job=Path(job).resolve();root=job/'runs'/run_id;state=read(root/'state.json');cfg=read(job/'job.json')
 current=freeze(job);options=read(root/'run_options.json') if (root/'run_options.json').exists() else {}
 if options.get('seed_from_run'):current['seed_run/'+options['seed_from_run']]=sha(contained(job,'runs/'+options['seed_from_run']+'/latest_plan.json'))
 if current!=read(root/'frozen_sources.json'):raise RuntimeError('Sources changed since run')
 verify=root/('verification-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'));verify.mkdir()
 try:current_report=evaluate(read(root/'latest_plan.json'),read(job/'contract.json'),verify,True);package_state=current_report['status']
 except Exception as exc:package_state='GEOMETRY_FAILED';write(verify/'error.json',{'error':type(exc).__name__,'message':str(exc)})
 write(root/'package_status.json',{'status':package_state,'historical_run_status':state['status'],'verification':verify.name,'implementation':{p.name:sha(p) for p in Path(__file__).parent.glob('*.py')}})
 if (verify/'acceptance.json').exists():sheets(job,cfg,verify)
 path=root/'delivery.zip'
 with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for f in root.rglob('*'):
   if f.is_file() and f.name!='delivery.zip':z.write(f,f.relative_to(root).as_posix())
  for name in cfg['sources']:z.write(contained(job,name),'originals/'+Path(name).name)
  latest=verify
  if latest.is_dir():
   for f in latest.iterdir():
    if f.is_file():z.write(f,'latest/'+f.name)
  z.write(job/'contract.json','contract.json');z.write(job/'job.json','job.json')
  z.writestr('READ_ME.txt','Package status (rechecked with current code): '+package_state+'\nHistorical run status: '+state['status']+'\nlatest/ contains current-code compiled CAD and independent acceptance.\nCHECKS_PASS_SCOPE_LIMITED is NOT full drawing acceptance.\nFailed or absent features cannot be waived by model notes.\n')
 return path
