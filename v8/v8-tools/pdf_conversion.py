"""PDF conversion preparation and validation. All paths are host-assigned."""
import json
from pathlib import Path

def prepare(job):
    source,output=Path(job['input']),Path(job['output'])
    if job['mode']=='text':
        from docx import Document
        from docx.shared import Pt, Inches
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        text=source.read_text(encoding='utf-8')
        if len(text)>500000: raise ValueError('PDF_TEXT_TOO_LARGE')
        d=Document();style=d.styles['Normal'];style.font.name='Noto Sans CJK SC';style.font.size=Pt(10)
        style.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Noto Sans CJK SC')
        d.sections[0].left_margin=d.sections[0].right_margin=Inches(.65)
        for line in text.split('\n'): d.add_paragraph(line)
        d.save(output)
        return {'method':'literal_text_to_docx','sourceChars':len(text),'markdownRendered':False}
    if job['mode']=='workbook':
        from openpyxl import load_workbook
        from openpyxl.worksheet.properties import PageSetupProperties
        from openpyxl.utils import get_column_letter
        from copy import copy
        import math,unicodedata
        w=load_workbook(source);visible=[];hidden=[]
        for s in w.worksheets:
            if s.sheet_state!='visible': hidden.append(s.title);continue
            if s.max_row>20000 or s.max_column>100: raise ValueError('PDF_WORKBOOK_SIZE_LIMIT')
            s.sheet_properties.pageSetUpPr=PageSetupProperties(fitToPage=True)
            s.page_setup.orientation='landscape' if s.max_column>6 else 'portrait'
            s.page_setup.paperSize=s.PAPERSIZE_A4;s.page_setup.fitToWidth=1;s.page_setup.fitToHeight=0
            s.print_area=s.calculate_dimension()
            # A print copy must not clip non-empty cells just because the original
            # workbook relied on Excel's overflow into adjacent empty columns.
            width=lambda text:sum(2 if unicodedata.east_asian_width(ch) in ('W','F') else 1 for ch in str(text))
            for col in range(1,s.max_column+1):
                key=get_column_letter(col)
                longest=max([width(c.value) for cells in s.iter_rows(min_col=col,max_col=col) for c in cells if c.value is not None]+[0])
                s.column_dimensions[key].width=max(s.column_dimensions[key].width or 13,min(45,max(12,longest+2)))
            merged={}
            for r in s.merged_cells.ranges:
                merged[(r.min_row,r.min_col)]=sum(s.column_dimensions[get_column_letter(c)].width for c in range(r.min_col,r.max_col+1))
            for row in s.iter_rows():
                height=s.row_dimensions[row[0].row].height or 15
                for cell in row:
                    if cell.value is None: continue
                    alignment=copy(cell.alignment);alignment.wrap_text=True;cell.alignment=alignment
                    available=max(4,merged.get((cell.row,cell.column),s.column_dimensions[cell.column_letter].width)-2)
                    lines=sum(max(1,math.ceil(width(line)/available)) for line in str(cell.value).split('\n'))
                    height=max(height,lines*((cell.font.sz or 11)*1.4)+3)
                if height>409: raise ValueError('PDF_ROW_LAYOUT_LIMIT: split very long cell content before conversion')
                s.row_dimensions[row[0].row].height=height
            visible.append({'name':s.title,'rows':s.max_row,'columns':s.max_column,'printArea':str(s.print_area)})
        if not visible: raise ValueError('PDF_NO_VISIBLE_SHEET')
        w.save(output);w.close()
        return {'method':'workbook_print_copy','visibleSheets':visible,'hiddenSheetsExcluded':hidden,'note':'Visible rows/columns and formula calculation follow the office renderer; hidden sheets remain excluded. Conversion copy uses fit-width, expanded column widths and wrapped row heights to avoid clipped values; original file is untouched.'}
    if job['mode']=='image':
        from PIL import Image,ImageSequence,ImageOps
        frames=[];pixels=0
        with Image.open(source) as im:
            for frame in ImageSequence.Iterator(im):
                pixels+=frame.width*frame.height
                if len(frames)>=100 or pixels>100000000: raise ValueError('PDF_IMAGE_PIXEL_LIMIT')
                image=ImageOps.exif_transpose(frame).convert('RGBA')
                canvas=Image.new('RGB',image.size,'white');canvas.paste(image,mask=image.getchannel('A'));frames.append(canvas)
        frames[0].save(output,'PDF',save_all=True,append_images=frames[1:],resolution=150)
        return {'method':'image_frames_to_pdf','frames':len(frames),'ocrPerformed':False}
    raise ValueError('PDF_PREPARATION_UNSUPPORTED')

def verify(job):
    import pypdfium2 as pdfium
    source=Path(job['input'])
    with source.open('rb') as f:
        if f.read(5)!=b'%PDF-': raise ValueError('INVALID_PDF_MAGIC')
    text=[];empty=[];chars=0
    with pdfium.PdfDocument(source) as doc:
        if not 1<=len(doc)<=1000: raise ValueError('PDF_PAGE_LIMIT')
        pages=len(doc)
        for i in range(pages):
            page=doc[i];tp=page.get_textpage();t=tp.get_text_range();chars+=len(t)
            if chars>4000000: raise ValueError('PDF_TEXT_READBACK_LIMIT')
            if not t.strip(): empty.append(i+1)
            text.append({'page':i+1,'text':t});tp.close();page.close()
    Path(job['output']).write_text(json.dumps({'pages':text},ensure_ascii=False),encoding='utf-8')
    return {'pages':pages,'textChars':chars,'pagesWithoutText':empty,'contentVerified':False}
