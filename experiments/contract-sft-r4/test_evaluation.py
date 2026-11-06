import unittest
from evaluation import decode,evaluate,paired_interval
class Checks(unittest.TestCase):
 def row(self):return {'id':'x','document_id':'d','query_type':'amount','context':'price 100; penalty 20','answers':['100']}
 def test_same_semantics_across_shapes(self):
  for text in ['["100"]','{"answers":["100"]}','\x60\x60\x60json\n["100"]\n\x60\x60\x60']:
   self.assertEqual(evaluate([self.row()],[{'id':'x','raw':text}])['exact_match'],1)
  self.assertFalse(decode('["100"]')[1]);self.assertTrue(decode('{"answers":["100"]}')[1])
 def test_empty_invalid_not_successful_abstention(self):
  r={**self.row(),'answers':[]};s=evaluate([r],[{'id':'x','raw':'oops'}]);self.assertEqual(s['exact_match'],0);self.assertEqual(s['empty_invalid_rate'],1)
 def test_no_answer_character_repairs(self):
  for raw in ['[" 100 "]','["20"]','["100元"]']:
   self.assertEqual(evaluate([self.row()],[{'id':'x','raw':raw}])['exact_match'],0)
 def test_empty_versus_hallucination(self):
  r={**self.row(),'answers':[]};self.assertEqual(evaluate([r],[{'id':'x','raw':'[]'}])['exact_match'],1)
  s=evaluate([r],[{'id':'x','raw':'["300"]'}]);self.assertEqual(s['empty_false_fill_rate'],1);self.assertEqual(s['unsupported_rate'],1)
 def test_invalid_schema_not_inferred(self):
  for raw in ['{"result":[]}','[""]','[1]','["100","100"]']:self.assertIsNone(decode(raw)[0])
 def test_pairs_and_identifiers(self):
  with self.assertRaises(ValueError):evaluate([self.row()],[{'id':'x','raw':'[]'},{'id':'x','raw':'[]'}])
  a=evaluate([self.row()],[{'id':'x','raw':'[]'}]);b=evaluate([self.row()],[{'id':'x','raw':'["100"]'}]);self.assertEqual(paired_interval(a,b)['delta'],1)
if __name__=='__main__':unittest.main(verbosity=2)
