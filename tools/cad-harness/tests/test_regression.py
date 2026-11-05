import tempfile,unittest,json
from pathlib import Path
from cad_harness.runner import evaluate
class OriginalDrawingRegressions(unittest.TestCase):
 def test_previously_103_pass_package_is_rejected_for_actual_missing_features(self):
  job=Path(__file__).resolve().parents[1]/'jobs/optical-vgroove-v2'
  if not (job/'seed_plan.json').is_file() or not (job/'contract.json').is_file():
   self.skipTest('Authorized local drawing regression fixtures are not distributed with the public code checkout')
  plan=json.loads((job/'seed_plan.json').read_text(encoding='utf-8'));contract=json.loads((job/'contract.json').read_text(encoding='utf-8'))
  with tempfile.TemporaryDirectory() as t:r=evaluate(plan,contract,Path(t),False)
  failures={d['source']:{x['id'] for x in d['failures']} for d in r['drawings']}
  self.assertEqual(r['status'],'GEOMETRY_FAILED');self.assertIn('shoulder135',failures['1.jpg']);self.assertIn('rear_R',failures['6.pdf']);self.assertIn('lid_microstep',failures['6.pdf']);self.assertIn('mark_1_3_from_end',failures['6.pdf'])
