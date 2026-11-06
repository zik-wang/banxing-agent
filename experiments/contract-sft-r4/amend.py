"""Create a fresh execution revision, retaining the prior freeze and all results."""
import argparse,hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
from audit_ready import sha,read

def calibrated_run_matches(data,expected):
 if hashlib.sha256(data).hexdigest()==expected:return True
 # Only time-budget plumbing may change after a completed capacity probe.
 # Both budgets are frozen prospectively in the new protocol, not raised after
 # a failed formal arm. No forward/loss/safety/optimizer edits are permitted.
 replacements=[(b"if t-self.started>self.protocol['limits']['total_seconds']:raise RuntimeError('TOTAL_STUDY_BUDGET')",b"if t-self.started>14400:raise RuntimeError('TOTAL_4H_BUDGET')"),(b"if time.monotonic()-start>self.protocol['limits']['arm_wall_seconds']:",b"if time.monotonic()-start>3600:")]
 for new,old in replacements:
  if data.count(new)!=1:return False
  data=data.replace(new,old)
 return hashlib.sha256(data).hexdigest()==expected

def amend(source,root,calibration):
 if root.exists():raise ValueError('NEW_EXECUTION_DIRECTORY_REQUIRED')
 parent=read(source/'freeze.json');plan=read(calibration/'calibration-plan.json');probe=read(calibration/'result.json')
 if probe.get('status')!='BOUNDED_CALIBRATION_COMPLETED' or not probe['mask_equivalence']['passed'] or not probe['objective_equivalence']['passed']:
  raise ValueError('SUCCESSFUL_CALIBRATION_REQUIRED')
 if plan['source_freeze_sha256']!=sha(source/'freeze.json') or plan['source_train_sha256']!=sha(source/'train.jsonl'):
  raise ValueError('CALIBRATION_SOURCE_BINDING')
 code=Path(__file__).parent
 # The capacity guard may be revised after measurement. The actual forward,
 # loader, mask and stress implementation must be the measured implementation.
 for name in ['run.py','calibrate.py','supervised.py','causal.py','stream_weights.py','quantization.py']:
  if sha(code/name)!=plan['code'][name]:
   # Permit only explicit prospective time-budget plumbing, no engine changes.
   if name!='run.py':raise ValueError('CALIBRATED_ENGINE_CHANGED:'+name)
   if not calibrated_run_matches((code/name).read_bytes(),plan['code'][name]):raise ValueError('ONLY_FROZEN_TIME_BUDGET_PLUMBING_PERMITTED')
 root.mkdir();(root/'executed-code').mkdir()
 for name in ['train.jsonl','dev.jsonl','test.jsonl','protocol.json','data-decisions.jsonl','base-manifest.json']:
  if sha(source/name)!=parent['files'][name]:raise ValueError('PARENT_FILE_CHANGED:'+name)
  shutil.copyfile(source/name,root/name)
 shutil.copyfile(source/'freeze.json',root/'parent-freeze.json')
 nf4=read(calibration/'protocol.json').get('base_storage')=='NF4'
 if nf4:
  protocol=read(calibration/'protocol.json')
  protocol['limits']={**protocol['limits'],'arm_wall_seconds':7200,'total_seconds':28800,'budget_amendment_reason':'Before any formal NF4 arm: disabled CUDA cache stress calibration needed108s for5 updates including loading/probes; allow2h per arm and8h total for slower allocation plus fixed validation/test. Fixed300 updates and every quality gate retained.'}
  (root/'protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 amendment={'at':datetime.now(timezone.utc).isoformat(),'version':'selective-supervision-execution-v1','parent_freeze_sha256':sha(source/'freeze.json'),'calibration_result_sha256':sha(calibration/'result.json'),'calibration_plan_sha256':sha(calibration/'calibration-plan.json'),'data_protocol_scorer_model_hyperparameters_unchanged':True,'changes':['Project only supervised next-token vocabulary rows; retain all context and EOS targets. Numeric GEMM roundoff tolerances disclosed in probes, no label or scoring changes.','Release unused CUDA cache after each microbatch and dev row.','Calibrated admission7GiB commit/1GiB physical; runtime reserve strengthened to2GiB. Historical12/4 guard retained in parent freeze.','Fresh fixed300-step arms from base; calibration weights discarded, prior50-step failure remains incomplete.'],'calibration_scope':'5 updates/20 stress microbatches, training rows only; no held-out predictions or reliability inference','real_model_objective_probe':probe['objective_equivalence'],'new_execution_start_authorized':True,'production_changed':False,'cloud_requests':0}
 (root/'execution-amendment.json').write_text(json.dumps(amendment,indent=2)+'\n',encoding='utf-8')
 if nf4:
  amendment.update(version='nf4-qlora-execution-v1',data_protocol_scorer_model_hyperparameters_unchanged=False,data_and_scorer_and_training_hyperparameters_unchanged=True,model_precision_changed='BF16 base transformer linears -> NF4 double-quantized storage / BF16 compute; tied embeddings/head remain BF16; FP32 LoRA',baseline_comparison='NF4 unadapted baseline vs same NF4 base plus LoRA; not BF16-equivalent or pooled with BF16 scores')
  amendment['changes'].append('Alternative NF4 protocol; available commit admission6GiB, physical1GiB, runtime commit reserve1.5GiB (original pre-repair runtime reserve1GiB). Per-layer packed/scale hashes must match every arm and the baseline reload.')
  amendment['changes'].append('Before formal arms: frozen runtime budget2h per arm/8h total for disabled-cache allocator overhead; calibration itself remains6min. No increase in optimizer steps or held-out exposure.')
  amendment['changes'].append('Admission phase accounting: NF4 needs6GiB commit before Torch import and5GiB after import, matching calibration initial5GiB check; runtime1.5GiB reserve unchanged.')
  amendment['changes']=[v.replace('runtime reserve strengthened to2GiB','runtime reserve1.5GiB; above original1GiB').replace('runtime commit reserve2GiB','runtime commit reserve1.5GiB') for v in amendment['changes']]
  (root/'execution-amendment.json').write_text(json.dumps(amendment,indent=2)+'\n',encoding='utf-8')
 for file in code.glob('*.py'):shutil.copyfile(file,root/'executed-code'/file.name)
 files=['train.jsonl','dev.jsonl','test.jsonl','protocol.json','data-decisions.jsonl','base-manifest.json','execution-amendment.json','parent-freeze.json']
 freeze={'at':amendment['at'],'files':{name:sha(root/name) for name in files},'code':{p.name:sha(p) for p in (root/'executed-code').glob('*.py')},'test_predictions_seen':False,'pretraining_revision':amendment['version']}
 (root/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'root':str(root),'files':len(files),'code':len(freeze['code']),'old_execution_unchanged':True}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--calibration',type=Path,required=True);a=p.parse_args();amend(a.source,a.root,a.calibration)
