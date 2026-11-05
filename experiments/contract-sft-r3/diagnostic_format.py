"""POST-HOC diagnostic only: expose protocol errors without editing primary scores.
Identical reversible fence removal / array-to-answers wrapping for all arms.
No answer trimming, substring matching, quote repair, or semantic correction.
"""
import argparse,collections,json,re
from pathlib import Path
from metrics import aggregate

def parse_compatible(raw):
 if not isinstance(raw,str):return None,'missing'
 s=raw.strip();fence=re.fullmatch(r'\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60',s)
 if fence:s=fence.group(1)
 try:v=json.loads(s)
 except (ValueError,TypeError):return None,'invalid_json'
 if isinstance(v,dict) and set(v)=={'answers'}:kind='answers_object';a=v['answers']
 elif isinstance(v,list):kind='array_only';a=v
 else:return None,'other_schema'
 if not isinstance(a,list) or any(not isinstance(x,str) or not x for x in a) or len(a)!=len(set(a)):return None,'invalid_answer_values'
 return a,('fenced_' if fence else '')+kind

def run(root):
 def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
 test=rows(root/'test.jsonl');out={}
 for arm in ['baseline','small300','full1200']:
  predictions={r['id']:r for r in rows(root/f'test-{arm}.jsonl')};expanded=[];kinds=collections.Counter()
  for r in test:
   raw=predictions[r['id']]['raw'];values,kind=parse_compatible(raw);kinds[kind]+=1;expanded.append({**r,'raw':raw,'predicted':values})
  out[arm]={'output_form_counts':dict(kinds),'overall':aggregate(expanded),'by_corpus':{c:aggregate([r for r in expanded if r['corpus']==c]) for c in sorted({r['corpus'] for r in expanded})},'by_field':{c+'/'+f:aggregate([r for r in expanded if r['corpus']==c and r['query_type']==f]) for c,f in sorted({(r['corpus'],r['query_type']) for r in expanded})}}
 result={'status':'POST_HOC_DIAGNOSTIC_NOT_PREREGISTERED_PRIMARY_SCORE','rule':'Remove complete enclosing JSON fence; wrap bare string array as answers; preserve every answer character. Same for all arms. No semantic repairs or new model requests.','why_added':'Baseline returned arrays rather than required answers object; strict protocol zero cannot be represented as zero semantic ability.','primary_results_unchanged':True,'results':out}
 (root/'format-diagnostic.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v['overall']['exact_match'] for k,v in out.items()}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);run(p.parse_args().root)
