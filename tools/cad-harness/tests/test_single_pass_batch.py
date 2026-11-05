import copy,io,json,os,shutil,tempfile,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from cad_harness.synth20 import prepare,make_case
from cad_harness.single_pass_batch import Batch,BatchBlocked,exact_geometry
from cad_harness.storage import read,write
from cad_harness.engine import compile_one
from cad_harness.graph_audit import audit_graph
from cad_mcp import Server,serve

class Control:
 def check(self):return 100
 def authorization(self):pass

class Response:
 status=200;headers={}
 def __init__(self,value):self.raw=json.dumps(value).encode()
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,n):out=self.raw;self.raw=b'';return out

class SinglePassTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  base=Path(__file__).resolve().parents[1]/'.test-tmp';base.mkdir(exist_ok=True)
  cls.temp=tempfile.TemporaryDirectory(dir=base);cls.seed=Path(cls.temp.name)/'frozen';prepare(cls.seed)
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=Path(self.temp.name));self.root=Path(self.tmp.name)/'batch';shutil.copytree(self.seed,self.root);self.batch=Batch(self.root,Control())
 def tearDown(self):self.tmp.cleanup()
 def test_missing_auth_does_not_submit_or_consume_case(self):
  with patch.dict(os.environ,{},clear=True),patch('urllib.request.urlopen') as http:
   s=self.batch.run_next()
  self.assertEqual((s['submitted_attempts'],s['not_run'],s['stop_reason']),(0,20,'AUTH_ENV_MISSING'));http.assert_not_called()
 def test_429_stops_without_transport_retry_or_second_case(self):
  err=urllib.error.HTTPError('https://api.deepseek.com/chat/completions',429,'rate limited',{'Retry-After':'60'},None)
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',side_effect=err) as http:
   s=self.batch.run_next()
   with self.assertRaises(BatchBlocked):self.batch.run_next()
  self.assertEqual(http.call_count,1);self.assertEqual(s['submitted_attempts'],1);self.assertEqual(s['stop_reason'],'HTTP_429')
 def test_timeout_consumes_attempt_and_never_replays(self):
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',side_effect=TimeoutError) as http:
   s=self.batch.run_next()
   with self.assertRaises(BatchBlocked):self.batch.run_next()
  self.assertEqual(http.call_count,1);self.assertEqual(s['blocked_or_indeterminate'],1)
 def test_first_invalid_json_blocks_remaining_19(self):
  value={'model':'deepseek-flash','choices':[{'finish_reason':'stop','message':{'content':'{invalid'}}]}
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',return_value=Response(value)) as http:
   s=self.batch.run_next()
  self.assertEqual(s['validation_failed'],1);self.assertEqual(s['not_run'],19);self.assertEqual(s['stop_reason'],'FIRST_CASE_FORMAT_FAILED');self.assertEqual(http.call_count,1)
 def test_geometry_failure_is_retained_and_next_call_uses_next_image(self):
  value={'model':'deepseek-flash','choices':[{'finish_reason':'stop','message':{'content':'{"drawings":[]}'}}]};seen=[]
  def http(req,timeout):seen.append(json.loads(req.data));return Response(value)
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',side_effect=http),patch('cad_harness.single_pass_batch.verify_candidate',return_value={'status':'FAIL'}):
   first=self.batch.run_next();second=self.batch.run_next()
  self.assertEqual((first['validation_failed'],second['validation_failed'],second['submitted_attempts']),(1,2,2));self.assertIsNone(second['stop_reason'])
  self.assertNotEqual(seen[0]['messages'][1]['content'][-3],seen[1]['messages'][1]['content'][-3]);self.assertEqual(len(seen[1]['messages']),2)
 def test_actual_model_mismatch_is_not_silently_accepted(self):
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',return_value=Response({'model':'different-model'})):
   s=self.batch.run_next()
  self.assertEqual(s['stop_reason'],'UNVERIFIED_ACTUAL_MODEL');self.assertFalse(s['first_format_verified'])
 def test_input_change_rejected_before_network(self):
  e=self.batch.manifest()['entries'][0];(self.root/e['path']/'sources/functional_modules.md').write_text('CHANGED',encoding='utf-8')
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen') as http:
   with self.assertRaisesRegex(BatchBlocked,'Frozen case'):self.batch.run_next()
  http.assert_not_called()
 def test_orphan_in_flight_is_not_replayed(self):
  s=self.batch.state();s['rows'][next(iter(s['rows']))].update(status='IN_FLIGHT',attempts=1);self.batch.save(s)
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen') as http:
   with self.assertRaisesRegex(BatchBlocked,'in-flight'):self.batch.run_next()
  http.assert_not_called()
 def test_manifest_change_rejected(self):
  m=read(self.root/'manifest.json');m['max_inference_requests']=200;write(self.root/'manifest.json',m)
  with self.assertRaisesRegex(BatchBlocked,'manifest changed'):self.batch.status()
 def test_paused_control_prevents_network(self):
  with patch.object(self.batch.control,'check',side_effect=BatchBlocked('paused')),patch('urllib.request.urlopen') as http:
   with self.assertRaises(BatchBlocked):self.batch.run_next()
  http.assert_not_called()
 def test_completed_cases_are_not_retried(self):
  s=self.batch.state()
  for row in s['rows'].values():row.update(status='FAIL',attempts=1)
  s['first_format_verified']=True;self.batch.save(s)
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen') as http:s=self.batch.run_next()
  self.assertEqual(s['submitted_attempts'],20);http.assert_not_called()
 def test_20_distinct_images_and_four_families(self):
  m=self.batch.manifest();self.assertEqual(len({e['files']['sources/'+e['source']] for e in m['entries']}),20);self.assertEqual(len({e['family'] for e in m['entries']}),4)
 def test_request_includes_image_and_module_but_not_reference_values(self):
  seen=[]
  def http(req,timeout):seen.append(json.loads(req.data));raise TimeoutError()
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST_ONLY'}),patch('urllib.request.urlopen',side_effect=http):self.batch.run_next()
  content=seen[0]['messages'][1]['content'];self.assertEqual(sum(x['type']=='image_url' for x in content),1)
  self.assertTrue(any('独立功能模块说明' in x.get('text','') for x in content));self.assertNotIn('max_distance_mm',json.dumps(seen[0]));self.assertNotIn('"radii"',json.dumps(seen[0]))

