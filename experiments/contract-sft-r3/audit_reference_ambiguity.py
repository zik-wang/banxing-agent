"""POST-TEST reference audit. Flags underspecified questions, never relabels/drops.
Payment prerequisites and explicit withholding exceptions can overlap in meaning.
The constructed oracle tracks one clause slot, but the question did not clearly
exclude the other concept. Do not call all nonempty predictions negation errors.
"""
import argparse,json
from datetime import datetime,timezone
from pathlib import Path
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def audit(root):
 flagged=[];counts={}
 for split in ['train','dev','test']:
  data=rows(root/(split+'.jsonl'));condition={r['document_id']:r['answers'] for r in data if r['corpus']=='zh_synthetic' and r['query_type']=='condition'}
  exception=[r for r in data if r['corpus']=='zh_synthetic' and r['query_type']=='exception'];risk=[]
  for r in exception:
   if condition.get(r['document_id']):
    risk.append(r);flagged.append({'id':r['id'],'split':split,'kind':'PREREQUISITE_VS_WITHHOLDING_SCOPE_UNDERSPECIFIED','condition_values':condition[r['document_id']],'constructed_exception_answer':r['answers'],'exception_permitted':r['source']['exception_permitted'],'reason':'Question asks permission to withhold; a separate payment prerequisite can also justify nonpayment. Intended slot-only exclusion was not explicit. Requires task-definition/human adjudication; not automatically relabelled.'})
  counts[split]={'exception_qas':len(exception),'potentially_ambiguous':len(risk),'forbidden_subset_with_prerequisite':sum(not r['source']['exception_permitted'] for r in risk)}
 test=rows(root/'test.jsonl');byid={r['id']:r for r in test};condition={r['document_id']:r['answers'] for r in test if r['corpus']=='zh_synthetic' and r['query_type']=='condition'}
 predictions=rows(root/'test-full1200.jsonl');findings=[]
 for p in predictions:
  r=byid[p['id']]
  if r['corpus']!='zh_synthetic' or r['query_type']!='exception' or r['answers']:continue
  value=json.loads(p['raw'])['answers']
  if value:
   findings.append({'id':r['id'],'constructed_reference':r['answers'],'actual':value,'context':r['context'],'quotes_are_source_bound':all(v in r['context'] for v in value),'alternative_prerequisite_core_present':all(any(c in v for c in condition.get(r['document_id'],[])) for v in value),'assessment':'Nonempty against constructed oracle; alternative payment-prerequisite evidence, not proof of negation inversion.'})
 original=json.loads((root/'final-results.json').read_text(encoding='utf-8'))['results']['full1200']
 assert len(findings)==round(original['forbidden_exception_false_fill_rate']*original['forbidden_exception_cases'])
 out={'at':datetime.now(timezone.utc).isoformat(),'stage':'POST_TEST_DATA_QA_NOT_PREREGISTERED','no_frozen_data_or_scores_modified':True,'counts':counts,'flagged_reference_rows':flagged,'full_arm_forbidden_nonempty':findings,'all_nonempty_are_alternative_prerequisites':all(x['alternative_prerequisite_core_present'] for x in findings),'decision':'Do not interpret this primary counter as established legal/negation mistakes. Preserve primary scores, mark reference ambiguity; no exclusion/retraining/rescoring to improve this run. Refine scope and independently adjudicate new data before another experiment.'}
 (root/'reference-ambiguity-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'counts':counts,'nonempty_cases':len(findings),'alternative_prerequisite_cases':sum(x['alternative_prerequisite_core_present'] for x in findings)}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);audit(p.parse_args().root)
