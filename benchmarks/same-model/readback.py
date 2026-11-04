"""Independent file readback. Source/patch files are parsed as data, never executed."""
import ast, csv, hashlib, json, re, sys
from pathlib import Path

root=Path(sys.argv[1]).resolve()
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read_file(p):
    result={'name':p.name,'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}
    suffix=p.suffix.lower()
    try:
        if suffix=='.xlsx':
            import openpyxl
            book=openpyxl.load_workbook(p,data_only=False)
            result['sheets']=[{'name':s.title,'rows':[[c.value for c in row] for row in s],'types':[[c.data_type for c in row] for row in s]} for s in book]
        elif suffix=='.docx':
            from docx import Document
            d=Document(p);result['paragraphs']=[x.text for x in d.paragraphs];result['tables']=[[[c.text for c in r.cells] for r in t.rows] for t in d.tables]
        elif suffix=='.pdf':
            from pypdf import PdfReader
            d=PdfReader(p);result['pages']=[x.extract_text() for x in d.pages]
        elif suffix in ['.md','.txt','.csv','.tsv','.py','.patch','.diff','.json']:
            result['text']=p.read_text(encoding='utf-8-sig')
            if suffix in ['.csv','.tsv']:result['rows']=list(csv.reader(result['text'].splitlines(),delimiter='\t' if suffix=='.tsv' else ','))
            if suffix=='.py':
                tree=ast.parse(result['text']);result['staticSyntaxValid']=True
                result['openCalls']=[{'line':n.lineno,'function':ast.unparse(n.func),'args':[ast.unparse(a) for a in n.args],'keywords':{k.arg:ast.unparse(k.value) for k in n.keywords}} for n in ast.walk(tree) if isinstance(n,ast.Call) and (isinstance(n.func,ast.Name) and n.func.id=='open' or isinstance(n.func,ast.Attribute) and n.func.attr=='open')]
        else:result['contentReadback']='unsupported binary; metadata only'
    except Exception as e: result['readError']=type(e).__name__+': '+str(e)
    return result

out={'kind':'DEVELOPER_FILE_READBACK_NOT_INDEPENDENT_HUMAN_GOLD','inputs':[],'runs':[]}
for case in manifest['cases']:
    for item in case['inputs']:
        p=Path(item['source']);copies={f:root/f/('s'+case['id'])/'inputs'/item['name'] for f in ['harness','codex']}
        out['inputs'].append({'case':case['id'],'name':item['name'],'originalShaMatches':sha(p)==item['sha256'],'sha256':sha(p),'copiesUnchanged':{f:q.exists() and sha(q)==item['sha256'] for f,q in copies.items()}})
    for framework in ['harness','codex']:
        folder=root/framework/('s'+case['id']);artifacts=[];intermediates=[]
        if framework=='harness':
            registry=folder/'run/artifacts.json'
            if registry.exists():
                for a in json.loads(registry.read_text(encoding='utf-8')):
                    p=Path(a['path'])
                    artifacts.append({**read_file(p),'artifactId':a['artifactId'],'registryHashMatches':sha(p)==a['sha256'],'patchBaseSha256':a.get('patchBaseSha256'),'beforeSpan':a.get('beforeSpan')})
        elif (folder/'outputs').exists():
            for p in sorted((folder/'outputs').rglob('*')):
                if not p.is_file(): continue
                record=read_file(p)
                if any(part in {'_work','tmp','temp','.cache'} for part in p.relative_to(folder/'outputs').parts[:-1]):
                    record['role']='supporting_intermediate_not_counted_as_delivery';intermediates.append(record)
                else:
                    record['role']='delivery_candidate_requires_content_review';artifacts.append(record)
        final=folder/'final-answer.txt'
        r={'case':case['id'],'framework':framework,'artifacts':artifacts,'intermediateFiles':intermediates,'finalAnswer':final.read_text(encoding='utf-8') if final.exists() else None}
        if framework=='harness':
            settlement=folder/'run/delivery-settlement.json'
            if settlement.exists():r['finalAnswer']=json.loads(settlement.read_text(encoding='utf-8')).get('answer')
        if case['id']=='19':
            original=next(Path(x['source']) for x in case['inputs'] if x['name'].endswith('.py'));source=original.read_text(encoding='utf-8');source_bytes=original.read_bytes()
            for a in artifacts:
                if a['name'].endswith('.py') and 'text' in a:
                    old=source.splitlines();new=a['text'].splitlines();changed=[i+1 for i in range(min(len(old),len(new))) if old[i]!=new[i]]
                    a['patchCheck']={'originalLines':len(old),'newLines':len(new),'changedLines':changed,'onlyOneLineChanged':len(old)==len(new) and len(changed)==1,'originalUnchanged':hashlib.sha256(source_bytes).hexdigest()==next(x['sha256'] for x in case['inputs'] if x['name'].endswith('.py')),'utf8OpenCalls':[c for c in a.get('openCalls',[]) if 'utf-8' in c['keywords'].get('encoding','')],'readbackExecutesUploadedSource':False,'agentExecutionAudit':'review actual tool trace separately'}
                    if a.get('beforeSpan'):
                        span=a['beforeSpan'];before=source[span['start']:span['end']];a['patchCheck']['before']=before;a['patchCheck']['beforeOccurrences']=source.count(before)
        out['runs'].append(r)

pdf=next(Path(i['source']) for c in manifest['cases'] if c['id']=='15' for i in c['inputs'])
from pypdf import PdfReader
pdf_pages=[p.extract_text() for p in PdfReader(pdf).pages]
raw='\n'.join(pdf_pages)
out['expirySource']={'pages':len(pdf_pages),'rawText':raw,'records':[]}
for match in re.finditer(r'Application type:\s*([^\n]+)\s*Application supplier:\s*([^\n]+)\s*Contract expiry date:\s*([^\n]+)',raw):
    preceding=[x.strip() for x in raw[:match.start()].splitlines() if x.strip()]
    out['expirySource']['records'].append({'heading':preceding[-1] if preceding else None,'application':match[1].strip(),'applicationSupplier':match[2].strip(),'expiryLiteral':match[3].strip()})
release=next(Path(i['source']) for c in manifest['cases'] if c['id']=='11' for i in c['inputs'])
out['releaseSource']=[{'tag':r['tag_name'],'publishedAt':r['published_at'],'draft':r['draft'],'prerelease':r['prerelease'],'body':r['body']} for r in json.loads(release.read_text(encoding='utf-8'))]
(root/'readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print(json.dumps({'inputsPreserved':all(x['originalShaMatches'] for x in out['inputs']),'sourceExpiryRecords':len(out['expirySource']['records']),'runs':[{'case':r['case'],'framework':r['framework'],'artifacts':len(r['artifacts'])} for r in out['runs']]}))
