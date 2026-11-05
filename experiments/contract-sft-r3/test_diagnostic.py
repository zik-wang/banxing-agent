import unittest
from diagnostic_format import parse_compatible
class DiagnosticChecks(unittest.TestCase):
 def test_only_shape_is_changed(self):
  raw='\x60\x60\x60json\n["  人民币12万元  "]\n\x60\x60\x60'
  self.assertEqual(parse_compatible(raw),(['  人民币12万元  '],'fenced_array_only'))
  self.assertEqual(parse_compatible('{"answers":["  人民币12万元  "]}')[0],['  人民币12万元  '])
 def test_invalid_or_unknown_not_guessed(self):
  for raw in ['{"result":["x"]}','[1]','["x","x"]','{"answers":null}','unfinished','{"answers":[],"confidence":1}']:
   self.assertIsNone(parse_compatible(raw)[0])
 def test_empty_array_and_wrong_field_are_unchanged(self):
  self.assertEqual(parse_compatible('[]')[0],[])
  self.assertEqual(parse_compatible('["违约金99元"]')[0],['违约金99元'])
if __name__=='__main__':unittest.main(verbosity=2)
