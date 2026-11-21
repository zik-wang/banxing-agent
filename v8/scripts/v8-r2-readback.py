import pathlib,json,openpyxl,hashlib,sys
root=pathlib.Path(sys.argv[1]);results=[]
for case in (root/'run-traces').glob('v8-r2-*'):
 if not (case/'A.xlsx').exists(): continue
 headers=[];source=[]
 for file in [case/'A.xlsx',case/'B.xlsx']:
  rows=list(openpyxl.load_workbook(file,data_only=False).active.values); hs=list(rows[0]);headers+= [h for h in hs if h not in headers];source.append((hs,rows[1:]))
 expected=[headers]+[[row[hs.index(h)] if h in hs else None for h in headers] for hs,rows in source for row in rows]
 for file in sorted(case.glob('run*/outputs/*/*.xlsx')):
  rows=[list(r) for r in openpyxl.load_workbook(file,data_only=False).active.values]
  if rows!=expected: raise AssertionError(str(file)+' differs from independent input-based expected cells')
  if not isinstance(rows[1][1],float) or rows[1][0]!='001' or rows[3][1] is not None: raise AssertionError('type/null/leading zero lost')
  results.append(dict(path=str(file),sha256=hashlib.sha256(file.read_bytes()).hexdigest(),rows=len(rows)-1,columns=len(headers),cellsMatched=True,typesMatched=True))
if not results: raise AssertionError('no actual cross-process artifacts')
(root/'independent-readbacks.json').write_text(json.dumps({'testKind':'deterministic_contract_not_model','outputs':results,'passed':True},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'actualWorkbookViews':len(results),'allCellsMatched':True}))
