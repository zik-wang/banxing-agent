import hashlib,unittest
from amend import calibrated_run_matches

class AmendmentBoundaries(unittest.TestCase):
 def test_only_explicit_budget_plumbing_allowed(self):
  old=b"if t-self.started>14400:raise RuntimeError('TOTAL_4H_BUDGET')\nif time.monotonic()-start>3600:raise RuntimeError('ARM_BUDGET_INCOMPLETE:'+str(seed))\nlr=1e-4\n"
  expected=hashlib.sha256(old).hexdigest()
  self.assertTrue(calibrated_run_matches(old,expected))
  new=old.replace(b"if t-self.started>14400:raise RuntimeError('TOTAL_4H_BUDGET')",b"if t-self.started>self.protocol['limits']['total_seconds']:raise RuntimeError('TOTAL_STUDY_BUDGET')").replace(b'if time.monotonic()-start>3600:',b"if time.monotonic()-start>self.protocol['limits']['arm_wall_seconds']:")
  self.assertTrue(calibrated_run_matches(new,expected))
  self.assertFalse(calibrated_run_matches(new.replace(b'lr=1e-4',b'lr=1e-3'),expected))
  self.assertFalse(calibrated_run_matches(new.replace(b'ARM_BUDGET_INCOMPLETE',b'IGNORE_FAILURE'),expected))

if __name__=='__main__':unittest.main(verbosity=2)
