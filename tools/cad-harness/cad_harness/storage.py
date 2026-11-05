import hashlib,json,os
from pathlib import Path
def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path,value):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8');os.replace(tmp,path)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def contained(root,value):
 root=Path(root).resolve();p=(root/value).resolve()
 if not p.is_relative_to(root) or not p.is_file():raise ValueError('source path leaves job or does not exist: '+value)
 return p
def freeze(job):
 cfg=read(job/'job.json');paths=[job/'job.json',job/'contract.json']+[contained(job,x) for x in cfg['sources']]
 if cfg.get('seed_plan'):paths.append(contained(job,cfg['seed_plan']))
 return {str(p.relative_to(job)):sha(p) for p in paths}
