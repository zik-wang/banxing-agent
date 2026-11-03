"""Check self-contained delivery bytes against recorded SHA; no model inference."""
import base64, hashlib, json, sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

directory=Path(sys.argv[1]);findings=[]
class Verify(HTMLParser):
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='a' and 'download' in a:
            href=a.get('href','');assert href.startswith('data:application/octet-stream;base64,')
            data=base64.b64decode(href.split(',',1)[1],validate=True)
            actual=hashlib.sha256(data).hexdigest();assert actual==a['data-sha256'],a['download']
            findings.append({'name':a['download'],'sha256':actual,'bytes':len(data),'passed':True})
        if tag in ['img','script','link','iframe']:
            url=a.get('src',a.get('href',''))
            assert not url or url.startswith('data:'),'Not standalone: '+url

Verify().feed((directory/'index.html').read_text(encoding='utf-8'))
result=json.loads((directory/'results.json').read_text(encoding='utf-8'))
assert len(findings)==len(result['downloads'])
signature=lambda x:tuple(x[k] for k in ['name','sha256','bytes'])
assert Counter(map(signature,findings))==Counter(map(signature,result['downloads']))
assert result['inputHashesPreserved']
print(json.dumps({'downloadChecks':len(findings),'passed':len(findings),'inputsPreserved':True,'externalAssets':0}))
