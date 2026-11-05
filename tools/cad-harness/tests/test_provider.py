import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from cad_harness.provider import invoke
class Response:
 def __init__(self,j):self.data=json.dumps(j).encode()
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read1(self,n):d=self.data;self.data=b'';return d
class ProviderTests(unittest.TestCase):
 def test_truncation_feedback_switches_to_direct_output_and_key_is_not_recorded(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);seen=[];key='TEST_ONLY_NOT_A_REAL_KEY'
   reply={'model':'test','usage':{'total_tokens':123},'choices':[{'finish_reason':'stop','message':{'content':'{"drawings":[]}'}}]}
   def http(req,timeout):seen.append(json.loads(req.data));return Response(reply)
   with patch.dict(os.environ,{'DEEPSEEK_API_KEY':key}),patch('cad_harness.provider.materials',return_value=[]),patch('urllib.request.urlopen',side_effect=http):
    result,usage=invoke(p,{'sources':[]},{},None,[{'message':'Model output incomplete: length'}],p,10000)
   self.assertEqual(seen[0]['thinking']['type'],'disabled');self.assertEqual(usage,123)
   self.assertNotIn(key,''.join(f.read_text(encoding='utf-8') for f in p.iterdir()))
 def test_truncated_output_records_usage_before_rejecting(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);reply={'usage':{'total_tokens':999},'choices':[{'finish_reason':'length','message':{'content':''}}]}
   with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST'}),patch('cad_harness.provider.materials',return_value=[]),patch('urllib.request.urlopen',return_value=Response(reply)):
    with self.assertRaisesRegex(RuntimeError,'incomplete'):invoke(p,{'sources':[]},{},None,[],p,10000)
   self.assertEqual(json.loads((p/'usage.json').read_text())['total_tokens'],999)
