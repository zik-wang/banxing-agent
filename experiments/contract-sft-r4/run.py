"""Three independently seeded, fixed-300-update local SFT arms, then one sealed test.
No production calls, cloud APIs, best-of-test selection, or historical regrading.
"""
import os
os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false',OMP_NUM_THREADS='1',MKL_NUM_THREADS='1',CUBLAS_WORKSPACE_CONFIG=':4096:8')
import argparse,collections,gc,hashlib,json,random,time,traceback
from datetime import datetime,timezone
from pathlib import Path
import torch
from transformers import AutoTokenizer,AutoConfig,AutoModelForCausalLM
from peft import LoraConfig,get_peft_model,get_peft_model_state_dict
from peft.utils.save_and_load import set_peft_model_state_dict
from safetensors import safe_open
from safetensors.torch import save_file,load_file
from evaluation import evaluate,paired_interval
from gate import require_preflight
from stream_weights import load_into
from causal import causal_mask
from resources import memory_status,require_capacity
torch.set_num_threads(1);torch.set_num_interop_threads(1)
def now():return datetime.now(timezone.utc).isoformat()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def save(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def append(p,x):
 with p.open('a',encoding='utf-8') as f:f.write(json.dumps(x,ensure_ascii=False)+'\n');f.flush()
class Study:
 def __init__(self,root,base):
  self.root=root;self.base=base;self.protocol=read(root/'protocol.json');self.started=time.monotonic();self.last_check=self.started;self.model_loads=0
  self.tokenizer=AutoTokenizer.from_pretrained(str(base),local_files_only=True,trust_remote_code=False);self.tokenizer.pad_token=self.tokenizer.eos_token
 def check(self):
  t=time.monotonic();gap=t-self.last_check;self.last_check=t
  if gap>180:raise RuntimeError('UNEXPLAINED_EXECUTION_GAP_SECONDS:'+str(gap))
  if t-self.started>14400:raise RuntimeError('TOTAL_4H_BUDGET')
  if (self.root/'STOP').exists():raise RuntimeError('USER_STOP_FILE')
  capacity=memory_status()
  if capacity.get('windows') and capacity['available_commit']<1024**3:raise RuntimeError('SYSTEM_COMMIT_MEMORY_PRESSURE:'+str(capacity))
  control=Path('D:/pro222/pccr-eye-gaze/local-progress/data/run-control.json')
  if control.exists():
   c=read(control)
   if c.get('mode')=='paused' or c.get('paused') or c.get('worker_pauses',{}).get('worker-02',{}).get('paused'):raise RuntimeError('USER_PAUSED')
   if c.get('deadline') and datetime.now(timezone.utc)>=datetime.fromisoformat(c['deadline']):raise RuntimeError('USER_DEADLINE')
 def status(self,phase,**v):
  item={'at':now(),'phase':phase,'elapsed_seconds':time.monotonic()-self.started,**v};save(self.root/'status.json',item);append(self.root/'events.jsonl',item);print(json.dumps(item,ensure_ascii=True),flush=True)
 def model(self,seed):
  self.check();torch.manual_seed(seed);torch.cuda.manual_seed_all(seed)
  config=AutoConfig.from_pretrained(str(self.base),local_files_only=True,trust_remote_code=False)
  if getattr(config,'use_sliding_window',False):raise RuntimeError('SLIDING_WINDOW_NOT_IN_THIS_PROTOCOL')
  with torch.device('meta'):m=AutoModelForCausalLM.from_config(config,torch_dtype=torch.bfloat16,attn_implementation='eager',trust_remote_code=False)
  m.to_empty(device='cuda');m.tie_weights();state=m.state_dict()
  loaded=load_into(self.base/'model.safetensors',state,{'lm_head.weight'} if config.tie_word_embeddings else set(),lambda done,total:self.status('streaming_weight_load',seed=seed,completed=done,total=total))
  m.model.rotary_emb=m.model.rotary_emb.__class__(config=config,device=torch.device('cuda'))
  for p in m.parameters():p.requires_grad_(False)
  m.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False});m.enable_input_require_grads()
  m=get_peft_model(m,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=['q_proj','v_proj'],task_type='CAUSAL_LM'));m.config.use_cache=False
  self.model_loads+=1;save(self.root/f'model-load-{self.model_loads}.json',{'at':now(),'seed':seed,'base_dtype':'BF16','adapter_dtypes':sorted({str(p.dtype) for p in m.parameters() if p.requires_grad}),'trainable_parameters':sum(p.numel() for p in m.parameters() if p.requires_grad),'total_parameters':sum(p.numel() for p in m.parameters()),**loaded})
  self.check();return m
 def encode(self,r,explicit=True):
  prompt=self.tokenizer.apply_chat_template(r['messages'][:-1],tokenize=True,add_generation_prompt=True);full=self.tokenizer.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False)
  if full[:len(prompt)]!=prompt or not len(prompt)<len(full)<=768:raise RuntimeError('TOKEN_ALIGNMENT')
  mask=causal_mask(len(full),'cuda') if explicit else torch.ones((1,len(full)),device='cuda',dtype=torch.long)
  return {'input_ids':torch.tensor([full],device='cuda'),'attention_mask':mask,'labels':torch.tensor([[-100]*len(prompt)+full[len(prompt):]],device='cuda')},len(prompt),len(full)-len(prompt)
 @torch.inference_mode()
 def probe(self,m,r,path):
  m.eval();values=[]
  for explicit in [False,True]:
   self.check();x,_,_=self.encode(r,explicit);out=m(**x,use_cache=False);values.append((float(out.loss),out.logits[0,-1].cpu().clone()));del x,out;torch.cuda.empty_cache()
  matched=values[0][0]==values[1][0] and torch.equal(values[0][1],values[1][1])
  save(path,{'at':now(),'training_row_id':r['id'],'reference_loss':values[0][0],'explicit_mask_loss':values[1][0],'last_token_logits_identical':torch.equal(values[0][1],values[1][1]),'passed':matched,'scope':'One actual base-model training-row forward probe; tiny-config unit tests compare full logits and gradients. Not a semantic task evaluation.'})
  if not matched:raise RuntimeError('FULL_MODEL_MASK_PROBE_MISMATCH')
 @torch.inference_mode()
 def loss(self,m,data):
  m.eval();values=[]
  for r in data:self.check();x,_,_=self.encode(r);values.append(float(m(**x,use_cache=False).loss));del x
  return sum(values)/len(values)
 @torch.inference_mode()
 def generate(self,m,data,path,label):
  if path.exists():raise RuntimeError('OUTPUT_ALREADY_EXISTS')
  m.eval();out=[]
  for i,r in enumerate(data):
   self.check();started=time.monotonic();ids=self.tokenizer.apply_chat_template(r['messages'][:-1],tokenize=True,add_generation_prompt=True,return_tensors='pt').to('cuda')
   generated=m.generate(ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=160,use_cache=True,pad_token_id=self.tokenizer.eos_token_id);tokens=generated[0,ids.shape[1]:]
   input_hash=hashlib.sha256(json.dumps(r['messages'][:-1],ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()
   if input_hash!=r['input_sha256']:raise RuntimeError('INPUT_BINDING')
   eos=m.generation_config.eos_token_id;eos_ids=set(eos if isinstance(eos,list) else [eos]);eos_ids.add(self.tokenizer.eos_token_id)
   finish='eos' if len(tokens) and int(tokens[-1]) in eos_ids else 'length' if len(tokens)>=160 else 'stopped_other'
   p={'id':r['id'],'raw':self.tokenizer.decode(tokens,skip_special_tokens=True),'input_sha256':input_hash,'input_token_ids_sha256':hashlib.sha256(json.dumps(ids[0].tolist(),separators=(',',':')).encode()).hexdigest(),'seconds':time.monotonic()-started,'input_tokens':ids.shape[1],'output_tokens':len(tokens),'finish':finish};out.append(p);append(path,p);del ids,generated,tokens
   torch.cuda.empty_cache()
   if i%16==0 or i+1==len(data):self.status(label,completed=i+1,total=len(data))
  return out
 def adapter(self,m,directory):
  directory.mkdir(exist_ok=False);weights={k:v.detach().cpu().contiguous() for k,v in get_peft_model_state_dict(m).items()};save_file(weights,str(directory/'adapter_model.safetensors'),metadata={'format':'pt'});m.peft_config['default'].save_pretrained(directory);return sha(directory/'adapter_model.safetensors')
 def arm(self,seed,train,dev):
  start=time.monotonic();target=self.root/('seed-'+str(seed));target.mkdir();self.status('training_arm_start',seed=seed);m=self.model(seed);initial=self.adapter(m,target/'initial');self.probe(m,train[0],target/'mask-equivalence-probe.json')
  opt=torch.optim.AdamW([p for p in m.parameters() if p.requires_grad],lr=1e-4,betas=(.9,.999),eps=1e-8,weight_decay=.01);rng=random.Random(seed);queue=list(range(len(train)));rng.shuffle(queue);seen=collections.Counter();history=[]
  for step in range(1,301):
   self.check()
   if time.monotonic()-start>3600:raise RuntimeError('ARM_BUDGET_INCOMPLETE:'+str(seed))
   m.train();m.config.use_cache=False;opt.zero_grad(set_to_none=True);trace=[]
   for _ in range(4):
    self.check();r=train[queue.pop()];x,pt,tt=self.encode(r);loss=m(**x,use_cache=False).loss
    if not torch.isfinite(loss):raise RuntimeError('NONFINITE_LOSS')
    (loss/4).backward();trace.append({'id':r['id'],'loss':float(loss.detach()),'prompt_tokens':pt,'target_tokens':tt});seen[r['id']]+=1;del x,loss
   norm=float(torch.nn.utils.clip_grad_norm_(m.parameters(),1));opt.step();opt.zero_grad(set_to_none=True);torch.cuda.empty_cache();item={'at':now(),'seed':seed,'step':step,'loss':sum(x['loss'] for x in trace)/4,'gradient_norm':norm,'lr':1e-4,'trace':trace,'unique_seen':len(seen),'elapsed_seconds':time.monotonic()-start,'memory':memory_status(),'cuda_allocated':torch.cuda.memory_allocated(),'cuda_reserved':torch.cuda.memory_reserved()};append(target/'training-log.jsonl',item)
   if step==1 or step%25==0:self.status('training',seed=seed,step=step,steps=300,loss=item['loss'],unique_seen=len(seen))
   if step%100==0:
    val=self.loss(m,dev);p=self.generate(m,dev,target/f'dev-step{step}.jsonl','dev_'+str(seed));metrics=evaluate(dev,p);weight_sha=self.adapter(m,target/f'checkpoint-{step}')
    history.append({'step':step,'loss':val,'metrics':metrics,'adapter_sha256':weight_sha});save(target/'validation.json',history);self.status('validation',seed=seed,step=step,loss=val,exact_match=metrics['exact_match'])
  if queue or len(seen)!=len(train) or any(n!=1 for n in seen.values()):raise RuntimeError('TRAINING_COVERAGE_ERROR')
  selected={'seed':seed,'step':300,'path':str(target/'checkpoint-300'),'sha256':weight_sha,'initial_sha256':initial,'rule':'Fixed300, not best dev/test','coverage':dict(seen),'elapsed_seconds':time.monotonic()-start};save(target/'selected.json',selected);del m,opt;gc.collect();torch.cuda.empty_cache();return selected
 def run(self):
  self.check();require_preflight(self.root);f=read(self.root/'freeze.json')
  for name,h in f['files'].items():
   if sha(self.root/name)!=h:raise RuntimeError('FROZEN_FILE_CHANGED:'+name)
  for name,h in f['code'].items():
   if sha(self.root/'executed-code'/name)!=h:raise RuntimeError('FROZEN_CODE_CHANGED:'+name)
  capacity=memory_status();save(self.root/'resource-preflight.json',capacity);require_capacity(capacity)
  if not torch.cuda.is_available() or torch.cuda.mem_get_info()[0]<4500*1024**2:raise RuntimeError('LOCAL_GPU_UNAVAILABLE_OR_OCCUPIED')
  expected=read(self.root/'base-manifest.json');actual={name:sha(self.base/name) for name in expected}
  if actual!=expected:raise RuntimeError('BASE_MODEL_HASH_MISMATCH')
  save(self.root/'environment.json',{'at':now(),'torch':torch.__version__,'gpu':torch.cuda.get_device_name(),'base_hashes':actual,'cloud_requests':0})
  train=rows(self.root/'train.jsonl');dev=rows(self.root/'dev.jsonl');selected=[self.arm(seed,train,dev) for seed in self.protocol['seeds']]
  save(self.root/'selection-seal.json',{'at':now(),'selected':selected,'test_sha256':sha(self.root/'test.jsonl'),'test_used_for_selection':False})
  test=rows(self.root/'test.jsonl');m=self.model(61106);results={}
  with m.disable_adapter():
   save(self.root/'baseline-dev-loss.json',{'teacher_forced_loss':self.loss(m,dev)});p=self.generate(m,test,self.root/'test-baseline.jsonl','test_baseline');results['baseline']=evaluate(test,p)
  for s in selected:
   file=Path(s['path'])/'adapter_model.safetensors'
   if sha(file)!=s['sha256']:raise RuntimeError('ADAPTER_HASH')
   weights=load_file(str(file));applied=set_peft_model_state_dict(m,weights);actual=get_peft_model_state_dict(m)
   if applied.unexpected_keys or set(actual)!=set(weights) or any(not torch.equal(actual[k].detach().cpu(),v) for k,v in weights.items()):raise RuntimeError('ADAPTER_CONTENT')
   del weights,actual;name='seed-'+str(s['seed']);p=self.generate(m,test,self.root/f'test-{name}.jsonl','test_'+name);results[name]=evaluate(test,p);results[name]['paired_interval']=paired_interval(results['baseline'],results[name]);save(self.root/'partial-results.json',results)
  qualified={}
  for name,r in results.items():
   if name=='baseline':continue
   checks={'gain_lower95_positive':r['paired_interval']['lower95']>0,'precision_at_least90':r['micro_span_precision'] is not None and r['micro_span_precision']>=.9,'recall_at_least80':r['micro_span_recall'] is not None and r['micro_span_recall']>=.8,'exact_match_at_least85':r['exact_match']>=.85,'unsupported_at_most2':r['unsupported_rate'] is not None and r['unsupported_rate']<=.02,'empty_failure_at_most5':r['empty_false_fill_rate']+r['empty_invalid_rate']<=.05};qualified[name]={'checks':checks,'passed':all(checks.values())}
  save(self.root/'final-results.json',{'at':now(),'status':'THREE_SEED_EXPERIMENT_COMPLETED','results':results,'gates':qualified,'all_seeds_passed':all(x['passed'] for x in qualified.values()),'selected':selected,'elapsed_seconds':time.monotonic()-self.started,'no_test_tuning':True,'independent_blind_qa':False,'Chinese_legal_reliability_tested':False,'production_changed':False});self.status('completed',gates=qualified)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True);a=p.parse_args()
 try:Study(a.root,a.base).run()
 except Exception as e:
  failure={'at':now(),'error_type':type(e).__name__,'error':str(e),'traceback':traceback.format_exc(),'status':'INCOMPLETE_NOT_PASSED','memory':memory_status()};save(a.root/'failure.json',failure);save(a.root/'status.json',{'at':failure['at'],'phase':'failed','error_type':failure['error_type'],'error':failure['error']});raise
