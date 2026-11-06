"""Explicit alternative NF4 execution. Never called for the BF16 protocol.

Quantize each transformer linear in place, retaining tied embeddings/lm_head and
all norms in BF16. Every original base tensor is verified before this transform.
The quantized baseline and every LoRA arm use this same deterministic transform.
"""
import torch
from stream_weights import tensor_hash

def quantize_nf4(model):
 import bitsandbytes as bnb
 names=[n for n,m in model.named_modules() if isinstance(m,torch.nn.Linear) and n!='lm_head']
 receipts={}
 for name in names:
  old=model.get_submodule(name)
  with torch.device('meta'):
   new=bnb.nn.Linear4bit(old.in_features,old.out_features,bias=old.bias is not None,compute_dtype=torch.bfloat16,compress_statistics=True,quant_type='nf4',quant_storage=torch.uint8)
  new.weight=bnb.nn.Params4bit(old.weight.detach(),requires_grad=False,compress_statistics=True,quant_type='nf4',quant_storage=torch.uint8,module=new).to('cuda')
  if old.bias is not None:new.bias=old.bias
  parent,_,leaf=name.rpartition('.');setattr(model.get_submodule(parent),leaf,new)
  state=new.weight.quant_state.as_dict(packed=False)
  receipts[name]={'packed_sha256':tensor_hash(new.weight.data),'quantization_state':{k:{'sha256':tensor_hash(v.contiguous()),'shape':list(v.shape),'dtype':str(v.dtype)} if torch.is_tensor(v) else str(v) for k,v in state.items()}}
  del old,new,state;torch.cuda.empty_cache()
 model.is_loaded_in_4bit=True;model.quantization_method='bitsandbytes'
 return {'method':'NF4 double quantization, block64, uint8 storage, BF16 compute','bitsandbytes_version':bnb.__version__,'quantized_linears':len(names),'embedding_and_tied_head_dtype':str(model.get_input_embeddings().weight.dtype),'all_packed_weights_and_scales':receipts,'scope':'Alternative quantized baseline; not numerically equivalent to BF16 and never pooled with BF16 benchmark scores.'}
