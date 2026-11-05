"""CLI for this explicitly authorized synthetic 20-case batch and its MCP tools."""
import argparse,json,sys,shutil,subprocess,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','offline-check','status','run']);p.add_argument('--batch',required=True);p.add_argument('--deps',action='append',default=[]);p.add_argument('--node',default=shutil.which('node'));p.add_argument('--control',required=True);p.add_argument('--report-worker',choices=['worker-03']);a=p.parse_args();sys.path[:0]=[str(ROOT)]+a.deps
 from cad_harness.synth20 import prepare
 from cad_harness.single_pass_batch import Batch,LocalControl,verify_candidate,BatchBlocked
 from cad_harness.storage import read,write
 if not a.node:p.error('Node executable required for control')
 c=LocalControl(a.node,a.control);batch=Batch(a.batch,c)
 def report(stage,status='running',blocker='-'):
  if not a.report_worker:return
  counts=batch.status();summary=f"准备{counts['prepared']} 提交尝试{counts['submitted_attempts']} 返回{counts['returned']} 通过{counts['validation_passed']} 失败{counts['validation_failed']} 未运行{counts['not_run']}"
  r=subprocess.run([a.node,str(Path(a.control).parent/'report.mjs'),a.report_worker,'T3',status,stage+' '+summary,'保留失败，不重试',blocker,str(Path(a.batch).resolve()/'summary.json')],capture_output=True,encoding='utf-8',timeout=25,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
  if r.returncode:raise RuntimeError('Progress reporting failed')
 if a.action=='prepare':c.check();c.authorization();m=prepare(a.batch);write(Path(a.batch)/'summary.json',batch.status());print(json.dumps({'prepared':len(m['entries']),'batch':str(Path(a.batch).resolve())}));report('20张合成图及功能说明已冻结')
 elif a.action=='status':print(json.dumps(batch.status(),ensure_ascii=False))
 elif a.action=='offline-check':
  c.check();records=[]
  for e in batch.manifest()['entries']:
   c.check();job=batch.inputs(e);result=verify_candidate(job,read(job/'reference_plan.json'),Path(a.batch)/'reference_checks'/e['id'],False)
   records.append({'id':e['id'],'status':result['status'],'reference_fixture_not_model_output':True})
  write(Path(a.batch)/'offline_reference_checks.json',records);print(json.dumps({'reference_fixtures':len(records),'passed':sum(x['status']=='PASS_SCOPE_LIMITED' for x in records),'real_model_requests':0}));
  if any(x['status']!='PASS_SCOPE_LIMITED' for x in records):raise RuntimeError('Synthetic source/reference/evaluator inconsistency')
 elif a.action=='run':
  report('20图单次调用批次开始')
  from cad_mcp_client import Client
  with Client(a.batch,a.deps,a.node,a.control,Path(a.batch)/'mcp-stderr.log') as client:
   client.request('tools/list',{})
   while True:
    s=client.call('cad_run_next');write(Path(a.batch)/'summary.json',s);write(Path(a.batch)/'mcp-run-trace.json',client.trace);n=s['submitted_attempts'];print(json.dumps({k:v for k,v in s.items() if k!='rows'},ensure_ascii=False),flush=True)
    if s['stop_reason']:
     report('20图批次停止','blocked',s['stop_reason']);break
    if n==1 or n%5==0:report('首图端到端结果' if n==1 else f'已完成第{n}张')
    if s['not_run']==0:report('20图本轮执行结束','done');break
 return 0

if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8');raise SystemExit(main())
