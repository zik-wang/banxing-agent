"""Explicit pre-training code-only amendment; preserve previous freeze and executed code."""
import argparse,hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def seal(root):
 if (root/'events.jsonl').exists():raise RuntimeError('CANNOT_RESEAL_AFTER_EXECUTION')
 old=json.loads((root/'freeze.preflight-v0.json').read_text(encoding='utf-8'))
 for name,h in old['files'].items():
  if sha(root/name)!=h:raise RuntimeError('DATA_OR_PROTOCOL_CHANGED:'+name)
 code=Path(__file__).parent
 for file in code.glob('*.py'):shutil.copyfile(file,root/'executed-code'/file.name)
 extra={name:sha(root/name) for name in ['base-manifest.json','execution-amendment.json'] if (root/name).exists()}
 new={**old,'at':datetime.now(timezone.utc).isoformat(),'files':{**old['files'],**extra},'code':{p.name:sha(p) for p in (root/'executed-code').glob('*.py')},'pretraining_revision':'Add audit/base hash binding and streamed destination-verified tensor loading. No dataset, scoring, base model or hyperparameter changes; previous attempt and frozen inputs retained.'}
 (root/'freeze.json').write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'data_and_protocol_unchanged':True,'files':len(old['files']),'code_files':len(new['code']),'training_started':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);seal(p.parse_args().root)
