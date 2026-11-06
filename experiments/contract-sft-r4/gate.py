"""Bind the pre-training source audit to exactly the frozen dataset/code revision."""
import hashlib,json
def require_preflight(root):
 p=root/'preflight-audit.json'
 if not p.exists():raise ValueError('PREFLIGHT_MISSING')
 audit=json.loads(p.read_text(encoding='utf-8'))
 if audit.get('failed')!=0 or not audit.get('passed') or audit.get('training_started_before_this_audit') is not False:raise ValueError('PREFLIGHT_NOT_PASSED_BEFORE_TRAINING')
 if audit.get('freeze_sha256')!=hashlib.sha256((root/'freeze.json').read_bytes()).hexdigest():raise ValueError('PREFLIGHT_STALE')
 return audit
