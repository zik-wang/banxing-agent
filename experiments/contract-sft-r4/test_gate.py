import hashlib,json,tempfile,unittest
from pathlib import Path
from gate import require_preflight
class Gates(unittest.TestCase):
 def test_missing_and_failed_audit_block(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)
   with self.assertRaisesRegex(ValueError,'MISSING'):require_preflight(p)
   (p/'preflight-audit.json').write_text('{"passed":0,"failed":1}')
   with self.assertRaisesRegex(ValueError,'NOT_PASSED'):require_preflight(p)
 def test_changed_freeze_blocks_stale_audit(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'freeze.json').write_bytes(b'v1')
   a={'passed':5,'failed':0,'training_started_before_this_audit':False,'freeze_sha256':hashlib.sha256(b'v1').hexdigest()};(p/'preflight-audit.json').write_text(json.dumps(a));self.assertEqual(require_preflight(p),a)
   (p/'freeze.json').write_bytes(b'v2')
   with self.assertRaisesRegex(ValueError,'STALE'):require_preflight(p)
 def test_post_training_approval_does_not_count(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'preflight-audit.json').write_text('{"passed":5,"failed":0,"training_started_before_this_audit":true}')
   with self.assertRaisesRegex(ValueError,'NOT_PASSED'):require_preflight(p)
if __name__=='__main__':unittest.main(verbosity=2)
