"""Post-freeze audit only. Never edits datasets, labels, protocol, or predictions."""
import argparse,collections,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from prepare import CATEGORIES

def load(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def save(p,value):p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def audit(root,cuad,previous,r2):
 target=root/'data-audit';target.mkdir(exist_ok=False)
 questions=[];counts=collections.Counter()
 for doc in load(cuad)['data']:
  for paragraph in doc['paragraphs']:
   for q in paragraph['qas']:
    category=q['id'].split('__')[-1];included=category in CATEGORIES
    counts['in_scope_questions' if included else 'out_of_scope_questions']+=1
    questions.append({'document_id':doc['title'],'qa_id':q['id'],'category':category,'scope':'candidate' if included else 'not_in_this_extractive_task','reason':'Six predefined metadata fields; other legal tasks not learned or scored here. Selection was before training.'})
 (target/'source-question-scope.jsonl').write_text(''.join(json.dumps(q,ensure_ascii=False)+'\n' for q in questions),encoding='utf-8')
 revisions={}
 for split in ['train','train_small','dev','test']:
  old={r['id']:r for r in rows(previous/(split+'.jsonl'))};new={r['id']:r for r in rows(root/(split+'.jsonl'))}
  revisions[split]={'before_rows':len(old),'after_rows':len(new),'identical_ids':len(old.keys()&new.keys()),'removed_ids':sorted(old.keys()-new.keys()),'added_ids':sorted(new.keys()-old.keys()),'reason':'Proportional 300-row subset and genuinely different held-out core wording fixed before training; full 1200 unchanged. Not response-based filtering.'}
 exclusions=[]
 for split in ['train','validation','test']:
  for r in rows(r2/(split+'.jsonl')):
   exclusions.append({'prior_split':split,'prior_id':r.get('id'),'reason':'Old risk/category classification with weak negatives is a different task; old test previously exposed. Excluded regardless of model correctness.'})
 save(target/'r2-scope-exclusions.json',exclusions)
 event_counts=collections.Counter();split_counts=collections.defaultdict(collections.Counter)
 for event in rows(root/'data-decisions.jsonl'):
  key=event['decision']+':'+event['reason'];event_counts[key]+=1;split_counts[event['split']][key]+=1
 samples=[]
 for split in ['train','dev','test']:
  data=rows(root/(split+'.jsonl'))
  for corpus in ['zh_synthetic','cuad_human_reference']:
   for positive in [True,False]:
    pool=[r for r in data if r['corpus']==corpus and bool(r['answers'])==positive]
    if pool:samples.append(pool[0])
 save(target/'sample-examples.json',samples)
 frozen=load(root/'training-code-freeze.json')
 unchanged={s:sha(root/(s+'.jsonl'))==h for s,h in frozen['datasets'].items()}
 assert all(unchanged.values())
 result={'at':datetime.now(timezone.utc).isoformat(),'audit_only_no_training_input_changes':True,'source_file_sha256':sha(cuad),'source_document_count':len(load(cuad)['data']),'source_question_counts':dict(counts),'decision_event_counts':dict(event_counts),'decision_events_by_split':{k:dict(v) for k,v in split_counts.items()},'decision_unit_warning':'Question scope decisions, window-question candidate events, unique final training rows and repeated optimizer presentations are different units. Do not add them together or call all events samples.','revision_before_any_model_result':revisions,'old_r2_exclusions':len(exclusions),'data_hash_unchanged':unchanged,'manual_quality_limit':'Chinese labels constructed and mechanically verified, not independently double-annotated legal gold. CUAD retains original expert-supervised annotations; no fresh human adjudication by this project.','no_online_or_loss_based_data_removal':True,'budget_not_selected_is_not_bad_data':True}
 save(target/'summary.json',result)
 print(json.dumps({'source_question_counts':dict(counts),'events':sum(event_counts.values()),'old_r2_exclusions':len(exclusions),'unchanged':unchanged},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--cuad',type=Path,required=True);p.add_argument('--previous',type=Path,required=True);p.add_argument('--r2',type=Path,required=True);a=p.parse_args();audit(a.root,a.cuad,a.previous,a.r2)
