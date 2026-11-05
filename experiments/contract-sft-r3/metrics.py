"""Identical extraction scoring for baseline and adapters; no legal risk accuracy claim."""
import collections,json,math,random,re
def parse(raw,strip_fence=False):
 if not isinstance(raw,str):return None
 text=raw.strip()
 if strip_fence:
  m=re.fullmatch(r'\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60',text)
  if m:text=m.group(1)
 try:value=json.loads(text)
 except Exception:return None
 if not isinstance(value,dict) or set(value)!={'answers'} or not isinstance(value['answers'],list) or any(not isinstance(s,str) or not s for s in value['answers']):return None
 if len(value['answers'])!=len(set(value['answers'])):return None
 return value['answers']
def f1(gold,predicted):
 if predicted is None:return 0.
 g,p=set(gold),set(predicted)
 if not g and not p:return 1.
 n=len(g&p)
 return 2*n/(len(g)+len(p)) if g or p else 0.
def aggregate(data):
 valid=sum(x['predicted'] is not None for x in data)
 total_answers=sum(len(x['predicted'] or []) for x in data)
 invalid_quotes=sum(sum(a not in x['context'] for a in (x['predicted'] or [])) for x in data)
 negatives=[x for x in data if not x['answers']]
 positives=[x for x in data if x['answers']]
 return {'n':len(data),'documents':len({x['document_id'] for x in data}),'groups':len({x['group'] for x in data}),'responses':sum(x.get('raw') is not None for x in data),'valid_schema':valid,'schema_rate':valid/len(data) if data else None,'exact_match':sum(x['predicted'] is not None and set(x['predicted'])==set(x['answers']) for x in data)/len(data) if data else None,'mean_answer_set_f1':sum(f1(x['answers'],x['predicted']) for x in data)/len(data) if data else None,'returned_answers':total_answers,'unsupported_answers':invalid_quotes,'raw_quote_valid_rate':1-invalid_quotes/total_answers if total_answers else None,'reference_empty_cases':len(negatives),'false_fill_on_empty':sum(x['predicted'] is not None and bool(x['predicted']) for x in negatives)/len(negatives) if negatives else None,'reference_nonempty_cases':len(positives),'miss_or_invalid_on_nonempty':sum(not x['predicted'] for x in positives)/len(positives) if positives else None}
def score(rows,predictions):
 byid={r['id']:r for r in predictions}
 data=[{**r,**{k:byid.get(r['id'],{}).get(k) for k in ['raw','seconds']},'predicted':parse(byid.get(r['id'],{}).get('raw'))} for r in rows]
 bycorpus={c:aggregate([x for x in data if x['corpus']==c]) for c in sorted({x['corpus'] for x in data})}
 fields={c:aggregate([x for x in data if x['corpus']=='zh_synthetic' and x['query_type']==c]) for c in sorted({x['query_type'] for x in data if x['corpus']=='zh_synthetic'})}
 forbidden=[x for x in data if x['corpus']=='zh_synthetic' and x['query_type']=='exception' and not x['source']['exception_permitted']]
 pairs=collections.defaultdict(list)
 for x in data:
  if x['corpus']=='zh_synthetic' and x['query_type']=='exception':pairs[x['source']['pair_id']].append(x)
 complete=[v for v in pairs.values() if len(v)==2]
 cf_correct=sum(all(x['predicted'] is not None and set(x['predicted'])==set(x['answers']) for x in pair) for pair in complete)
 normalized=[{**x,'predicted':parse(x['raw'],True)} for x in data]
 return {'overall':aggregate(data),'by_corpus':bycorpus,'zh_fields':fields,'forbidden_exception_cases':len(forbidden),'forbidden_exception_false_fill_rate':sum(bool(x['predicted']) for x in forbidden)/len(forbidden) if forbidden else None,'complete_counterfactual_pairs':len(complete),'counterfactual_pair_exact_rate':cf_correct/len(complete) if complete else None,'normalized_fence_only':aggregate(normalized),'warning':'Raw semantic, format, source-copy validity and missing-input scope are separate. Synthetic Chinese is a constructed oracle; English references are original human span annotations for bounded windows.'}
def cluster_interval(rows,predictions,corpus,draws=1000):
 pred={x['id']:x for x in predictions};groups=collections.defaultdict(list)
 for r in rows:
  if r['corpus']==corpus:
   p=parse(pred.get(r['id'],{}).get('raw'));groups[r['group']].append(float(p is not None and set(p)==set(r['answers'])))
 names=sorted(groups);rng=random.Random(61105);values=[]
 for _ in range(draws):
  sample=[rng.choice(names) for _ in names];flat=[v for n in sample for v in groups[n]];values.append(sum(flat)/len(flat))
 values.sort()
 return {'metric':'case exact match, resampled by document (English) or template family (Chinese)','groups':len(names),'bootstrap_draws':draws,'lower95':values[int(.025*draws)],'upper95':values[min(draws-1,int(.975*draws))],'caution':'Few synthetic template clusters, artificial class sampling, and curated short windows limit inference beyond this benchmark.'}