class MCPTests(unittest.TestCase):
 def test_stdio_initialization_tools_and_missing_auth_via_real_dispatch(self):
  class FakeBatch:
   def status(self):return {'submitted_attempts':0,'not_run':20}
  messages=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18'}},{'jsonrpc':'2.0','method':'notifications/initialized'},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'cad_batch_status','arguments':{}}}]
  out=io.StringIO();serve(Server(FakeBatch()),io.StringIO('\n'.join(json.dumps(x) for x in messages)+'\n'),out);replies=[json.loads(x) for x in out.getvalue().splitlines()]
  self.assertEqual(len(replies),3);self.assertEqual(len(replies[1]['result']['tools']),3);self.assertEqual(json.loads(replies[2]['result']['content'][0]['text'])['not_run'],20)
 def test_arbitrary_path_or_command_is_not_a_tool(self):
  server=Server(None);server.initialized=server.ready=True
  r=server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'shell','arguments':{'cmd':'anything'}}})
  self.assertEqual(r['error']['code'],-32602)

class GraphAndGeometryTests(unittest.TestCase):
 def evaluate(self,mutate):
  name,p,s,t=make_case('groove',2);mutate(p['drawings'][0]);base=Path(__file__).resolve().parents[1]/'.test-tmp';base.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=base) as d:
   file,_=compile_one(p['drawings'][0],Path(d),s)
   return audit_graph(file,t['graph']),exact_geometry(file,t)
 def test_branch_graph_has_real_entities_and_ports(self):
  g,_=self.evaluate(lambda r:None);self.assertFalse(g['failures'])
 def test_missing_branch_is_rejected(self):
  g,_=self.evaluate(lambda r:r['views'][2]['commands'].pop());self.assertTrue(g['failures'])
 def test_reversed_connection_is_rejected(self):
  def change(r):r['views'][2]['commands'][-1]['points'].reverse()
  g,_=self.evaluate(change);self.assertTrue(g['failures'])
 def test_detached_port_is_rejected(self):
  def change(r):r['views'][2]['commands'][-1]['points'][0][0]-=.5
  g,_=self.evaluate(change);self.assertTrue(g['failures'])
 def test_triangle_cannot_fake_module_bbox_port(self):
  def change(r):r['views'][2]['commands'][1]['points'].pop(1)
  g,_=self.evaluate(change);self.assertTrue(g['failures'])
 def test_same_bbox_wrong_boundary_is_rejected(self):
  def change(r):r['views'][0]['commands'][0]['points'].insert(1,[2,1])
  _,e=self.evaluate(change);self.assertTrue(e['failures'])

if __name__=='__main__':unittest.main()
