"""Read OOXML as data, preserving body/table order and exposing unread visual scope."""
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def read_word(source, output):
    counts = {'paragraphs': 0, 'tables': 0, 'insertions': 0, 'deletions': 0, 'fields': 0}

    def inline(node):
        tag = node.tag
        if tag in (W+'t', W+'delText'):
            return node.text or ''
        if tag == W+'tab': return '\t'
        if tag in (W+'br', W+'cr'): return '\n'
        if tag == W+'noBreakHyphen': return '\u2011'
        if tag == W+'softHyphen': return '\u00ad'
        if tag == W+'instrText':
            counts['fields'] += 1
            return ''
        if tag in (W+'ins', W+'del'):
            key = 'insertions' if tag == W+'ins' else 'deletions'
            counts[key] += 1
            label = '插入修订' if key == 'insertions' else '删除修订'
            return '['+label+']'+''.join(inline(child) for child in node)+'[/'+label+']'
        if tag == W+'txbxContent': return '\n[文本框]\n'+container(node)
        return ''.join(inline(child) for child in node)

    def block(node):
        if node.tag == W+'p':
            counts['paragraphs'] += 1
            return inline(node)
        if node.tag == W+'tbl':
            counts['tables'] += 1
            rows = []
            for row in node:
                if row.tag != W+'tr': continue
                cells = [container(cell) for cell in row if cell.tag == W+'tc']
                rows.append('\t'.join(cells))
            return '\n'.join(rows)
        if node.tag in (W+'ins', W+'del'):
            key = 'insertions' if node.tag == W+'ins' else 'deletions'
            counts[key] += 1
            label = '插入修订' if key == 'insertions' else '删除修订'
            return '['+label+']\n'+container(node)+'\n[/'+label+']'
        return container(node)

    def container(node):
        return '\n'.join(value for child in node if (value := block(child)))

    try:
        with zipfile.ZipFile(source) as package:
            infos = package.infolist()
            if len(infos) > 6000: raise ValueError('DOCX_PACKAGE_LIMIT')
            names = package.namelist()
            if len(names) != len(set(names)): raise ValueError('DOCX_DUPLICATE_PART')
            if 'word/document.xml' not in names: raise ValueError('DOCX_MAIN_PART_MISSING')
            parts = ['word/document.xml'] + sorted(n for n in names if re.fullmatch(r'word/(?:header\d+|footer\d+|footnotes|endnotes|comments)\.xml', n))
            size = sum(package.getinfo(n).file_size for n in parts)
            if size > 24*1024*1024 or any(package.getinfo(n).file_size > 8*1024*1024 for n in parts):
                raise ValueError('DOCX_XML_LIMIT')
            texts, read_parts = [], []
            for name in parts:
                raw = package.read(name)
                if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('DOCX_XML_ENTITIES_DENIED')
                tree = ET.fromstring(raw)
                root = tree.find(W+'body') if name == 'word/document.xml' else tree
                if root is None: raise ValueError('DOCX_BODY_MISSING')
                text = container(root)
                label = '正文' if name == 'word/document.xml' else name.removeprefix('word/')
                texts.append('['+label+']\n'+text)
                read_parts.append(name)
            text = '\n\n'.join(texts)
            if len(text) > 4_000_000: raise ValueError('DOCX_TEXT_LIMIT')
            media = [n for n in names if n.startswith('word/media/') and not n.endswith('/')]
            unsupported = [n for n in names if n.startswith(('word/charts/', 'word/embeddings/')) and not n.endswith('/')]
            warnings = []
            if media: warnings.append('IMAGES_NOT_OCR_READ')
            if unsupported: warnings.append('EMBEDDED_OBJECTS_NOT_READ')
            if counts['insertions'] or counts['deletions']: warnings.append('TRACKED_CHANGES_MARKED_NOT_ACCEPTED')
            if counts['fields']: warnings.append('FIELDS_NOT_RECALCULATED')
            meta = {'kind':'word','format':'docx','reader':'ooxml-text-v1','parts':read_parts,**counts,'imageCount':len(media),
                    'unreadObjects':unsupported,'warnings':warnings,'pageLayoutRead':False,'contentVerified':False}
            Path(output).write_text(json.dumps({'text':text,'metadata':meta},ensure_ascii=False),encoding='utf-8')
            return meta
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        raise ValueError('DOCX_INVALID_PACKAGE: '+str(error)) from error
