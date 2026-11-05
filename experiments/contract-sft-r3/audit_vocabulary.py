"""Separate audit of reference-value overlap; does not change any frozen split."""
import argparse,json
from pathlib import Path
def audit(root):
 data={s:[json.loads(x) for x in (root/(s+'.jsonl')).read_text(encoding='utf-8').splitlines() if x] for s in ['train','dev','test']}
 results=[]
 for corpus,field in sorted({(r['corpus'],r['query_type']) for r in data['train']}):
  values={s:{v for r in rows if r['corpus']==corpus and r['query_type']==field for v in r['answers']} for s,rows in data.items()}
  results.append({'corpus':corpus,'field':field,'train_distinct_answers':len(values['train']),'test_distinct_answers':len(values['test']),'test_answer_strings_seen_in_train':len(values['train']&values['test'])})
 out={'purpose':'Vocabulary overlap audit, not a train/test input change. Shared answers are not document leakage but limit novel-value claims.','rows':results}
 (root/'data-audit/value-overlap.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(results,ensure_ascii=True))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);audit(p.parse_args().root)
