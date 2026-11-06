import tempfile,unittest
from pathlib import Path
from wait_capacity import stopped,sufficient

class CapacityWaitBoundaries(unittest.TestCase):
 def test_capacity_margin_and_physical_floor(self):
  gib=1024**3
  self.assertTrue(sufficient({'windows':True,'available_commit':int(6.5*gib),'available_physical':gib}))
  self.assertFalse(sufficient({'windows':True,'available_commit':6*gib,'available_physical':gib}))
  self.assertFalse(sufficient({'windows':True,'available_commit':8*gib,'available_physical':gib-1}))
 def test_explicit_pause_stop_and_expired_deadline(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   self.assertIsNone(stopped(root,{}))
   for value in [{'mode':'paused'},{'paused':True},{'worker_pauses':{'worker-02':{'paused':True}}}]:self.assertEqual(stopped(root,value),'USER_PAUSED')
   self.assertEqual(stopped(root,{'deadline':'2000-01-01T00:00:00+00:00'}),'USER_DEADLINE')
   (root/'STOP').write_text('pause');self.assertEqual(stopped(root,{}),'USER_STOP_FILE')

if __name__=='__main__':unittest.main(verbosity=2)
