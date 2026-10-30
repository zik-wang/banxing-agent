"""Read-only contract evidence parser. OOXML is data; no macros, links or code run."""
import sys,json,hashlib,re,unicodedata,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def normalized(raw):
    text=[];mapping=[]
    for i,c in enumerate(raw):
        for ch in unicodedata.normalize('NFKC',c):
            ch=' ' if ch.isspace() else ch
            if ch==' ' and text and text[-1]==' ':continue
            text.append(ch);mapping.append(i)
    return ''.join(text),mapping
def parse(source,max_pages=600,max_chars=1200000):
    data=Path(source).read_bytes();sha=hashlib.sha256(data).hexdigest();fid='F'+sha[:20]
    doc={'file_id':fid,'sha256':sha,'name':Path(source).name,'format':'pdf' if data[:5]==b'%PDF-' else 'docx','parse_status':'parsed','warnings':[],'units':[],'comments':[],'comment_audit':{},'attachment_refs':[],'revisions':[],'textboxes':{'present':False,'processed':0},'offset_unit':'unicode_code_points','parser_version':'contract-evidence-1'}
    def warn(code,detail,blocking=True):doc['warnings'].append({'code':code,'detail':detail,'blocking':blocking})
    active_clause=None
    def unit(uid,raw,**location):
        nonlocal active_clause
        match=re.match(r'^\s*(第[一二三四五六七八九十百\d]+条|\d+(?:\.\d+)*[、．.\s])',raw)
        if match:active_clause=match[1].strip()
        norm,mapping=normalized(raw)
        u={'id':fid+':'+uid,'file_id':fid,'order':len(doc['units']),'raw_text':raw,'normalized_text':norm,'normal_to_raw':mapping,'clause_label':active_clause,'page':None,**location};doc['units'].append(u);return u
    if doc['format']=='docx':
        with zipfile.ZipFile(source) as z:
            infos=z.infolist()
            if sum(x.file_size for x in infos)>80_000_000 or any(x.file_size>20_000_000 for x in infos):raise ValueError('DOCX_EXPANSION_LIMIT')
            if 'word/document.xml' not in z.namelist():raise ValueError('NOT_A_DOCX')
            def xml(name):
                b=z.read(name)
                if re.search(br'<!DOCTYPE|<!ENTITY',b,re.I):raise ValueError('XML_ENTITY_DECLARATION_REJECTED')
                return ET.fromstring(b)
            parts=['word/document.xml']+sorted(n for n in z.namelist() if re.fullmatch(r'word/(?:header\d+|footer\d+|footnotes|endnotes)\.xml',n))
            definitions=[]
            if 'word/comments.xml' in z.namelist():
                for c in xml('word/comments.xml').findall(W+'comment'):
                    definitions.append({'comment_id':c.get(W+'id'),'text':'\n'.join(''.join(t.text or '' for t in p.iter(W+'t')) for p in c.iter(W+'p')),'author':c.get(W+'author'),'date':c.get(W+'date'),'date_role':'comment_metadata_not_contract_signature'})
            events={};globals_by_part={};table_no=0
            for part in parts:
                active_clause=None
                root=xml(part)
                if any(e.tag.split('}')[-1] in ['altChunk','oMath','oMathPara','OLEObject'] for e in root.iter()):warn('EMBEDDED_OR_ALTERNATIVE_CONTENT_UNREAD',part)
                if any(e.tag.split('}')[-1] in ['drawing','pict'] for e in root.iter()) and not list(root.iter(W+'txbxContent')):warn('DOCX_IMAGE_CONTENT_NOT_OCRD',part)
                if any(e.tag in [W+'moveFrom',W+'moveTo'] for e in root.iter()):warn('TRACKED_MOVE_REQUIRES_REVIEW',part)
                position=0;counter=0;part_units=[]
                def paragraph(p,location):
                    nonlocal position,counter
                    counter+=1;uid=f'{part}:p{counter:06d}';raw=[];start=position;pending=[]
                    def visit(e,deleted=False):
                        nonlocal position
                        tag=e.tag.split('}')[-1]
                        if tag=='txbxContent':return
                        if tag in ['commentRangeStart','commentRangeEnd','commentReference']:
                            pending.append((e.get(W+'id'),tag,position));return
                        if tag in ['ins','del']:
                            doc['revisions'].append({'part':part,'unit_id':fid+':'+uid,'kind':tag,'author':e.get(W+'author'),'date':e.get(W+'date'),'text':''.join(t.text or '' for t in e.iter() if t.tag in [W+'t',W+'delText']),'view':'insertions included; deletions recorded separately'})
                        if tag=='del':return
                        if tag in ['t','tab','br','cr']:
                            text=e.text or '' if tag=='t' else '\t' if tag=='tab' else '\n';raw.extend(text);position+=len(text);return
                        for child in e:visit(child,deleted)
                    visit(p);u=unit(uid,''.join(raw),part=part,kind='cell_paragraph' if 'cell' in location else 'paragraph',**location);u['part_start']=start;u['part_end']=position;part_units.append(u)
                    for cid,tag,pos in pending:events.setdefault(cid,[]).append({'part':part,'unit_id':u['id'],'kind':tag,'part_offset':pos,'unit_offset':pos-start})
                    if p.find('.//'+W+'numPr') is not None:warn('AUTOMATIC_NUMBERING_UNRESOLVED',u['id']+' has automatic numbering; no generated clause number guessed')
                    position+=1
                def walk(e,location):
                    nonlocal table_no
                    if e.tag==W+'p':paragraph(e,location);return
                    if e.tag==W+'tbl':
                        table_no+=1;tid=fid+f':{part}:table{table_no:04d}'
                        for ri,row in enumerate(e.findall(W+'tr'),1):
                            for ci,cell in enumerate(row.findall(W+'tc'),1):
                                merge=cell.find('.//'+W+'gridSpan');vertical=cell.find('.//'+W+'vMerge')
                                if merge is not None or vertical is not None:warn('MERGED_TABLE_LAYOUT_REQUIRES_REVIEW',tid)
                                for ch in cell:walk(ch,{**location,'table_id':tid,'row':ri,'cell':ci,'cell_grid_span':int(merge.get(W+'val','1')) if merge is not None else 1,'vertical_merge':vertical.get(W+'val','continue') if vertical is not None else None})
                        return
                    for ch in e:walk(ch,location)
                body=root.find(W+'body') if part=='word/document.xml' else root
                walk(body,{})
                boxes=list(root.iter(W+'txbxContent'));doc['textboxes']['present']|=bool(boxes)
                if boxes:warn('TEXTBOX_READING_ORDER_UNVERIFIED','Textbox text retained separately; not silently assigned body reading order')
                for bi,box in enumerate(boxes,1):
                    for p in box.findall('.//'+W+'p'):paragraph(p,{'textbox':bi})
                    doc['textboxes']['processed']+=1
                globals_by_part[part]=part_units
            for i,c in enumerate(definitions):
                es=events.get(c['comment_id'],[]);starts=[e for e in es if e['kind']=='commentRangeStart'];ends=[e for e in es if e['kind']=='commentRangeEnd'];refs=[e for e in es if e['kind']=='commentReference'];problems=[];spans=[]
                if len(starts)!=1 or len(ends)!=1 or len(refs)!=1:problems.append('ANCHOR_CARDINALITY')
                if len(starts)==len(ends)==1:
                    a,b=starts[0],ends[0]
                    if a['part']!=b['part'] or b['part_offset']<=a['part_offset']:problems.append('INVALID_OR_EMPTY_RANGE')
                    else:
                        for u in globals_by_part[a['part']]:
                            lo=max(0,a['part_offset']-u['part_start']);hi=min(len(u['raw_text']),b['part_offset']-u['part_start'])
                            if hi>lo:spans.append({'unit_id':u['id'],'start':lo,'end':hi,'quote':u['raw_text'][lo:hi],'context':u['raw_text']})
                if not spans:problems.append('UNLOCATED_COMMENT')
                if sum(x['comment_id']==c['comment_id'] for x in definitions)!=1:problems.append('DUPLICATE_COMMENT_ID')
                doc['comments'].append({**c,'definition_index':i,'anchor_state':'anchored' if not problems else 'anomalous','spans':spans,'selected_text':'\n'.join(s['quote'] for s in spans),'events':es,'anomalies':problems})
                for problem in problems:warn('COMMENT_'+problem,c['comment_id'])
            defined={c['comment_id'] for c in definitions}
            for cid in events:
                if cid not in defined:warn('COMMENT_REFERENCE_WITHOUT_DEFINITION',cid)
            doc['comment_audit']={'definitions':len(definitions),'unique_ids':len(defined),'references':sum(e['kind']=='commentReference' for es in events.values() for e in es),'range_starts':sum(e['kind']=='commentRangeStart' for es in events.values() for e in es),'range_ends':sum(e['kind']=='commentRangeEnd' for es in events.values() for e in es),'anchored':sum(c['anchor_state']=='anchored' for c in doc['comments']),'unknown_ids':sorted(set(events)-defined)}
            if doc['revisions']:warn('TRACKED_CHANGES_REVIEW_REQUIRED','Both revision text and final-view text preserved; acceptance state not inferred')
            if 'word/commentsExtended.xml' in z.namelist():warn('EXTENDED_COMMENT_THREADS_NOT_RESOLVED','Basic comments retained; extended threads require review')
            doc['external_relationships']=[]
            for name in z.namelist():
                if name.endswith('.rels'):
                    for rel in xml(name):
                        if rel.get('TargetMode')=='External':doc['external_relationships'].append({'part':name,'target':rel.get('Target'),'fetched':False})
    else:
        import pdfplumber
        with pdfplumber.open(source) as pdf:
            doc['total_pages']=len(pdf.pages);doc['ocr_pages']=[]
            for pi,page in enumerate(pdf.pages,1):
                if pi>max_pages:warn('PAGE_LIMIT_EXCEEDED',f'{pi}..{len(pdf.pages)} not parsed');break
                raw=page.extract_text(layout=False) or ''
                if len(raw.strip())<20:doc['ocr_pages'].append({'page':pi,'state':'required_not_run','verified':False});warn('OCR_REQUIRED_OR_SPARSE_PAGE',str(pi))
                else:doc['ocr_pages'].append({'page':pi,'state':'native_text_extracted','verified':False})
                if raw.count('\ufffd')>max(1,len(raw)*.01):warn('LOW_QUALITY_TEXT_LAYER',str(pi))
                for li,line in enumerate(raw.splitlines(),1):unit(f'pdf:p{pi:04d}:l{li:05d}',line,kind='pdf_line',page=pi)
                for ti,table in enumerate(page.find_tables(),1):
                    values=table.extract()
                    for ri,row in enumerate(values,1):
                        for ci,value in enumerate(row,1):
                            if value is not None:unit(f'pdf:p{pi}:t{ti}:r{ri}:c{ci}',value,kind='pdf_cell',page=pi,table_id=fid+f':pdf:p{pi}:t{ti}',row=ri,cell=ci,bbox=table.rows[ri-1].cells[ci-1],overlaps_page_text=True)
                for ai,a in enumerate(page.annots or []):doc['comments'].append({'comment_id':f'pdf:{pi}:{ai}','text':a.get('contents') or '', 'author':a.get('title'),'date':None,'anchor_state':'anomalous','spans':[],'page':pi,'bbox':[a.get(k) for k in ['x0','top','x1','bottom']],'anomalies':['PDF_ANNOTATION_TEXT_ANCHOR_UNVERIFIED']});warn('PDF_ANNOTATION_ANCHOR_UNVERIFIED',f'{pi}:{ai}')
            warn('PDF_LAYOUT_COMPLETENESS_UNVERIFIED','Native text and ruled-table cells have page evidence; unruled tables/layout reading order not fully verified')
    for u in doc['units']:
        for m in re.finditer(r'附件\s*([一二三四五六七八九十\d]+)',u['raw_text']):doc['attachment_refs'].append({'label':'附件'+m[1],'unit_id':u['id'],'start':m.start(),'end':m.end(),'quote':m[0]})
    doc['total_chars']=sum(len(u['raw_text']) for u in doc['units'])
    if doc['total_chars']>max_chars:warn('DOCUMENT_SIZE_REVIEW_LIMIT',str(doc['total_chars'])+' chars; evidence retained, semantic processing must be budgeted')
    doc['parse_status']='partial' if any(w['blocking'] for w in doc['warnings']) else 'parsed'
    return doc
if __name__=='__main__':
    job=json.load(sys.stdin)
    try:print(json.dumps(parse(job['path'],job.get('max_pages',600),job.get('max_chars',1200000)),ensure_ascii=False))
    except Exception as e:print(json.dumps({'parse_status':'failed','error':type(e).__name__+': '+str(e)},ensure_ascii=False));sys.exit(1)
