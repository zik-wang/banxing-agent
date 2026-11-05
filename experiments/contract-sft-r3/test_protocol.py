import json,unittest
from metrics import parse,f1,score
from prepare import windows,synthetic
class ProtocolChecks(unittest.TestCase):
 def test_invalid_not_silently_negative(self):
  for raw in [None,'','{"answers":','{"answer":[]}', '{"answers":[1]}','{"answers":["x","x"]}']:
   self.assertIsNone(parse(raw))
  self.assertEqual(f1([],None),0);self.assertEqual(f1([],[]),1)
 def test_fence_rule_explicit_and_identical(self):
  self.assertIsNone(parse('\x60\x60\x60json\n{"answers":[]}\n\x60\x60\x60'))
  self.assertEqual(parse('\x60\x60\x60json\n{"answers":[]}\n\x60\x60\x60',True),[])
 def test_quotes_and_fields_are_separate(self):
  row={'id':'r','context':'付款100元；违约金20元','answers':['100元'],'document_id':'d','group':'g','corpus':'cuad_human_reference','query_type':'amount'}
  result=score([row],[{'id':'r','raw':'{"answers":["20元"]}'}])
  self.assertEqual(result['overall']['raw_quote_valid_rate'],1);self.assertEqual(result['overall']['exact_match'],0)
 def test_hallucination_reported(self):
  row={'id':'r','context':'金额待议','answers':[],'document_id':'d','group':'g','corpus':'cuad_human_reference','query_type':'amount'}
  result=score([row],[{'id':'r','raw':'{"answers":["99元"]}'}])
  self.assertEqual(result['overall']['unsupported_answers'],1);self.assertEqual(result['overall']['false_fill_on_empty'],1)
 def test_window_bytes_are_never_lost(self):
  text=('中文αβ\n'+('a'*93)+'. ')*30
  out=list(windows(text,100));self.assertEqual(''.join(x[2] for x in out),text)
  self.assertTrue(all(text[a:b]==part for a,b,part in out))
 def test_synthetic_gold_and_group_isolation(self):
  rows=synthetic()
  for x in rows:self.assertTrue(all(a in x['context'] for a in x['answers']))
  groups={s:{x['group'] for x in rows if x['split']==s} for s in ['train','dev','test']}
  self.assertFalse(groups['train']&groups['dev']);self.assertFalse(groups['train']&groups['test'])
 def test_allow_forbid_pairs_are_real_counterfactuals(self):
  rows=[r for r in synthetic() if r['split']=='test' and r['query_type']=='exception'];pairs={}
  for r in rows:pairs.setdefault(r['source']['pair_id'],[]).append(r)
  self.assertEqual(len(pairs),16)
  for pair in pairs.values():
   self.assertEqual(len(pair),2);a=next(x for x in pair if x['source']['exception_permitted']);b=next(x for x in pair if not x['source']['exception_permitted'])
   self.assertTrue(a['answers']);self.assertFalse(b['answers']);self.assertNotEqual(a['context'],b['context'])
if __name__=='__main__':unittest.main(verbosity=2)
