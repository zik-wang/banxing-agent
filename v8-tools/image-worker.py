"""Local read/render/crop worker. Paths are assigned by the host, never by the model."""
import json, sys
from pathlib import Path
from PIL import Image
import pypdfium2 as pdfium

job = json.loads(sys.stdin.read())
source = Path(job['input'])

def describe(p):
    with Image.open(p) as image:
        return {'width': image.width, 'height': image.height, 'format': image.format.lower()}

if job['operation'] == 'prepare_pdf_input':
    from pdf_conversion import prepare
    result = prepare(job)
elif job['operation'] == 'verify_pdf':
    from pdf_conversion import verify
    result = verify(job)
elif job['operation'] == 'word_text':
    from word_reader import read_word
    result = read_word(source, job['output'])
elif job['operation'] == 'inspect':
    with source.open('rb') as f:
        pdf = f.read(5) == b'%PDF-'
    if pdf:
        with pdfium.PdfDocument(source) as doc:
            result = {'kind': 'pdf', 'pages': len(doc)}
    elif source.suffix.lower() == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(source, read_only=True, data_only=False)
        result = {'kind':'workbook','sheets':[]}
        for sheet in book.worksheets:
            if sheet.max_row is None: sheet.calculate_dimension(force=True)
            result['sheets'].append({'name':sheet.title,'rows':sheet.max_row,'columns':sheet.max_column})
        book.close()
    else:
        result = {'kind': 'image', 'pages': 1, **describe(source)}
elif job['operation'] == 'pdf_text':
    with pdfium.PdfDocument(source) as doc:
        number = job['page']
        if not 1 <= number <= len(doc):
            raise ValueError('PAGE_OUT_OF_RANGE')
        page = doc[number - 1]
        textpage = page.get_textpage()
        result = {'text': textpage.get_text_range(), 'page': number, 'totalPages': len(doc)}
        textpage.close(); page.close()
elif job['operation'] in ['inspect_xlsx','read_workbook']:
    from datetime import date, time, timedelta
    from openpyxl import load_workbook
    from openpyxl.utils.datetime import WINDOWS_EPOCH, to_excel

    def workbook_value(cell):
        value = cell.value
        if isinstance(value, (date, time, timedelta)):
            return {
                'kind': 'excel_temporal',
                'serial': to_excel(value, WINDOWS_EPOCH),
                'numberFormat': cell.number_format,
                'display': str(value) if isinstance(value, timedelta) else value.isoformat(),
            }
        return value

    book = load_workbook(source, read_only=True, data_only=False)
    sheets = []
    selected_sheet = job.get('sheet') if job['operation'] == 'read_workbook' else None
    try:
        total_cells = 0
        for sheet in book.worksheets:
            if selected_sheet is not None and sheet.title != selected_sheet:
                continue
            if sheet.max_row is None or sheet.max_column is None:
                sheet.calculate_dimension(force=True)
            total_cells += sheet.max_row * sheet.max_column
            if sheet.max_row > 2000 or sheet.max_column > 40 or total_cells > 80000:
                raise ValueError(f'READBACK_SIZE_LIMIT: {sheet.title} has {sheet.max_row} rows, {sheet.max_column} columns; limits are 2000 rows and 40 columns per sheet, 80000 cells per read')
            rows, formulas = [], []
            for row in sheet.iter_rows():
                rows.append([workbook_value(cell) for cell in row])
                formulas.extend(cell.coordinate for cell in row if cell.data_type == 'f')
            sheets.append({'name':sheet.title,'rows':rows,'formulas':formulas})
    finally:
        book.close()
    result = {'sheets':sheets, 'contentVerified':False}
elif job['operation'] == 'inspect_docx':
    from zipfile import ZipFile
    import xml.etree.ElementTree as ET
    with ZipFile(source) as z:
        if not {'[Content_Types].xml','word/document.xml','_rels/.rels'}.issubset(set(z.namelist())):
            raise ValueError('INVALID_DOCX_PACKAGE')
        if z.getinfo('word/document.xml').file_size > 20000000:
            raise ValueError('DOCX_READBACK_SIZE_LIMIT')
        body = ET.fromstring(z.read('word/document.xml')).find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}body')
        ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        txt = lambda e: ''.join(t.text or '' for t in e.findall('.//w:t',ns))
        paragraphs = [txt(p) for p in body.findall('w:p',ns)]
        tables = [[[txt(c) for c in r.findall('w:tc',ns)] for r in table.findall('w:tr',ns)] for table in body.findall('w:tbl',ns)]
    blocks = []
    for child in body:
        if child.tag == '{'+ns['w']+'}p':
            blocks.append({'kind':'paragraph','text':txt(child)})
        elif child.tag == '{'+ns['w']+'}tbl':
            blocks.append({'kind':'table','rows':[[txt(c) for c in r.findall('w:tc',ns)] for r in child.findall('w:tr',ns)]})
    result = {'paragraphs':paragraphs,'tables':tables,'blocks':blocks,'packageValid':True,'contentVerified':False}
elif job['operation'] == 'render':
    with pdfium.PdfDocument(source) as doc:
        number = job['page']
        if not 1 <= number <= len(doc):
            raise ValueError('PAGE_OUT_OF_RANGE')
        page = doc[number - 1]
        scale = job['dpi'] / 72
        if page.get_width() * page.get_height() * scale * scale > 25_000_000:
            raise ValueError('RENDER_PIXEL_BUDGET')
        bitmap = page.render(scale=scale)
        bitmap.to_pil().save(job['output'])
        result = {**describe(job['output']), 'page': number, 'totalPages': len(doc)}
        bitmap.close(); page.close()
elif job['operation'] == 'split':
    with Image.open(source) as image:
        width, height, overlap = job['tileWidth'], job['tileHeight'], job['overlap']
        step_x, step_y = width - overlap, height - overlap
        if step_x <= 0 or step_y <= 0:
            raise ValueError('OVERLAP_TOO_LARGE')
        xs, ys = [0], [0]
        while xs[-1] + width < image.width: xs.append(xs[-1] + step_x)
        while ys[-1] + height < image.height: ys.append(ys[-1] + step_y)
        if len(xs) * len(ys) > 64: raise ValueError('TILE_BUDGET_EXCEEDED')
        tiles = []
        for y in ys:
            for x in xs:
                box = [x, y, min(x + width, image.width), min(y + height, image.height)]
                target = str(Path(job['outputDirectory']) / ('tile-%03d.png' % len(tiles)))
                image.crop(box).save(target)
                tiles.append({'path': target, 'box': box, **describe(target)})
        result = {'tiles': tiles, 'parentDimensions': [image.width, image.height], 'overlapPixels': overlap}
else:
    raise ValueError('Unknown operation')
print(json.dumps(result))
