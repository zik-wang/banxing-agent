"""Lightweight opt-in launcher. Check capacity before importing Torch in a child.
Default is a read-only readiness check; training requires --start-training.
"""
import argparse,json,os,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
from gate import require_preflight
from resources import memory_status,require_capacity
def launch(root,base,start=False):
 require_preflight(root)
 if (root/'STOP').exists():raise RuntimeError('USER_STOP_FILE')
 c=Path('D:/pro222/pccr-eye-gaze/local-progress/data/run-control.json')
 if c.exists():
  control=json.loads(c.read_text(encoding='utf-8'))
  if control.get('mode')=='paused' or control.get('paused') or control.get('worker_pauses',{}).get('worker-02',{}).get('paused'):raise RuntimeError('USER_PAUSED')
  if control.get('deadline') and datetime.now(timezone.utc)>=datetime.fromisoformat(control['deadline']):raise RuntimeError('USER_DEADLINE')
 capacity=memory_status();sufficient=True
 quantized=json.loads((root/'protocol.json').read_text(encoding='utf-8')).get('base_storage')=='NF4'
 try:require_capacity(capacity,quantized,pre_torch=True)
 except RuntimeError:sufficient=False
 check={'at':datetime.now(timezone.utc).isoformat(),'memory':capacity,'resources_sufficient':sufficient,'training_started':False,'requested_start':start,'quantized_protocol':quantized,'guard':'Selective-logit execution: available commit>=7GiB BF16; NF4>=6GiB before Torch /5GiB after import, physical>=1GiB; runtime commit reserve1.5GiB (original1GiB). A bounded stress probe is not a guarantee for all examples or concurrent system activity. No OS settings changed.'}
 (root/'readiness.json').write_text(json.dumps(check,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(check),flush=True)
 if not start:return 0
 if not sufficient:raise RuntimeError('RESOURCE_GUARD_BLOCKED_BEFORE_TORCH_IMPORT')
 if (root/'events.jsonl').exists() or list(root.glob('seed-*')):raise RuntimeError('EXECUTION_ALREADY_EXISTS_DO_NOT_OVERWRITE')
 with (root/'console.log').open('xb') as output:
  env=dict(os.environ)
  if json.loads((root/'protocol.json').read_text(encoding='utf-8')).get('cuda_allocator')=='disabled-cache':env['PYTORCH_NO_CUDA_MEMORY_CACHING']='1'
  result=subprocess.run([sys.executable,'-u',str(root/'executed-code/run.py'),'--root',str(root),'--base',str(base)],stdout=output,stderr=subprocess.STDOUT,check=False,env=env)
 receipt={'at':datetime.now(timezone.utc).isoformat(),'exit_code':result.returncode,'completed_result_exists':(root/'final-results.json').exists(),'scope':'Exit0 or file existence is not benchmark/business acceptance; inspect final metrics and gates.'}
 (root/'exit-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8');print(json.dumps(receipt));return result.returncode
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True);p.add_argument('--start-training',action='store_true');a=p.parse_args();sys.exit(launch(a.root,a.base,a.start_training))
