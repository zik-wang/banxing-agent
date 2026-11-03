"""Read-only structural probes; paths are assigned by the host, never documents."""
import json,sys,zipfile,csv,io
from pathlib import Path
job=json.load(sys.stdin);p=Path(job['path']);raw=p.read_bytes();ext=p.suffix.lower()
def result(state,kind,blocked=False,detail=''):
    return dict(state=state,actualKind=kind,blocked=blocked,detail=detail,contentVerified=False)
try:
    if raw.startswith(b'%PDF-'):
        import pypdfium2 as pdfium
        try:
            with pdfium.PdfDocument(p) as d: out={**result('valid','pdf'), 'pages':len(d)}
        except Exception as e:
            locked='password' in str(e).lower() or 'encrypt' in str(e).lower()
            out=result('password_required' if locked else 'invalid_pdf','pdf',True)
    elif raw.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
        encrypted=any(s.encode('utf-16le') in raw for s in ['EncryptedPackage','EncryptionInfo'])
        out=result('password_required' if encrypted else 'legacy_office','office',True)
    elif raw.startswith(b'PK'):
        try:
            with zipfile.ZipFile(p) as z:
                entries=z.infolist();names=set(z.namelist())
                if any(e.flag_bits&1 for e in entries):out=result('password_required','zip',True)
                elif sum(e.file_size for e in entries)>150*1024*1024 or len(entries)>20000:out=result('expansion_limit','zip',True)
                elif z.testzip() is not None:out=result('corrupt_container','zip',True,'CRC_CHECK_FAILED')
                elif 'xl/workbook.xml' in names and '[Content_Types].xml' in names:
                    from openpyxl import load_workbook
                    with p.open('rb') as source:
                        book=load_workbook(source,read_only=True,data_only=False);sheets=book.sheetnames;book.close()
                    out={**result('valid','workbook'), 'sheets':sheets}
                elif 'word/document.xml' in names and '[Content_Types].xml' in names:
                    import xml.etree.ElementTree as ET
                    ET.fromstring(z.read('word/document.xml'));out=result('valid','word')
                else:out=result('not_office_container','zip',True)
        except (zipfile.BadZipFile,EOFError):out=result('corrupt_container','zip',True)
        except Exception as e:out=result('unreadable_office_structure','office',True,type(e).__name__)
    elif raw.startswith(b'\x89PNG\r\n\x1a\n') or raw[:2]==b'\xff\xd8':
        from PIL import Image
        with Image.open(p) as im:im.verify()
        out=result('valid','image')
    else:
        recognized=None
        try:
            text=raw.decode('utf-8-sig')
            if '\x00' not in text:
                try:json.loads(text);recognized='json'
                except (ValueError,TypeError):
                    try:
                        dialect=csv.Sniffer().sniff(text[:16000],delimiters=',\t;');rows=list(csv.reader(io.StringIO(text[:16000]),dialect))
                        if len(rows)>1 and len(rows[0])>1 and all(len(row)==len(rows[0]) for row in rows if row):recognized='csv'
                    except csv.Error:pass
        except UnicodeError:pass
        out=result('extension_mismatch' if recognized else 'invalid_container',recognized or 'unknown',True)
    expected={'.xlsx':'workbook','.docx':'word','.pdf':'pdf'}.get(ext)
    if out['state']=='valid' and expected and out['actualKind']!=expected:out={**out,'state':'extension_mismatch','blocked':True}
except Exception as e:out=result('probe_unavailable','unknown',False,type(e).__name__)
json.dump(out,sys.stdout,ensure_ascii=False)
