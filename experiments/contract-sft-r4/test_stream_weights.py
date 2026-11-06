import tempfile,unittest
from pathlib import Path
import torch
from safetensors.torch import save_file
from stream_weights import load_into
class Streaming(unittest.TestCase):
 def test_multiple_shapes_and_dtypes_exact_bytes(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'model.safetensors';expected={'a':torch.arange(21,dtype=torch.float32).reshape(3,7),'b':torch.tensor([1.125,-2.5],dtype=torch.bfloat16)};save_file(expected,str(p));state={k:torch.empty_like(v) for k,v in expected.items()};receipt=load_into(p,state)
   self.assertEqual(receipt['verified_destination_tensors'],2);self.assertFalse(receipt['whole_file_mmap'])
   for name in state:self.assertTrue(torch.equal(state[name],expected[name]))
 def test_missing_key_and_wrong_shape_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'model.safetensors';save_file({'x':torch.ones(3)},str(p))
   for state in [{'other':torch.empty(3)},{'x':torch.empty(4)}]:
    with self.assertRaises(ValueError):load_into(p,state)
 def test_truncated_payload_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'model.safetensors';save_file({'x':torch.ones(3)},str(p));p.write_bytes(p.read_bytes()[:-1])
   with self.assertRaisesRegex(ValueError,'OFFSETS'):load_into(p,{'x':torch.empty(3)})
if __name__=='__main__':unittest.main(verbosity=2)
