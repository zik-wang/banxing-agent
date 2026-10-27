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

if job['operation'] == 'inspect':
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
    from openpyxl import load_workbook
    book = load_workbook(source, read_only=True, data_only=False)
    sheets = []
    for sheet in book.worksheets:
        if sheet.max_row is None or sheet.max_column is None:
            sheet.calculate_dimension(force=True)
        if sheet.max_row > 600 or sheet.max_column > 40:
            raise ValueError('READBACK_SIZE_LIMIT')
        rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
        formulas = [cell.coordinate for row in sheet.iter_rows() for cell in row if cell.data_type == 'f']
        sheets.append({'name':sheet.title,'rows':rows,'formulas':formulas})
    book.close()
    result = {'sheets':sheets, 'contentVerified':False}
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
