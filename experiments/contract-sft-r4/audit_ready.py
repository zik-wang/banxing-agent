"""Independent source/split/hash readback before any new training starts."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def audit(root,cuad,old):
 if (root/'events.jsonl').exists():raise ValueError('PRETRAIN_AUDIT_CALLED_AFTER_EXECUTION_STARTED')
 f=read(root/'freeze.json');checks=[]
 def check(name,value):
  checks.append({'name':name,'passed':bool(value)})
  if not value:raise ValueError(name)
 for name,h in f['files'].items():check('file:'+name,sha(root/name)==h)
 for name,h in f['code'].items():check('executed_code:'+name,sha(root/'executed-code'/name)==h)
 data={s:rows(root/(s+'.jsonl')) for s in ['train','dev','test']};source={d['title']:d for d in read(cuad/'CUADv1.json')['data']}
 source_hash=sha(cuad/'CUADv1.json')
 for split,items in data.items():
  check(split+'_unique_ids',len({r['id'] for r in items})==len(items))
  for r in items:
   s=r['source'];doc=source[r['document_id']]
   if len(doc['paragraphs'])!=1:raise ValueError('PARAGRAPH_SCOPE_NOT_SUPPORTED')
   para=doc['paragraphs'][0];q=next(q for q in para['qas'] if q['id']==s['qa_id']);original=para['context'];answers=[]
   for a in sorted(q['answers'],key=lambda x:x['answer_start']):
    start=a['answer_start'];end=start+len(a['text'])
    if original[start:end]!=a['text']:raise ValueError('UPSTREAM_SPAN_MISMATCH')
    if s['start']<=start and end<=s['end'] and a['text'] not in answers:answers.append(a['text'])
   if answers!=r['answers'] or original[s['start']:s['end']]!=r['context'] or source_hash!=s['file_sha256']:raise ValueError('HUMAN_SOURCE_NOT_RECONSTRUCTIBLE')
   actual=hashlib.sha256(json.dumps(r['messages'][:-1],ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()
   if actual!=r['input_sha256'] or r['full_tokens']>768:raise ValueError('INPUT_HASH_OR_LIMIT')
   if json.loads(r['messages'][-1]['content'])!={'answers':answers}:raise ValueError('TARGET_LABEL_CHANGED')
  check(split+'_all_original_human_span_answers_rebuilt',True)
 for a,b in [('train','dev'),('train','test'),('dev','test')]:
  check(a+'_'+b+'_document_disjoint',not {r['document_id'] for r in data[a]}&{r['document_id'] for r in data[b]})
  norm=lambda r:re.sub(r'\s+',' ',r['query_type']+'|'+r['context']).casefold()
  check(a+'_'+b+'_normalized_inputs_disjoint',not {norm(r) for r in data[a]}&{norm(r) for r in data[b]})
 old_docs={r['document_id'] for split in ['train','dev','test'] for r in rows(old/(split+'.jsonl')) if r['corpus']=='cuad_human_reference'}
 check('test_docs_absent_all_previous_model_splits',not {r['document_id'] for r in data['test']}&old_docs)
 docs={r['document_id'] for r in data['test']};check('fresh_test_54_documents',len(docs)==54)
 check('each_fresh_document_has_one_nonempty_one_empty',all(sorted(bool(r['answers']) for r in data['test'] if r['document_id']==d)==[False,True] for d in docs))
 check('fixed_three_seed_protocol',read(root/'protocol.json')['seeds']==[61106,61107,61108] and read(root/'protocol.json')['fixed_optimizer_steps']==300)
 report={'at':datetime.now(timezone.utc).isoformat(),'freeze_sha256':sha(root/'freeze.json'),'passed':len(checks),'failed':0,'checks':checks,'target_rows_checked':sum(map(len,data.values())),'reference_authority':'Inherited original CUAD lawyer-supervised spans, not new project human adjudication','always_empty_test_reference':sum(not r['answers'] for r in data['test'])/len(data['test']),'eligible_scope':'Public English excerpt evidence benchmark only; no Chinese risk or business release eligibility','training_started_before_this_audit':False}
 (root/'preflight-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'passed':len(checks),'rows':report['target_rows_checked'],'all_empty_baseline':report['always_empty_test_reference']}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--cuad',type=Path,required=True);p.add_argument('--old',type=Path,required=True);a=p.parse_args();audit(a.root,a.cuad,a.old)
