import unittest
import torch
from transformers import Qwen2Config,Qwen2ForCausalLM
from peft import LoraConfig,get_peft_model
from causal import causal_mask
from supervised import supervised_forward

class SupervisedEquivalence(unittest.TestCase):
 def test_loss_logits_and_adapter_gradients(self):
  torch.set_num_threads(1)
  for dtype in [torch.float32,torch.bfloat16]:
   torch.manual_seed(61106)
   config=Qwen2Config(vocab_size=89,hidden_size=32,intermediate_size=64,num_hidden_layers=2,num_attention_heads=4,num_key_value_heads=2,attention_dropout=0.,use_cache=False)
   model=Qwen2ForCausalLM(config).to(dtype=dtype);model.set_attn_implementation('eager')
   model=get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=['q_proj','v_proj'],task_type='CAUSAL_LM'));model.eval()
   # Nonzero adapters ensure comparisons exercise both A and B gradients.
   with torch.no_grad():
    for name,p in model.named_parameters():
     if 'lora_B' in name:p.normal_(0,.01)
   for length,first in [(7,3),(19,15),(31,1),(31,30)]:
    ids=torch.randint(0,89,(1,length));labels=ids.clone();labels[:,:first]=-100
    inputs={'input_ids':ids,'labels':labels,'attention_mask':causal_mask(length,'cpu',dtype)}
    model.zero_grad(set_to_none=True);ref=model(**inputs,use_cache=False);ref.loss.backward()
    grads={n:p.grad.clone() for n,p in model.named_parameters() if p.grad is not None}
    model.zero_grad(set_to_none=True);out=supervised_forward(model,inputs);out.loss.backward()
    # The smaller GEMM may select a different accumulation kernel. Same objective
    # is required, not bit identity across differently shaped matmuls.
    torch.testing.assert_close(out.logits,ref.logits[:,first-1:-1],rtol=1e-5,atol=1e-7)
    torch.testing.assert_close(out.loss,ref.loss,rtol=1e-6,atol=1e-6)
    for n,p in model.named_parameters():
     if n in grads:torch.testing.assert_close(p.grad,grads[n],rtol=1e-5,atol=1e-7,msg=n)
    self.assertEqual(out.logits.shape[1],length-first)
 def test_invalid_sparse_mask_or_missing_prefix_rejected(self):
  for labels in [[-100,1,-100,2],[1,2,3],[-100,-100,-100]]:
   ids=torch.ones((1,len(labels)),dtype=torch.long)
   with self.assertRaises(ValueError):supervised_forward(None,{'input_ids':ids,'labels':torch.tensor([labels])})

if __name__=='__main__':unittest.main(verbosity=2)
