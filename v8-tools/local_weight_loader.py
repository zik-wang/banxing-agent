"""Load original safetensors through the bytes API, avoiding Windows mmap slices."""
import gc
import json
from pathlib import Path

def load_state_into(model, directory, device):
    import torch
    from safetensors.torch import load
    root=Path(directory).resolve()
    index=root/'model.safetensors.index.json'
    if index.is_file():
        mapping=json.loads(index.read_text(encoding='utf-8'))['weight_map']
        names=sorted(set(mapping.values()))
    else:
        mapping=None
        names=['model.safetensors']
    expected=model.state_dict()
    loaded=set()
    targets=set()
    for name in names:
        source=(root/name).resolve()
        if source.parent!=root or source.suffix!='.safetensors':raise ValueError('权重路径越界')
        # Official bytes deserializer avoids the storage slicing path that
        # produced 0xC0000005 in this machine's mapped checkpoint loader.
        state=load(source.read_bytes())
        renaming=model._get_key_renaming_mapping(list(state),key_mapping=model._checkpoint_conversion_mapping) if hasattr(model,'_get_key_renaming_mapping') else {key:key for key in state}
        renamed={}
        for serialized in list(state):
            key=renaming[serialized]
            value=state[serialized]
            if key in targets or key not in expected:raise ValueError('权重名称重复或不匹配：'+key)
            if mapping is not None and mapping.get(serialized)!=name:raise ValueError('权重与索引不一致：'+key)
            if tuple(value.shape)!=tuple(expected[key].shape):raise ValueError('权重形状不一致：'+key)
            renamed[key]=value.to(device)
            loaded.add(serialized)
            targets.add(key)
        model.load_state_dict(renamed,strict=False,assign=True)
        del state,renamed
        gc.collect()
    if mapping is not None and loaded!=set(mapping):raise ValueError('权重索引未全部加载')
    model.tie_weights()
    missing=[name for name,value in model.state_dict().items() if value.is_meta]
    if missing:raise ValueError('仍有未加载权重：'+','.join(missing[:8]))
    model.to(device)
    model.eval()
    return model

def load_weights(model_class,directory,device):
    import torch
    from accelerate import init_empty_weights
    from transformers import AutoConfig,GenerationConfig
    config=AutoConfig.from_pretrained(directory,local_files_only=True)
    with init_empty_weights():
        if hasattr(model_class,'from_config'):
            model=model_class.from_config(config,dtype=torch.bfloat16)
        else:
            model=model_class(config)
    model=load_state_into(model,directory,device)
    if (Path(directory)/'generation_config.json').is_file():
        model.generation_config=GenerationConfig.from_pretrained(directory,local_files_only=True)
    return model
