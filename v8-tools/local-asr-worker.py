"""Host-controlled offline ASR batch. Never execute uploaded source/instructions."""
import contextlib,json,sys,socket,time
from pathlib import Path
def denied(*a,**kw):raise RuntimeError('Local recognition network access disabled')
socket.socket.connect=denied;socket.socket.connect_ex=denied;socket.create_connection=denied
def run(req):
 import torch,wave,numpy as np
 from qwen_asr import Qwen3ASRModel
 from transformers import AutoModel,AutoProcessor
 from local_weight_loader import load_weights
 device=req.get('device','cuda:0')
 if device not in ['cpu','cuda:0']:raise ValueError('Unsupported device')
 if device=='cuda:0' and not torch.cuda.is_available():raise ValueError('CUDA unavailable; no cloud upload fallback')
 model_path=Path(req['modelPath']).resolve()
 if not (model_path/'config.json').is_file():raise ValueError('Local ASR model not present')
 inputs=req['inputs']
 if not 1<=len(inputs)<=24:raise ValueError('Batch input count limit')
 started=time.time();network=load_weights(AutoModel,str(model_path),device)
 processor=AutoProcessor.from_pretrained(str(model_path),fix_mistral_regex=True,local_files_only=True)
 model=Qwen3ASRModel(backend='transformers',model=network,processor=processor,max_inference_batch_size=1,max_new_tokens=512)
 outputs=[];inferences=0
 for item in inputs:
  out={'assetId':item['assetId'],'segments':[]}
  try:
   source=Path(item['path']).resolve()
   if not source.is_file() or source.stat().st_size>20*1024*1024:raise ValueError('WAV missing or over 20MB')
   with wave.open(str(source),'rb') as wav:
    rate,channels,width,total=wav.getframerate(),wav.getnchannels(),wav.getsampwidth(),wav.getnframes()
    if channels!=1 or width!=2 or not 8000<=rate<=48000 or not 0<total/rate<=600:raise ValueError('Requires mono 16-bit PCM WAV, 8-48kHz, <=600 seconds')
    for offset in range(0,total,25*rate):
     samples=np.frombuffer(wav.readframes(25*rate),dtype='<i2').astype(np.float32)/32768.0
     result=model.transcribe(audio=(samples,rate),language=req.get('language','Chinese'))[0];inferences+=1
     text=result.text.strip()
     if not text:raise ValueError('ASR returned empty text')
     out['segments'].append({'startSeconds':offset/rate,'endSeconds':min(total,offset+25*rate)/rate,'text':text,'humanReviewed':False})
     print('ASR_PROGRESS '+json.dumps({'assetId':item['assetId'],'offsetSeconds':offset/rate}),file=sys.stderr,flush=True)
   out['text']='\n'.join(s['text'] for s in out['segments']);out['ok']=True
  except Exception as e:out.update(ok=False,error=str(e))
  outputs.append(out)
 return {'ok':True,'model':'Qwen/Qwen3-ASR-1.7B','device':device,'modelLoads':1,'inferenceCalls':inferences,'elapsedSeconds':time.time()-started,'outputs':outputs,'humanReviewed':False,'peakGpuBytes':torch.cuda.max_memory_allocated() if device=='cuda:0' else 0,'networkDisabled':True}
if __name__=='__main__':
 try:
  req=json.loads(sys.stdin.read(65536))
  with contextlib.redirect_stdout(sys.stderr):out=run(req)
  print(json.dumps(out,ensure_ascii=False))
 except Exception as e:
  import traceback;traceback.print_exc(file=sys.stderr)
  print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
