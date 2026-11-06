import unittest
import torch
from transformers import Qwen2Config,Qwen2ForCausalLM
from peft import LoraConfig,get_peft_model,get_peft_model_state_dict
from quantization import quantize_nf4
from supervised import supervised_forward
from causal import causal_mask

@unittest.skipUnless(torch.cuda.is_available(),'CUDA NF4 test requires local CUDA')
class NF4Path(unittest.TestCase):
 def test_tied_head_packed_weights_and_actual_lora_backward(self):
  torch.manual_seed(61106)
  cfg=Qwen2Config(vocab_size=128,hidden_size=64,intermediate_size=128,num_hidden_layers=2,num_attention_heads=4,num_key_value_heads=2,use_cache=False)
  model=Qwen2ForCausalLM(cfg).to(device='cuda',dtype=torch.bfloat16);model.set_attn_implementation('eager')
  head=model.lm_head.weight.detach().clone();report=quantize_nf4(model)
  self.assertEqual(report['quantized_linears'],14);self.assertTrue(torch.equal(head,model.lm_head.weight))
  for name,layer in model.named_modules():
   if name in report['all_packed_weights_and_scales']:
    self.assertEqual(layer.weight.dtype,torch.uint8);self.assertEqual(layer.compute_dtype,torch.bfloat16);self.assertTrue(layer.weight.bnb_quantized)
  for p in model.parameters():p.requires_grad_(False)
  model.enable_input_require_grads();model=get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=['q_proj','v_proj'],task_type='CAUSAL_LM'));model.eval()
  ids=torch.randint(0,128,(1,19),device='cuda');labels=ids.clone();labels[:,:15]=-100
  x={'input_ids':ids,'labels':labels,'attention_mask':causal_mask(19,'cuda')}
  with torch.inference_mode():
   ref=model(**x,use_cache=False);limited=supervised_forward(model,x);torch.testing.assert_close(ref.loss,limited.loss,rtol=1e-5,atol=1e-5)
  model.train();loss=supervised_forward(model,x).loss;loss.backward()
  gradients=[p.grad for p in model.parameters() if p.requires_grad]
  self.assertTrue(gradients and all(g is not None and torch.isfinite(g).all() for g in gradients));self.assertTrue(any(g.abs().sum()>0 for g in gradients))
  self.assertTrue(get_peft_model_state_dict(model))
  with model.disable_adapter():self.assertTrue(torch.isfinite(supervised_forward(model,x).loss))

if __name__=='__main__':unittest.main(verbosity=2)
