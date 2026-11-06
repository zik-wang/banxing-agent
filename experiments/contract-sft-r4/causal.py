"""Equivalent explicit mask for one unpadded, unpacked training example, no KV cache."""
import torch
def causal_mask(length,device,dtype=torch.bfloat16):
 if not isinstance(length,int) or length<1:raise ValueError('INVALID_SEQUENCE_LENGTH')
 return torch.triu(torch.full((1,1,length,length),torch.finfo(dtype).min,device=device,dtype=dtype),diagonal=1)
