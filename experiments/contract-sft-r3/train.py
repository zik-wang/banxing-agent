"""Bounded local BF16 LoRA experiment. No cloud API; no production deployment.
The test generator is opened only after both dev-selected adapters are sealed.
"""
import os
os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false',OMP_NUM_THREADS='1',MKL_NUM_THREADS='1',CUBLAS_WORKSPACE_CONFIG=':4096:8')
import argparse,collections,gc,hashlib,json,math,random,time,traceback
from datetime import datetime,timezone
from pathlib import Path
import torch
from transformers import AutoTokenizer,AutoConfig,AutoModelForCausalLM
from peft import LoraConfig,get_peft_model,get_peft_model_state_dict
from peft.utils.save_and_load import set_peft_model_state_dict
from safetensors import safe_open
from safetensors.torch import save_file,load_file
from metrics import score,cluster_interval
torch.set_num_threads(1);torch.set_num_interop_threads(1)
def now():return datetime.now(timezone.utc).isoformat()
def digest(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in Path(p).read_text(encoding='utf-8').splitlines() if s.strip()]
def save(p,x):Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def append(p,x):
 with Path(p).open('a',encoding='utf-8') as f:f.write(json.dumps(x,ensure_ascii=False)+'\n');f.flush()
class Experiment:
 def __init__(self,root,base):
  self.root=Path(root);self.base=Path(base);self.start=time.monotonic();self.loads=0;self.protocol=read(self.root/'experiment-protocol.json')
  self.tokenizer=AutoTokenizer.from_pretrained(str(self.base),local_files_only=True,trust_remote_code=False);self.tokenizer.pad_token=self.tokenizer.eos_token
  self.control=Path('D:/pro222/pccr-eye-gaze/local-progress/data/run-control.json')
 def check(self):
  if (self.root/'STOP').exists():raise RuntimeError('USER_STOP_FILE')
  if self.control.exists():
   c=read(self.control)
   if c.get('mode')=='paused' or c.get('worker_pauses',{}).get('worker-02',{}).get('paused'):raise RuntimeError('USER_CONTROL_PAUSED')
   if c.get('deadline') and datetime.now(timezone.utc)>=datetime.fromisoformat(c['deadline']):raise RuntimeError('USER_DEADLINE')
  if time.monotonic()-self.start>10800:raise RuntimeError('LOCAL_EXPERIMENT_3H_BUDGET')
 def status(self,phase,**data):
  save(self.root/'status.json',{'at':now(),'phase':phase,'elapsed_seconds':time.monotonic()-self.start,**data})
  print(json.dumps({'at':now(),'phase':phase,**data},ensure_ascii=True),flush=True)
 def load_model(self):
  self.check();torch.manual_seed(61105);torch.cuda.manual_seed_all(61105)
  config=AutoConfig.from_pretrained(str(self.base),local_files_only=True,trust_remote_code=False)
  with torch.device('meta'):base=AutoModelForCausalLM.from_config(config,torch_dtype=torch.bfloat16,attn_implementation='eager',trust_remote_code=False)
  base.to_empty(device='cuda');base.tie_weights();state=base.state_dict()
  with safe_open(str(self.base/'model.safetensors'),framework='pt',device='cpu',backend='pread') as f:
   keys=set(f.keys());missing=set(state)-keys
   if missing-({'lm_head.weight'} if config.tie_word_embeddings else set()) or keys-set(state):raise RuntimeError('BASE_KEY_MISMATCH')
   with torch.no_grad():
    for i,key in enumerate(sorted(keys)):
     x=f.get_tensor(key)
     if state[key].shape!=x.shape:raise RuntimeError('BASE_SHAPE_MISMATCH')
     state[key].copy_(x);del x
     if i%100==0:self.status('loading_base_tensor',completed=i+1,total=len(keys))
  base.model.rotary_emb=base.model.rotary_emb.__class__(config=config,device=torch.device('cuda'))
  for p in base.parameters():p.requires_grad_(False)
  base.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False});base.enable_input_require_grads()
  model=get_peft_model(base,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=['q_proj','v_proj'],task_type='CAUSAL_LM'))
  model.config.use_cache=False
  self.loads+=1
  save(self.root/f'loaded-model-{self.loads}.json',{'at':now(),'base':str(self.base),'base_dtype':'BF16','adapter_dtypes':sorted({str(p.dtype) for p in model.parameters() if p.requires_grad}),'trainable':sum(p.numel() for p in model.parameters() if p.requires_grad),'total':sum(p.numel() for p in model.parameters()),'layers':config.num_hidden_layers,'gpu':torch.cuda.get_device_name(),'torch':torch.__version__,'weights_loaded':len(keys)})
  return model
 def encode(self,r):
  prompt=self.tokenizer.apply_chat_template(r['messages'][:-1],tokenize=True,add_generation_prompt=True)
  full=self.tokenizer.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False)
  if full[:len(prompt)]!=prompt or len(full)>768 or len(full)<=len(prompt):raise RuntimeError('TOKEN_ALIGNMENT_OR_LENGTH')
  return {'input_ids':torch.tensor([full],device='cuda'),'attention_mask':torch.ones((1,len(full)),device='cuda',dtype=torch.long),'labels':torch.tensor([[-100]*len(prompt)+full[len(prompt):]],device='cuda')},len(prompt),len(full)-len(prompt)
 @torch.inference_mode()
 def validation_loss(self,model,dev):
  model.eval();values=[]
  for r in dev:
   self.check();encoded,_,_=self.encode(r);values.append(float(model(**encoded,use_cache=False).loss));del encoded
  return sum(values)/len(values)
 @torch.inference_mode()
 def generate(self,model,data,file,label):
  model.eval();output=[]
  if file.exists():raise RuntimeError('PREDICTION_FILE_ALREADY_EXISTS')
  for i,r in enumerate(data):
   self.check();start=time.monotonic()
   ids=self.tokenizer.apply_chat_template(r['messages'][:-1],tokenize=True,add_generation_prompt=True,return_tensors='pt').to('cuda')
   result=model.generate(ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=160,pad_token_id=self.tokenizer.eos_token_id,use_cache=True)
   tokens=result[0,ids.shape[1]:];raw=self.tokenizer.decode(tokens,skip_special_tokens=True)
   item={'id':r['id'],'raw':raw,'seconds':time.monotonic()-start,'input_tokens':ids.shape[1],'output_tokens':len(tokens),'finish':'eos' if len(tokens) and int(tokens[-1])==self.tokenizer.eos_token_id else 'length','input_sha256':hashlib.sha256(json.dumps(r['messages'][:-1],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'context_sha256':r['context_sha256']}
   append(file,item);output.append(item);del ids,result,tokens
   if i%16==0 or i+1==len(data):self.status(label,completed=i+1,total=len(data))
  return output
 def save_adapter(self,model,directory):
  directory.mkdir(parents=True,exist_ok=True)
  tensors={k:v.detach().cpu().contiguous() for k,v in get_peft_model_state_dict(model).items()}
  save_file(tensors,str(directory/'adapter_model.safetensors'),metadata={'format':'pt'});model.peft_config['default'].save_pretrained(directory)
  return digest(directory/'adapter_model.safetensors')
 def train_arm(self,arm,train,dev):
  target=self.root/arm;target.mkdir(exist_ok=False);model=self.load_model()
  optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=.0001,betas=(.9,.999),eps=1e-8,weight_decay=.01)
  rng=random.Random(61105);queue=[];epoch=-1;seen=collections.Counter();best=-1.;best_loss=float('inf');stale=0;history=[];completed_steps=0;arm_start=time.monotonic();optimizer.zero_grad(set_to_none=True)
  for step in range(1,601):
   self.check()
   if time.monotonic()-arm_start>3600:
    self.status('arm_budget_reached',arm=arm,step=step-1);break
   model.train();model.config.use_cache=False;micro=[]
   for _ in range(4):
    self.check()
    if not queue:
     epoch+=1;queue=list(range(len(train)));rng.shuffle(queue)
    r=train[queue.pop()];encoded,prompt_tokens,target_tokens=self.encode(r)
    loss=model(**encoded,use_cache=False).loss
    if not torch.isfinite(loss):raise RuntimeError('NONFINITE_LOSS')
    (loss/4).backward();micro.append({'id':r['id'],'corpus':r['corpus'],'loss':float(loss.detach()),'prompt_tokens':prompt_tokens,'target_tokens':target_tokens});seen[r['id']]+=1;del encoded,loss
   grad_norm=float(torch.nn.utils.clip_grad_norm_(model.parameters(),1.))
   optimizer.step();optimizer.zero_grad(set_to_none=True)
   log={'step':step,'loss':sum(x['loss'] for x in micro)/4,'grad_norm_before_clip':grad_norm,'lr':optimizer.param_groups[0]['lr'],'elapsed_seconds':time.monotonic()-arm_start,'sample_trace':micro,'distinct_rows_seen':len(seen),'total_presentations':sum(seen.values()),'epoch_index':epoch,'peak_cuda_allocated':torch.cuda.max_memory_allocated()}
   completed_steps=step
   append(target/'training-log.jsonl',log)
   if step==1 or step%10==0:self.status('training',arm=arm,step=step,max_steps=600,loss=log['loss'],distinct_seen=len(seen),dataset_rows=len(train),seconds=log['elapsed_seconds'])
   if step%100==0:
    val_loss=self.validation_loss(model,dev);pred=self.generate(model,dev,target/f'dev-predictions-step{step}.jsonl','development_generation_'+arm)
    metrics=score(dev,pred);key=sum(c['mean_answer_set_f1'] for c in metrics['by_corpus'].values())/len(metrics['by_corpus'])
    minimum=300 if arm=='full1200' else 100
    eligible=step>=minimum and len(seen)>=len(train)
    improved=eligible and (key>best+.000001 or abs(key-best)<=.000001 and val_loss<best_loss)
    checkpoint=target/f'checkpoint-{step}';weight_hash=self.save_adapter(model,checkpoint)
    entry={'step':step,'dev_mean_corpus_f1':key,'teacher_forced_loss':val_loss,'metrics':metrics,'adapter_sha256':weight_hash,'elapsed_seconds':time.monotonic()-arm_start,'distinct_rows_seen':len(seen),'eligible_for_selection':eligible};history.append(entry);save(target/'validation-history.json',history)
    if improved:
     best=key;best_loss=val_loss;stale=0
     save(target/'selected-checkpoint.json',{'arm':arm,'step':step,'path':str(checkpoint),'sha256':weight_hash,'dev_mean_corpus_f1':key,'validation_loss':val_loss,'selection_rule':'dev corpus-macro exact answer-set F1; tie lower dev loss; never test'})
    elif eligible:stale+=1
    self.status('validation_complete',arm=arm,step=step,dev_f1=key,val_loss=val_loss,improved=improved,stale=stale)
    minimum=300 if arm=='full1200' else 100
    if step>=minimum and stale>=3:
     self.status('early_stop',arm=arm,step=step,reason='three unchanged/worse dev checkpoints');break
  if not (target/'selected-checkpoint.json').exists():raise RuntimeError('NO_VALIDATED_CHECKPOINT')
  selected=read(target/'selected-checkpoint.json')
  save(target/'coverage.json',{'optimizer_steps':completed_steps,'train_rows':len(train),'distinct_rows_seen':len(seen),'total_presentations':sum(seen.values()),'sample_counts':seen,'selection':selected,'note':'Coverage counted through completed training, not necessarily selected checkpoint; per-step trace provides selected-step coverage.'})
  del optimizer,model;gc.collect();torch.cuda.empty_cache();return selected
 def run(self):
  self.check();freeze=read(self.root/'freeze.json')
  for name,expected in freeze['files'].items():
   if digest(self.root/name)!=expected:raise RuntimeError('FROZEN_DATA_CHANGED:'+name)
  if not torch.cuda.is_available():raise RuntimeError('CUDA_UNAVAILABLE')
  free,total=torch.cuda.mem_get_info()
  if free<4500*1024**2:raise RuntimeError('INSUFFICIENT_FREE_GPU_MEMORY')
  save(self.root/'environment.json',{'at':now(),'torch':torch.__version__,'gpu':torch.cuda.get_device_name(),'free_bytes':free,'total_bytes':total,'base_config_sha256':digest(self.base/'config.json'),'base_weight_sha256':digest(self.base/'model.safetensors'),'tokenizer_sha256':digest(self.base/'tokenizer.json'),'no_cloud_api':True,'max_wall_seconds':10800})
  dev=rows(self.root/'dev.jsonl');selected={}
  for arm,file in [('small300','train_small.jsonl'),('full1200','train.jsonl')]:
   self.status('arm_start',arm=arm);selected[arm]=self.train_arm(arm,rows(self.root/file),dev)
  save(self.root/'selection-seal.json',{'at':now(),'selected':selected,'test_sha256':digest(self.root/'test.jsonl'),'test_model_generation_started':False,'test_used_for_selection':False})
  test=rows(self.root/'test.jsonl');model=self.load_model();all_scores={}
  with model.disable_adapter():
   pred=self.generate(model,test,self.root/'test-baseline.jsonl','test_baseline');all_scores['baseline']=score(test,pred)
  for arm in ['small300','full1200']:
   state=selected[arm]
   if digest(Path(state['path'])/'adapter_model.safetensors')!=state['sha256']:raise RuntimeError('ADAPTER_HASH_CHANGED')
   weights=load_file(str(Path(state['path'])/'adapter_model.safetensors'))
   applied=set_peft_model_state_dict(model,weights);actual=get_peft_model_state_dict(model)
   if applied.unexpected_keys or set(weights)!=set(actual) or any(not torch.equal(actual[k].detach().cpu(),v) for k,v in weights.items()):raise RuntimeError('ADAPTER_LOAD_CONTENT_MISMATCH')
   save(self.root/f'adapter-load-{arm}.json',{'at':now(),'adapter_sha256':state['sha256'],'all_tensor_values_equal':True,'tensor_count':len(weights)})
   del weights,actual
   pred=self.generate(model,test,self.root/f'test-{arm}.jsonl','test_'+arm);all_scores[arm]=score(test,pred)
   all_scores[arm]['cluster_intervals']={corpus:cluster_interval(test,pred,corpus) for corpus in all_scores[arm]['by_corpus']}
   save(self.root/'test-results.partial.json',all_scores)
  gates={};base_english=all_scores['baseline']['by_corpus']['cuad_human_reference']['exact_match']
  for arm in ['small300','full1200']:
   s=all_scores[arm];overall=s['overall'];zh=s['by_corpus']['zh_synthetic'];en=s['by_corpus']['cuad_human_reference']
   gate={'format':overall['schema_rate']>=.98,'source_quote':overall['raw_quote_valid_rate'] is not None and overall['raw_quote_valid_rate']>=.98,'chinese_exact':zh['exact_match']>=.9,'forbidden_exception':s['forbidden_exception_false_fill_rate'] is not None and s['forbidden_exception_false_fill_rate']<=.05,'english_exact':en['exact_match']>=.8,'english_no_regression':en['exact_match']>=base_english-.02}
   gates[arm]={'checks':gate,'passed':all(gate.values()),'scope':'Only frozen bounded excerpt tasks, not global reliability or legal approval'}
  save(self.root/'final-results.json',{'at':now(),'status':'EXPERIMENT_COMPLETED','selected':selected,'results':all_scores,'release_gates':gates,'elapsed_seconds':time.monotonic()-self.start,'test_tuning_performed':False,'independent_human_chinese_gold':False,'english_original_human_reference':True,'production_changed':False,'weights_pushed':False})
  self.status('completed',gates=gates)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True);args=p.parse_args();experiment=None
 try:
  experiment=Experiment(args.root,args.base);experiment.run()
 except Exception as e:
  args.root.mkdir(parents=True,exist_ok=True);save(args.root/'failure.json',{'at':now(),'error':str(e),'traceback':traceback.format_exc(),'status':'STOPPED_OR_FAILED_NOT_PASSED'});print(traceback.format_exc(),flush=True);raise
