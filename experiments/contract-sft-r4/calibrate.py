"""Bounded training-only resource calibration, never an official study arm/test.

Preserves model precision, objective, optimizer and frozen data. The admission
floor here is explicitly experimental; measured peaks are not a proof for all
future examples or a license to alter the study's quality gates.
"""
import argparse,gc,hashlib,json,os,shutil,sys,time,traceback
if '--no-cuda-cache' in sys.argv:os.environ['PYTORCH_NO_CUDA_MEMORY_CACHING']='1'
from pathlib import Path
from run import Study,read,rows,save,sha,now,torch
from resources import memory_status
from supervised import supervised_forward

GIB=1024**3
class Calibration(Study):
 def check(self):
  super().check()
  capacity=memory_status()
  if capacity.get('windows') and capacity['available_commit']<1.5*GIB:
   raise RuntimeError('CALIBRATION_COMMIT_RESERVE_BELOW_1_5GIB:'+str(capacity))
  if time.monotonic()-self.started>360:raise RuntimeError('CALIBRATION_6_MINUTE_LIMIT')
 def status(self,phase,**values):
  super().status(phase,**values)
  with (self.root/'memory.jsonl').open('a',encoding='utf-8') as f:
   free,total=torch.cuda.mem_get_info()
   f.write(json.dumps({'at':now(),'phase':phase,'memory':memory_status(),'cuda_allocated':torch.cuda.memory_allocated(),'cuda_reserved':torch.cuda.memory_reserved(),'allocator_stats_valid':os.environ.get('PYTORCH_NO_CUDA_MEMORY_CACHING')!='1','driver_global_used_bytes':total-free})+'\n')

def main(source,root,base,nf4=False,no_cuda_cache=False):
 root.mkdir(exist_ok=False)
 (root/'executed-code').mkdir()
 for file in Path(__file__).parent.glob('*.py'):shutil.copyfile(file,root/'executed-code'/file.name)
 protocol=read(source/'protocol.json')
 if nf4:protocol={**protocol,'version':'human-cuad-r4-qlora-v1','base_storage':'NF4','compute_dtype':'BF16','comparison':'NF4 unadapted baseline vs NF4+FP32 LoRA, not BF16-equivalent'}
 if no_cuda_cache:protocol={**protocol,'cuda_allocator':'disabled-cache'}
 save(root/'protocol.json',protocol)
 before=memory_status();save(root/'initial-resources.json',before)
 if before.get('windows') and (before['available_commit']<5*GIB or before['available_physical']<GIB):
  raise RuntimeError('CALIBRATION_INITIAL_RESERVE_BELOW_5GIB_COMMIT_OR_1GIB_PHYSICAL')
 if torch.cuda.mem_get_info()[0]<4500*1024**2:raise RuntimeError('GPU_OCCUPIED')
 if {n:sha(base/n) for n in read(source/'base-manifest.json')}!=read(source/'base-manifest.json'):
  raise RuntimeError('BASE_HASH_MISMATCH')
 study=Calibration(root,base);train=rows(source/'train.jsonl')
 lengths=[]
 for r in train:
  prompt=study.tokenizer.apply_chat_template(r['messages'][:-1],tokenize=True,add_generation_prompt=True)
  full=study.tokenizer.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False)
  lengths.append((len(full),len(full)-len(prompt),r))
 longest=sorted(lengths,key=lambda x:(x[0],x[1]),reverse=True)[:10]
 target=sorted(lengths,key=lambda x:(x[1],x[0]),reverse=True)[:10]
 selected=[v[2] for pair in zip(longest,target) for v in pair]
 save(root/'calibration-plan.json',{'scope':'Training-only 5 optimizer updates / 20 microbatches; longest sequences and longest targets, not a study arm or held-out evaluation. Duplicate rows across the two stress lists are intentional.','source_train_sha256':sha(source/'train.jsonl'),'source_freeze_sha256':sha(source/'freeze.json'),'base_hashes':read(source/'base-manifest.json'),'code':{p.name:sha(p) for p in Path(__file__).parent.glob('*.py')},'samples':[{'id':r['id'],'full_tokens':len(study.tokenizer.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False))} for r in selected],'steps':5,'seed':61106,'runtime_commit_reserve_bytes':int(1.5*GIB),'wall_budget_seconds':360,'held_out_predictions':0,'cloud_requests':0})
 # Full-vocabulary reference is an equivalence control, not the optimized path.
 # Use a short actual training row for it; stress the optimized path at maximum
 # observed training lengths below. No truncation or changed training targets.
 control=min(lengths,key=lambda v:v[0])[2]
 m=study.model(61106);study.probe(m,control,root/'mask-equivalence-probe.json');study.objective_probe(m,control,root/'objective-equivalence-probe.json')
 opt=torch.optim.AdamW([p for p in m.parameters() if p.requires_grad],lr=1e-4,betas=(.9,.999),eps=1e-8,weight_decay=.01)
 torch.cuda.reset_peak_memory_stats();records=[]
 for step in range(5):
  study.check();m.train();opt.zero_grad(set_to_none=True);values=[]
  for r in selected[step*4:(step+1)*4]:
   study.check();x,pt,tt=study.encode(r);loss=supervised_forward(m,x).loss
   if not torch.isfinite(loss):raise RuntimeError('NONFINITE_LOSS')
   (loss/4).backward();values.append(float(loss.detach()));del x,loss;torch.cuda.empty_cache()
   study.status('calibration_microbatch',step=step+1,row_id=r['id'],prompt_tokens=pt,target_tokens=tt)
  norm=float(torch.nn.utils.clip_grad_norm_(m.parameters(),1));opt.step();opt.zero_grad(set_to_none=True);gc.collect();torch.cuda.empty_cache()
  record={'step':step+1,'loss':sum(values)/4,'gradient_norm':norm,'memory':memory_status(),'cuda_peak_allocated':torch.cuda.max_memory_allocated(),'cuda_peak_reserved':torch.cuda.max_memory_reserved()};records.append(record);study.status('calibration_update',**record)
 save(root/'result.json',{'at':now(),'status':'BOUNDED_CALIBRATION_COMPLETED','updates':records,'mask_equivalence':read(root/'mask-equivalence-probe.json'),'objective_equivalence':read(root/'objective-equivalence-probe.json'),'elapsed_seconds':time.monotonic()-study.started,'official_training_started':False,'held_out_test_run':False,'quality_claim':'None; this is a local capacity/mathematical equivalence probe only.'})

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True);p.add_argument('--nf4',action='store_true');p.add_argument('--no-cuda-cache',action='store_true');a=p.parse_args()
 try:main(a.source,a.root,a.base,a.nf4,a.no_cuda_cache)
 except Exception as e:
  if a.root.exists():save(a.root/'failure.json',{'at':now(),'type':type(e).__name__,'error':str(e),'traceback':traceback.format_exc(),'memory':memory_status(),'scope':'Calibration failure, not a benchmark score.'})
  raise
