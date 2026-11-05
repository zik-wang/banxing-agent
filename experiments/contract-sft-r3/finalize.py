"""Freeze final code/QA before any optimization or test generation."""
import collections,hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
from metrics import parse
ROOT=Path('D:/pro222/pccr-eye-gaze/qa-output/contract-qwen15b-r3-systematic-v1-20261105-worker02')
CODE=Path(__file__).resolve().parent
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
data={s:rows(ROOT/(s+'.jsonl')) for s in ['train','train_small','dev','test']}
protocol=load(ROOT/'experiment-protocol.json')
checks=[]
def check(name,value):checks.append({'check':name,'passed':bool(value)});assert value,name
for split,items in data.items():
 check(split+'_schema',all(parse(r['messages'][-1]['content'])==r['answers'] for r in items))
 check(split+'_spans',all(all(s in r['context'] for s in r['answers']) for r in items))
 check(split+'_limit',all(r['full_tokens']<=768 and r['answer_tokens']<=150 for r in items))
check('small_is_true_subset',{r['id'] for r in data['train_small']}<={r['id'] for r in data['train']})
for a,b in [('train','dev'),('train','test'),('dev','test')]:
 for key in ['document_id','group','context_sha256']:check(a+'_'+b+'_'+key,not {r[key] for r in data[a]}&{r[key] for r in data[b]})
cuad_path=Path('D:/pro222/pccr-eye-gaze/qa-output/contract-finetune-data-scout-20261101/cuad/extracted/CUADv1.json')
original={d['title']:d for d in load(cuad_path)['data']}
for split,items in data.items():
 for r in items:
  if r['corpus']!='cuad_human_reference':continue
  source=r['source'];doc=original[source['document_title']];para=doc['paragraphs'][0];full=para['context'];start,end=source['start'],source['end']
  assert full[start:end]==r['context']
  qa=next(x for x in para['qas'] if x['id']==source['qa_id'])
  answers=list(dict.fromkeys(a['text'] for a in sorted(qa['answers'],key=lambda a:a['answer_start']) if start<=a['answer_start'] and a['answer_start']+len(a['text'])<=end))
  assert answers==r['answers']
check('cuad_independent_span_reconstruction',True)
# Documentation fixes are sealed prior to training and preserve the original builder freeze.
shutil.copyfile(ROOT/'experiment-protocol.json',ROOT/'builder-protocol.v1.json')
protocol['pre_registered_training']['checkpoint_eligibility']='Only checkpoints after seeing every training row at least once; small>=100/full>=300'
protocol['pre_registered_training']['max_arm_training_seconds']=3600;protocol['pre_registered_training']['total_wall_seconds']=10800
protocol['pre_registered_training']['optimizer']='AdamW lr1e-4 betas(0.9,0.999),eps1e-8,weight_decay0.01;clip_grad_norm1.0;constantLR'
protocol['reliability_interpretation']='Passing numeric gates demonstrates only frozen excerpt benchmark criteria. Cluster intervals, limited synthetic families, author annotation limits and absence of new independent Chinese legal review must accompany any statement. No legal-decision reliability claim.'
save(ROOT/'experiment-protocol.json',protocol)
counts={s:{'answer_tokens_without_chat_eos':sum(r['answer_tokens'] for r in v),'full_tokens':sum(r['full_tokens'] for r in v),'max_full_tokens':max(r['full_tokens'] for r in v),'labels_nonempty':sum(bool(r['answers']) for r in v)} for s,v in data.items()}
old=Path('D:/pro222/pccr-eye-gaze/qa-output/contract-qwen15b-r3-systematic-20261105-worker02')
save(ROOT/'dataset-revisions.json',{'before_training':True,'prior_build':str(old),'old_build_preserved':True,'changes':[{'change':'Small300 now proportional by corpus/query/answerability rather than nearly balanced','reason':'Reduce class-prior confound in data-volume comparison','before':{'rows':300,'answerable':150},'after':{'rows':300,'answerable':169}},{'change':'Dev/test use different core condition and negation language from training','reason':'Avoid outer-template-only holdout that leaves core phrase memorization unchecked'},{'change':'Per-document-cap decisions no longer leak from small subset into full train ledger','reason':'A row excluded from the smaller subset may still be included in full data; preserve correct scope'}],'train_hash_identical_v0_v1':sha(old/'train.jsonl')==sha(ROOT/'train.jsonl'),'test_modified_after_model_results':False,'original_r2_rows_excluded':334,'r2_exclusion_reason':'Old risk-category/weak-negative labels do not answer this evidence-extraction task; old test is previously exposed; not filtering by model errors.'})
qa={'at':datetime.now(timezone.utc).isoformat(),'checks':checks,'passed':len(checks),'failed':0,'token_counts':counts,'manual_review_status':'Authored synthetic Chinese + original CUAD human reference. No independent human Chinese legal gold.','training_started':False}
save(ROOT/'quality-checks.json',qa)
(ROOT/'executed-code').mkdir()
for name in ['prepare.py','metrics.py','train.py','test_protocol.py','finalize.py']:shutil.copyfile(CODE/name,ROOT/'executed-code'/name)
save(ROOT/'training-code-freeze.json',{'at':qa['at'],'protocol_sha256':sha(ROOT/'experiment-protocol.json'),'datasets':{s:sha(ROOT/(s+'.jsonl')) for s in data},'code_sha256':{n:sha(CODE/n) for n in ['prepare.py','metrics.py','train.py','test_protocol.py','finalize.py']},'quality_checks_sha256':sha(ROOT/'quality-checks.json'),'data_decisions_sha256':sha(ROOT/'data-decisions.jsonl'),'models_started_before_freeze':False})
print(json.dumps({'status':'DATA_AND_CODE_FROZEN_FOR_TRAINING','checks':len(checks),'tokens':counts,'out':str(ROOT)},ensure_ascii=True))
