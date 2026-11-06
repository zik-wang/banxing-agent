"""Compute vocabulary logits only at supervised next-token positions.

All context still passes through the transformer. This removes only vocabulary
projection/CE rows whose labels are ignored, not context, labels or EOS. Uses the
installed Qwen2/ForCausalLMLoss explicit shift_labels interface, never slices an
already shifted loss a second time. Single unpadded sample, prefix-only masking.
"""
import torch

def supervised_forward(model,inputs):
 labels=inputs['labels']
 if labels.ndim!=2 or labels.shape[0]!=1 or labels.shape!=inputs['input_ids'].shape:
  raise ValueError('SINGLE_UNPADDED_SAMPLE_REQUIRED')
 target=(labels[0]!=-100).nonzero(as_tuple=False).flatten()
 if not len(target) or int(target[0])<1:raise ValueError('SUPERVISED_SUFFIX_WITH_PREFIX_REQUIRED')
 first=int(target[0])
 if len(target)!=labels.shape[1]-first:raise ValueError('NONCONTIGUOUS_SUPERVISED_SUFFIX')
 positions=torch.arange(first-1,labels.shape[1]-1,device=labels.device)
 return model(**inputs,use_cache=False,logits_to_keep=positions,shift_labels=labels[:,first:].contiguous())
