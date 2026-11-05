import unittest
from cad_harness.diagnostics import hints,signature
class DiagnosticsTests(unittest.TestCase):
 def test_actual_overlapping_grooves_get_actionable_diagnosis(self):
  p={'drawings':[{'source':'x.png','views':[{'id':'front','commands':[{'op':'groove_array','mode':'section','depth':.34,'angle':70.52,'pitch':.25,'channels':8}]}]}]}
  advice=hints(p,[{'id':'simple_closed_material_front'}]);self.assertTrue(any('0.480' in a for a in advice))
  self.assertEqual(p['drawings'][0]['views'][0]['commands'][0]['depth'],.34)
 def test_failure_signature_ignores_noisy_measurements(self):
  self.assertEqual(signature([{'id':'hole','actual':1}]),signature([{'id':'hole','actual':2}]))
