import unittest
import torch
from transformers import Qwen2Config,Qwen2ForCausalLM
from causal import causal_mask
class MaskEquivalence(unittest.TestCase):
 def test_mask_shape_and_future_blocking(self):
  m=causal_mask(5,'cpu',torch.float32)[0,0]
  for q in range(5):
   for k in range(5):self.assertEqual(float(m[q,k]),0 if k<=q else torch.finfo(torch.float32).min)
 def test_reference_qwen_logits_loss_and_gradients_identical(self):
  torch.set_num_threads(1)
  for dtype in [torch.float32,torch.bfloat16]:
   torch.manual_seed(61106);config=Qwen2Config(vocab_size=67,hidden_size=32,intermediate_size=64,num_hidden_layers=2,num_attention_heads=4,num_key_value_heads=2,attention_dropout=0.,use_cache=False)
   model=Qwen2ForCausalLM(config).to(dtype=dtype);model.set_attn_implementation('eager');model.train()
   for length in [7,19]:
    ids=torch.randint(0,67,(1,length));labels=ids.clone();labels[:,:3]=-100
    model.zero_grad(set_to_none=True);a=model(input_ids=ids,attention_mask=torch.ones_like(ids),labels=labels,use_cache=False);a.loss.backward();gradients={n:p.grad.clone() for n,p in model.named_parameters() if p.grad is not None}
    model.zero_grad(set_to_none=True);b=model(input_ids=ids,attention_mask=causal_mask(length,'cpu',dtype),labels=labels,use_cache=False);b.loss.backward()
    self.assertTrue(torch.equal(a.logits,b.logits));self.assertTrue(torch.equal(a.loss,b.loss))
    for n,p in model.named_parameters():
     if n in gradients:self.assertTrue(torch.equal(gradients[n],p.grad),n)
 def test_resource_gate_is_readonly_and_blocks_low_capacity(self):
  from resources import require_capacity
  with self.assertRaisesRegex(RuntimeError,'PREFLIGHT_BLOCKED'):require_capacity({'windows':True,'available_commit':1,'available_physical':1})
if __name__=='__main__':unittest.main(verbosity=2)
