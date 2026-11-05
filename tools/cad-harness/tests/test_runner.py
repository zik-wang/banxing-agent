import json,tempfile,unittest
import concurrent.futures,threading,time
from pathlib import Path
from unittest.mock import patch
from cad_harness.runner import run,package,evaluate
from cad_harness.storage import write,read
from cad_harness.provider import ProviderBlocked
from test_harness import plan,contract
class RunnerTests(unittest.TestCase):
 def test_global_cad_backend_is_serialized_across_workers(self):
  active=0;peak=0;lock=threading.Lock()
  def work(*args):
   nonlocal active,peak
   with lock:active+=1;peak=max(peak,active)
   time.sleep(.03)
   with lock:active-=1
   return {'status':'TEST'}
  with patch('cad_harness.runner._evaluate',side_effect=work),concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   results=list(pool.map(lambda _:evaluate(None,None,None),range(2)))
  self.assertEqual(peak,1);self.assertEqual(len(results),2)
 def job(self,rounds=3):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);p=Path(t.name)
  write(p/'job.json',{'sources':['drawing.txt'],'max_rounds':rounds,'token_budget':10000,'wall_clock_budget_seconds':60});write(p/'contract.json',contract());(p/'drawing.txt').write_text('source facts');return p
 def test_compile_failure_is_feedback_and_repaired(self):
  p=self.job();bad=plan();bad['drawings'][0]['views'][0]['commands'].append({'op':'exec','code':'forged'})
  seen=[]
  def model(job,cfg,ctr,previous,feedback,stage,remaining):
   seen.append(feedback);return (bad if len(seen)==1 else plan()),100
  with patch('cad_harness.runner.invoke',side_effect=model):state=run(p,'repair',render_images=False)
  self.assertEqual(state['round'],2);self.assertEqual(state['used_tokens'],200);self.assertEqual(state['status'],'CHECKS_PASS_SCOPE_LIMITED');self.assertEqual(seen[1][0]['error'],'PlanError')
 def test_budget_stops_without_accepting_missing_geometry(self):
  p=self.job(2);bad=plan([[0,0],[1,0],[1,1],[0,1]])
  with patch('cad_harness.runner.invoke',return_value=(bad,100)) as call:state=run(p,'fail',render_images=False)
  self.assertEqual(call.call_count,2);self.assertEqual(state['status'],'REPAIR_BUDGET_EXHAUSTED')
 def test_repeated_geometric_failure_switches_strategy_within_budget(self):
  p=self.job(3);bad=plan([[0,0],[1,0],[1,1],[0,1]]);seen=[]
  def model(job,cfg,ctr,previous,feedback,stage,remaining):
   seen.append(cfg.get('repair_reasoning',False));return bad,100
  with patch('cad_harness.runner.invoke',side_effect=model):state=run(p,'stagnant',render_images=False)
  self.assertEqual(seen,[False,False,True]);self.assertEqual(state['status'],'REPAIR_BUDGET_EXHAUSTED')
 def test_resume_does_not_recall_completed_model(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'ok',render_images=False)
  with patch('cad_harness.runner.invoke') as call:state=run(p,'ok',resume=True,render_images=False)
  call.assert_not_called();self.assertEqual(state['used_tokens'],100)
 def test_mutated_contract_cannot_resume(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'ok',render_images=False)
  c=contract();c['drawings']['drawing.png']['rules']=[];write(p/'contract.json',c)
  with self.assertRaisesRegex(RuntimeError,'changed'):run(p,'ok',resume=True,render_images=False)
 def test_bad_json_failure_is_fed_back_next_round(self):
  p=self.job();seen=[]
  def model(job,cfg,ctr,previous,feedback,stage,remaining):
   seen.append(feedback)
   if len(seen)==1:raise json.JSONDecodeError('bad','bad',0)
   return plan(),100
  with patch('cad_harness.runner.invoke',side_effect=model):state=run(p,'json',render_images=False)
  self.assertEqual(state['round'],2);self.assertEqual(seen[1][0]['error'],'JSONDecodeError')
 def test_no_duplicate_run_without_resume(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'ok',render_images=False)
  with self.assertRaisesRegex(RuntimeError,'exists'):run(p,'ok',render_images=False)
 def test_seeded_run_rechecks_before_model_call(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'old',render_images=False)
  with patch('cad_harness.runner.invoke') as call:s=run(p,'new',render_images=False,seed_from_run='old')
  call.assert_not_called();self.assertEqual(s['status'],'CHECKS_PASS_SCOPE_LIMITED');self.assertEqual(s['used_tokens'],0)
 def test_seed_run_mutation_is_detected_on_resume(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'old',render_images=False)
  run(p,'new',render_images=False,seed_from_run='old');write(p/'runs/old/latest_plan.json',{'changed':True})
  with self.assertRaisesRegex(RuntimeError,'changed'):run(p,'new',resume=True,render_images=False)
 def test_authentication_failure_stops_without_repeating_model_calls(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',side_effect=ProviderBlocked('HTTP401')) as call:s=run(p,'auth',render_images=False)
  self.assertEqual(call.call_count,1);self.assertEqual(s['status'],'SERVICE_BLOCKED')
 def test_package_rechecks_geometry_instead_of_trusting_saved_success(self):
  p=self.job()
  with patch('cad_harness.runner.invoke',return_value=(plan(),100)):run(p,'old',render_images=False)
  write(p/'runs/old/latest_plan.json',plan([[0,0],[1,0],[1,1],[0,1]]))
  with patch('cad_harness.runner.render'):package(p,'old')
  status=read(p/'runs/old/package_status.json');self.assertEqual(status['historical_run_status'],'CHECKS_PASS_SCOPE_LIMITED');self.assertEqual(status['status'],'GEOMETRY_FAILED')
