"""Offline LoRA clause screener. Reads operator-owned paths, never trains or downloads."""
import os, sys, json, time, struct, math
from pathlib import Path
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
request=json.load(sys.stdin)
output=Path(request['outputFile'])
result={'schemaVersion':1,'status':'starting','rows':[],'limitations':['仅三类条款风险信号；不是事实、法律结论或完整合同审核']}
def save():
    tmp=output.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');os.replace(tmp,output)
save()
try:
    import torch
    from transformers import AutoConfig,AutoModelForCausalLM,AutoTokenizer
    from peft import PeftModel
    root=Path(request['modelRoot']);base=root/'base-model';adapter=root/'adapter'
    if not torch.cuda.is_available():raise RuntimeError('LOCAL_CUDA_UNAVAILABLE')
    config=AutoConfig.from_pretrained(base,local_files_only=True,trust_remote_code=False)
    with torch.device('meta'):model=AutoModelForCausalLM.from_config(config,torch_dtype=torch.bfloat16,attn_implementation='eager',trust_remote_code=False)
    model.to_empty(device='cuda');model.tie_weights();state=model.state_dict()
    with (base/'model.safetensors').open('rb') as stream:
        size=struct.unpack('<Q',stream.read(8))[0]
        if not 0<size<16*1024*1024:raise RuntimeError('INVALID_WEIGHT_HEADER')
        header=json.loads(stream.read(size));header.pop('__metadata__',None);missing=set(state)-set(header)
        if missing-({'lm_head.weight'} if config.tie_word_embeddings else set()) or set(header)-set(state):raise RuntimeError('WEIGHT_KEYS_MISMATCH')
        for key,entry in header.items():
            dtype={'BF16':torch.bfloat16,'F16':torch.float16,'F32':torch.float32}[entry['dtype']];lo,hi=entry['data_offsets'];count=hi-lo
            if list(state[key].shape)!=entry['shape'] or count!=math.prod(entry['shape'])*torch.empty((),dtype=dtype).element_size() or lo<0 or hi+8+size>(base/'model.safetensors').stat().st_size:raise RuntimeError('WEIGHT_RANGE_MISMATCH')
            stream.seek(8+size+lo);buf=bytearray(count)
            if stream.readinto(buf)!=count:raise RuntimeError('SHORT_WEIGHT_READ')
            tensor=torch.frombuffer(buf,dtype=dtype).reshape(entry['shape'])
            with torch.no_grad():state[key].copy_(tensor)
            del tensor,buf
    model.model.rotary_emb=model.model.rotary_emb.__class__(config=config,device=torch.device('cuda'))
    model=PeftModel.from_pretrained(model,adapter,local_files_only=True).eval()
    tokenizer=AutoTokenizer.from_pretrained(base,local_files_only=True,trust_remote_code=False)
    prompt=(root/'inference-prompt.txt').read_text(encoding='utf-8')
    deadline=time.monotonic()+request.get('inferenceSeconds',150)
    result.update(status='running',model='Qwen2.5-1.5B-Instruct+local-LoRA',loaded=True)
    for unit in request['units']:
        if time.monotonic()>=deadline:result['stopReason']='LOCAL_INFERENCE_BUDGET';break
        row={'id':unit['id'],'unitId':unit['unitId'],'start':unit['start'],'end':unit['end'],'status':'not_run'}
        if len(unit['text'])>650:row.update(status='blocked',error='CLAUSE_CHAR_LIMIT')
        else:
            ids=tokenizer.apply_chat_template([{'role':'system','content':prompt},{'role':'user','content':'请初筛以下合同条款：\n'+unit['text']}],tokenize=True,add_generation_prompt=True,return_tensors='pt').to('cuda')
            if ids.shape[1]>1024:row.update(status='blocked',error='CLAUSE_TOKEN_LIMIT')
            else:
                with torch.inference_mode():answer=model.generate(ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=96,pad_token_id=tokenizer.eos_token_id)
                raw=tokenizer.decode(answer[0,ids.shape[1]:],skip_special_tokens=True);row['raw']=raw
                try:
                    value=json.loads(raw);categories=['范围与义务风险','支付与财务风险','责任与救济风险','无']
                    if set(value)!={'risk','category'} or type(value['risk']) is not bool or value['category'] not in categories or (value['risk']==False)!=(value['category']=='无'):raise ValueError('LOCAL_OUTPUT_SCHEMA')
                    row.update(status='candidate_only',signal=value)
                except Exception:row.update(status='invalid_output',error='LOCAL_OUTPUT_SCHEMA')
        result['rows'].append(row);save()
    result['status']='completed' if len(result['rows'])==len(request['units']) else 'partial';save()
except Exception as e:
    result.update(status='failed',error=type(e).__name__+': '+str(e)[:1200]);save()
print(json.dumps({'status':result['status'],'rows':len(result['rows'])},ensure_ascii=False))
