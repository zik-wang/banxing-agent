"""Bounded stdlib-only admission watcher. At most one launch; never model retries.

Does not alter frozen executed code, overwrite prior startup logs, change user
controls, kill applications, modify paging, or lower quality/resource gates.
"""
import argparse,json,os,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
from gate import require_preflight
from resources import memory_status,require_capacity

CONTROL=Path('D:/pro222/pccr-eye-gaze/local-progress/data/run-control.json')
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def stopped(root,control):
 if (root/'STOP').exists():return 'USER_STOP_FILE'
 if control.get('mode')=='paused' or control.get('paused') or control.get('worker_pauses',{}).get('worker-02',{}).get('paused'):return 'USER_PAUSED'
 if control.get('deadline') and datetime.now(timezone.utc)>=datetime.fromisoformat(control['deadline']):return 'USER_DEADLINE'
 return None

def sufficient(capacity):
 try:require_capacity(capacity,quantized=True,pre_torch=True)
 except RuntimeError:return False
 # Two consecutive samples include an extra0.5GiB margin for system variation.
 return not capacity.get('windows') or capacity['available_commit']>=6.5*1024**3

def watch(root,base,minutes):
 if not 1<=minutes<=30:raise ValueError('WAIT_LIMIT_MUST_BE_1_TO_30_MINUTES')
 require_preflight(root)
 if read(root/'protocol.json').get('base_storage')!='NF4':raise ValueError('WATCHER_ONLY_FOR_CALIBRATED_NF4')
 if (root/'events.jsonl').exists() or (root/'resource-wait.jsonl').exists():raise ValueError('ALREADY_STARTED_OR_WATCHED')
 started=time.monotonic();stable=0;launch_at=None;last_state=None
 def record(state,**extra):
  nonlocal last_state
  elapsed=time.monotonic()-started
  item={'at':datetime.now(timezone.utc).isoformat(),'state':state,'elapsed_seconds':elapsed,'waited_seconds':(launch_at-started) if launch_at is not None else elapsed,'max_wait_minutes':minutes,'launcher_attempts':0,**extra}
  with (root/'resource-wait.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(item)+'\n')
  (root/'resource-wait.json').write_text(json.dumps(item,indent=2)+'\n',encoding='utf-8');print(json.dumps(item),flush=True)
  if state!=last_state:
   status='running' if state in ['WAITING_FOR_CAPACITY','SINGLE_LAUNCH_ATTEMPT'] else 'blocked'
   stage={'WAITING_FOR_CAPACITY':'NF4低内存探测通过，正式训练限时等待资源','SINGLE_LAUNCH_ATTEMPT':'资源连续满足，开始一次受保护启动','WAIT_EXPIRED_WITHOUT_MODEL_LAUNCH':'资源等待30分钟届满；正式训练未启动','STOPPED_WITHOUT_MODEL_LAUNCH':'遵从用户暂停或截止；未启动模型','SINGLE_LAUNCH_EXITED':'受保护执行已退出；以结果和质量门槛为准'}.get(state,state)
   subprocess.run(['D:/New Folder/node.exe','D:/pro222/pccr-eye-gaze/local-progress/report.mjs','worker-02','T2',status,stage,'核查既有结果，不自动重试或代用户验收','-' if status!='blocked' else extra.get('reason','资源启动或执行未完成'),str(root/'resource-wait.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
   last_state=state
  return item
 while time.monotonic()-started<minutes*60:
  reason=stopped(root,read(CONTROL) if CONTROL.exists() else {})
  if reason:record('STOPPED_WITHOUT_MODEL_LAUNCH',reason=reason);return 2
  capacity=memory_status();stable=stable+1 if sufficient(capacity) else 0
  record('WAITING_FOR_CAPACITY',memory=capacity,consecutive_ready=stable)
  if stable>=2:
   if (root/'events.jsonl').exists():record('OTHER_EXECUTION_STARTED');return 3
   launch_at=time.monotonic()
   record('SINGLE_LAUNCH_ATTEMPT',memory=capacity,launcher_attempts=1)
   with (root/'resource-launch.stdout.log').open('xb') as out,(root/'resource-launch.stderr.log').open('xb') as err:
    result=subprocess.run([sys.executable,'-u',str(root/'executed-code/launch.py'),'--root',str(root),'--base',str(base),'--start-training'],stdout=out,stderr=err,check=False,env=dict(os.environ))
   record('SINGLE_LAUNCH_EXITED',launcher_attempts=1,exit_code=result.returncode,study_result_exists=(root/'final-results.json').exists(),reason='Execution ended; metrics and broader T2 acceptance remain unreviewed.',scope='Inspect study metrics and gates; exit0 is not model reliability, independent QA, or user acceptance.')
   return result.returncode
  time.sleep(15)
 record('WAIT_EXPIRED_WITHOUT_MODEL_LAUNCH',reason='System capacity did not remain above the calibrated admission margin. No automatic retry or further gate lowering.');return 4

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True);p.add_argument('--minutes',type=int,default=30);a=p.parse_args();sys.exit(watch(a.root,a.base,a.minutes))
