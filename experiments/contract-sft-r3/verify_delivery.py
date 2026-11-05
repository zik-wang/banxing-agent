"""Independent arithmetic/readback of the finished experiment, not independent QA."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path

def read(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(root):
 checks=[]
 def check(name,condition):
  checks.append({'name':name,'passed':bool(condition)})
  if not condition:raise AssertionError(name)
 data=rows(root/'test.jsonl');result=read(root/'final-results.json');seal=read(root/'selection-seal.json');freeze=read(root/'training-code-freeze.json')
 for s,h in freeze['datasets'].items():check('frozen_'+s,sha(root/(s+'.jsonl'))==h)
 for name,h in freeze['code_sha256'].items():check('executed_'+name,sha(root/'executed-code'/name)==h)
 check('frozen_protocol',sha(root/'experiment-protocol.json')==freeze['protocol_sha256'])
 check('frozen_decision_ledger',sha(root/'data-decisions.jsonl')==freeze['data_decisions_sha256'])
 check('frozen_quality_checks',sha(root/'quality-checks.json')==freeze['quality_checks_sha256'])
 check('seal_before_test_write',datetime.fromisoformat(seal['at']).timestamp()<= (root/'test-baseline.jsonl').stat().st_mtime)
 raw_counts={}
 for arm in ['baseline','small300','full1200']:
  outputs=rows(root/f'test-{arm}.jsonl');byid={p['id']:p for p in outputs}
  check(arm+'_exact_output_ids',len(outputs)==len(byid)==len(data) and set(byid)=={r['id'] for r in data})
  counts={c:{'n':0,'correct':0,'schema':0,'quote_count':0,'bad_quotes':0} for c in ['zh_synthetic','cuad_human_reference']}
  for r in data:
   p=byid[r['id']];v=None
   try:
    candidate=json.loads(p['raw'].strip())
    if isinstance(candidate,dict) and set(candidate)=={'answers'}:
     a=candidate['answers']
     if isinstance(a,list) and all(isinstance(x,str) and x for x in a) and len(a)==len(set(a)):v=a
   except (ValueError,TypeError):pass
   c=counts[r['corpus']];c['n']+=1;c['schema']+=int(v is not None);c['correct']+=int(v is not None and set(v)==set(r['answers']))
   c['quote_count']+=len(v or []);c['bad_quotes']+=sum(x not in r['context'] for x in (v or []))
   expected=hashlib.sha256(json.dumps(r['messages'][:-1],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
   check(arm+'_input_'+r['id'],p['input_sha256']==expected and p['context_sha256']==r['context_sha256'])
  for corpus,c in counts.items():
   expected=result['results'][arm]['by_corpus'][corpus]
   check(arm+'_'+corpus+'_exact',c['correct']/c['n']==expected['exact_match'])
   check(arm+'_'+corpus+'_schema',c['schema']==expected['valid_schema'])
   check(arm+'_'+corpus+'_quotes',c['quote_count']==expected['returned_answers'] and c['bad_quotes']==expected['unsupported_answers'])
  raw_counts[arm]=counts
  if arm!='baseline':
   selected=seal['selected'][arm];logs=rows(root/arm/'training-log.jsonl');selection=read(root/arm/'selected-checkpoint.json')
   check(arm+'_selected_matches_seal',selected==selection)
   check(arm+'_adapter_hash',sha(Path(selection['path'])/'adapter_model.safetensors')==selection['sha256'])
   train=rows(root/('train_small.jsonl' if arm=='small300' else 'train.jsonl'));ids=[m['id'] for step in logs if step['step']<=selection['step'] for m in step['sample_trace']]
   check(arm+'_all_rows_seen_at_selection',set(ids)=={r['id'] for r in train})
   check(arm+'_four_microbatches',all(len(step['sample_trace'])==4 for step in logs))
   check(arm+'_step_loss_mean',all(abs(step['loss']-sum(m['loss'] for m in step['sample_trace'])/4)<1e-12 for step in logs))
 page=(root/'系统SFT实验报告.html').read_text(encoding='utf-8')
 check('html_has_embedded_actual_png','data:image/png;base64,' in page)
 check('html_no_external_media',not re.findall(r'(?:src|href)=[\"\'](?:https?://|file:)',page))
 check('png_signature',(root/'loss-curves.png').read_bytes()[:8]==b'\x89PNG\r\n\x1a\n')
 receipt={'at':datetime.now(timezone.utc).isoformat(),'description':'Second deterministic readback, not independent human QA or legal acceptance','passed':len(checks),'failed':0,'checks':checks,'independent_raw_counts':raw_counts,'model_requests_added':0}
 (root/'delivery-readback.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 paths=['experiment-protocol.json','training-code-freeze.json','data-summary.json','data-audit/summary.json','data-audit/value-overlap.json','quality-checks.json','final-results.json','report-data.json','sanitized-summary.json','field-results.json','format-diagnostic.json','reference-ambiguity-audit.json','error-analysis.json','delivery-readback.json','protocol-tests-captured.log','diagnostic-tests.log','dependency-versions.json','runtime-details.json','完整SFT过程与质量报告.md','系统SFT实验报告.html','loss-curves.png','loss-curves.svg']
 manifest={'at':receipt['at'],'files':[{'path':name,'bytes':(root/name).stat().st_size,'sha256':sha(root/name)} for name in paths],'model_weights_excluded_from_git':True,'production_unchanged':True,'not_user_acceptance':True}
 (root/'delivery-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'passed':len(checks),'failed':0,'raw_counts':raw_counts},ensure_ascii=True))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);verify(p.parse_args().root)
