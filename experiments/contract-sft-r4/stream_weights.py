"""Bounded CPU-buffer safetensors reader; no whole-file mmap or OS setting changes.
Each copied tensor is hashed back from its destination before being accepted.
"""
import hashlib,json,math,struct
import torch
DTYPES={'BF16':torch.bfloat16,'F16':torch.float16,'F32':torch.float32,'F64':torch.float64,'I64':torch.int64,'I32':torch.int32,'I16':torch.int16,'I8':torch.int8,'U8':torch.uint8,'BOOL':torch.bool}
def tensor_hash(tensor):
 if not tensor.is_contiguous():raise ValueError('NONCONTIGUOUS_DESTINATION')
 view=tensor.detach().reshape(-1).view(torch.uint8);h=hashlib.sha256()
 for i in range(0,view.numel(),16*1024**2):h.update(view[i:i+16*1024**2].cpu().numpy().tobytes())
 return h.hexdigest()
def load_into(path,state,allowed_missing=(),progress=None):
 size=path.stat().st_size;records=[]
 with path.open('rb',buffering=0) as f:
  raw=f.read(8)
  if len(raw)!=8:raise ValueError('TRUNCATED_HEADER')
  n=struct.unpack('<Q',raw)[0]
  if n>16*1024**2 or n+8>size:raise ValueError('INVALID_HEADER_LENGTH')
  metadata=json.loads(f.read(n));data_start=8+n;keys=set(metadata)-{'__metadata__'}
  if keys-set(state) or (set(state)-keys)-set(allowed_missing):raise ValueError('WEIGHT_KEYS')
  for name in keys:
   info=metadata[name];dtype=DTYPES.get(info['dtype']);shape=tuple(info['shape']);a,b=info['data_offsets']
   if dtype is None or shape!=tuple(state[name].shape) or dtype!=state[name].dtype:raise ValueError('WEIGHT_TYPE_OR_SHAPE:'+name)
   if not 0<=a<=b<=size-data_start or b-a!=math.prod(shape)*state[name].element_size():raise ValueError('WEIGHT_OFFSETS:'+name)
   records.append((a,b,name,shape,dtype))
  end=0
  for a,b,*_ in sorted(records):
   if a!=end:raise ValueError('WEIGHT_GAP_OR_OVERLAP')
   end=b
  if end!=size-data_start:raise ValueError('WEIGHT_TRAILING_DATA')
  hashes={};peak=0
  with torch.no_grad():
   for index,(a,b,name,shape,dtype) in enumerate(sorted(records)):
    f.seek(data_start+a);buffer=bytearray(b-a);peak=max(peak,len(buffer));view=memoryview(buffer);read=0
    while read<len(buffer):
     count=f.readinto(view[read:])
     if not count:raise ValueError('TRUNCATED_TENSOR')
     read+=count
    expected=hashlib.sha256(buffer).hexdigest();cpu=torch.frombuffer(buffer,dtype=dtype).reshape(shape);state[name].copy_(cpu)
    del cpu,view,buffer
    actual=tensor_hash(state[name])
    if actual!=expected:raise ValueError('DESTINATION_BYTES_MISMATCH:'+name)
    hashes[name]=actual
    if progress and (index%100==0 or index+1==len(records)):progress(index+1,len(records))
 return {'weights_loaded':len(records),'verified_destination_tensors':len(hashes),'tensor_sha256':hashes,'max_cpu_payload_buffer_bytes':peak,'whole_file_mmap':False}
