import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import torch
from safetensors.torch import save_file
from local_weight_loader import load_state_into

class Tiny(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.weight=torch.nn.Parameter(torch.empty((2,3),device='meta',dtype=torch.bfloat16))
        self.bias=torch.nn.Parameter(torch.empty((2,),device='meta',dtype=torch.bfloat16))
    def tie_weights(self):pass

class WeightReaderTest(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='v7-weight-loader-')
        self.root=Path(self.temporary.name)
        self.values={'weight':torch.arange(6,dtype=torch.bfloat16).reshape(2,3),'bias':torch.tensor([1,2],dtype=torch.bfloat16)}
    def tearDown(self):
        self.assertEqual(self.root.resolve().parent,Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith('v7-weight-loader-'))
        self.temporary.cleanup()
    def write(self,values):save_file(values,str(self.root/'model.safetensors'))
    def test_exact_values_and_original_dtype(self):
        self.write(self.values)
        model=load_state_into(Tiny(),self.root,'cpu')
        for key,value in model.state_dict().items():
            self.assertEqual(value.dtype,self.values[key].dtype)
            self.assertTrue(torch.equal(value,self.values[key]))
        self.assertFalse(model.training)
    def test_wrong_shape_rejected(self):
        self.write({**self.values,'weight':torch.ones((3,2),dtype=torch.bfloat16)})
        with self.assertRaisesRegex(ValueError,'形状'):load_state_into(Tiny(),self.root,'cpu')
    def test_unknown_key_rejected(self):
        self.write({**self.values,'foreign':torch.ones(1)})
        with self.assertRaisesRegex(ValueError,'名称'):load_state_into(Tiny(),self.root,'cpu')
    def test_missing_tensor_rejected(self):
        self.write({'weight':self.values['weight']})
        with self.assertRaisesRegex(ValueError,'未加载'):load_state_into(Tiny(),self.root,'cpu')
    def test_index_traversal_rejected(self):
        (self.root/'model.safetensors.index.json').write_text(json.dumps({'weight_map':{'weight':'../outside.safetensors'}}))
        with self.assertRaisesRegex(ValueError,'越界'):load_state_into(Tiny(),self.root,'cpu')
    def test_sharded_index_completeness(self):
        save_file({'weight':self.values['weight']},str(self.root/'first.safetensors'))
        save_file({'bias':self.values['bias']},str(self.root/'second.safetensors'))
        (self.root/'model.safetensors.index.json').write_text(json.dumps({'weight_map':{'weight':'first.safetensors','bias':'second.safetensors'}}))
        model=load_state_into(Tiny(),self.root,'cpu')
        self.assertTrue(torch.equal(model.weight,self.values['weight']))
        self.assertTrue(torch.equal(model.bias,self.values['bias']))

if __name__=='__main__':unittest.main(verbosity=2)
