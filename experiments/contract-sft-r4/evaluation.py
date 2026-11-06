"""Frozen common scoring. Syntax validity, semantic span matching and abstention differ."""
import collections,json,random,re

def decode(raw):
 if not isinstance(raw,str):return None,False,'missing'
 text=raw.strip();fence=re.fullmatch(r'\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60',text)
 if fence:text=fence.group(1)
 try:value=json.loads(text)
 except (ValueError,TypeError):return None,False,'invalid_json'
 required=isinstance(value,dict) and set(value)=={'answers'}
 if required:answers=value['answers']
 elif isinstance(value,list):answers=value
 else:return None,False,'invalid_schema'
 if not isinstance(answers,list) or any(not isinstance(a,str) or not a for a in answers) or len(answers)!=len(set(answers)):return None,False,'invalid_values'
 return answers,required and not bool(fence),('fenced_' if fence else '')+('object' if required else 'array')

def evaluate(data,predictions):
 byid={p['id']:p for p in predictions}
 if len(byid)!=len(predictions):raise ValueError('DUPLICATE_PREDICTION_ID')
 if set(byid)-{r['id'] for r in data}:raise ValueError('UNKNOWN_PREDICTION_ID')
 stats=collections.Counter();cases=[]
 for r in data:
  p=byid.get(r['id'],{});a,strict,kind=decode(p.get('raw'));valid=a is not None;gold=set(r['answers']);pred=set(a or []);tp=len(pred&gold)
  correct=valid and pred==gold
  stats['n']+=1;stats['valid']+=valid;stats['strict']+=strict;stats['correct']+=correct;stats['tp']+=tp;stats['fp']+=len(pred-gold);stats['fn']+=len(gold-pred)
  stats['predicted_spans']+=len(pred);stats['unsupported_spans']+=sum(v not in r['context'] for v in pred)
  stats['empty_n']+=not bool(gold);stats['nonempty_n']+=bool(gold)
  if not gold:stats['empty_invalid']+=not valid;stats['empty_false_fill']+=valid and bool(pred)
  cases.append({'id':r['id'],'document_id':r['document_id'],'field':r['query_type'],'exact':correct,'valid':valid,'strict':strict,'kind':kind,'gold':r['answers'],'predicted':a})
 n=stats['n'];den=2*stats['tp']+stats['fp']+stats['fn']
 return {'counts':dict(stats),'exact_match':stats['correct']/n if n else None,'schema_compatible_rate':stats['valid']/n if n else None,'strict_required_object_rate':stats['strict']/n if n else None,'micro_span_precision':stats['tp']/(stats['tp']+stats['fp']) if stats['tp']+stats['fp'] else None,'micro_span_recall':stats['tp']/(stats['tp']+stats['fn']) if stats['tp']+stats['fn'] else None,'micro_span_f1':2*stats['tp']/den if den else None,'unsupported_rate':stats['unsupported_spans']/stats['predicted_spans'] if stats['predicted_spans'] else None,'empty_false_fill_rate':stats['empty_false_fill']/stats['empty_n'] if stats['empty_n'] else None,'empty_invalid_rate':stats['empty_invalid']/stats['empty_n'] if stats['empty_n'] else None,'cases':cases}

def paired_interval(base,tuned,draws=2000):
 a={r['id']:r for r in base['cases']};b={r['id']:r for r in tuned['cases']}
 if set(a)!=set(b):raise ValueError('UNPAIRED_CASES')
 groups=collections.defaultdict(list)
 for key in a:groups[a[key]['document_id']].append(int(b[key]['exact'])-int(a[key]['exact']))
 names=sorted(groups);rng=random.Random(61106);samples=[]
 for _ in range(draws):
  values=[v for name in rng.choices(names,k=len(names)) for v in groups[name]];samples.append(sum(values)/len(values))
 samples.sort()
 return {'delta':sum(int(b[k]['exact'])-int(a[k]['exact']) for k in a)/len(a),'lower95':samples[int(.025*draws)],'upper95':samples[int(.975*draws)],'document_clusters':len(names),'draws':draws,'interpretation':'Paired document bootstrap; not general legal accuracy or training-population certainty.'}
