"""09-only offline MinerU; one file, all rendered pages, no cloud credentials."""
import contextlib
import hashlib
import json
import socket
import sys
from pathlib import Path

def denied(*args, **kwargs):
    raise RuntimeError('Invoice OCR network access disabled')

socket.socket.connect = denied
socket.socket.connect_ex = denied
socket.create_connection = denied

def run(req):
    import torch
    from PIL import Image
    from transformers import AutoProcessor, Qwen2VLForConditionalGeneration
    from mineru_vl_utils import MinerUClient
    if not 1 <= len(req['pages']) <= 10:
        raise ValueError('Page budget exceeded')
    model = Qwen2VLForConditionalGeneration.from_pretrained(req['modelPath'], dtype=torch.bfloat16, device_map='cuda:0', local_files_only=True)
    processor = AutoProcessor.from_pretrained(req['modelPath'], use_fast=False, local_files_only=True)
    client = MinerUClient(backend='transformers', model=model, processor=processor, image_analysis=False, batch_size=1, use_tqdm=False)
    records, pages = [], []
    for input_index, entry in enumerate(req['pages']):
        print('INVOICE_PROGRESS '+json.dumps({'page':entry['page']}), file=sys.stderr, flush=True)
        source = Path(entry['path'])
        if not source.is_file() or source.stat().st_size > 30*1024*1024:
            raise ValueError('Invalid rendered page')
        with Image.open(source) as image:
            if image.width*image.height > 16000000:
                raise ValueError('Pixel budget exceeded')
            try:
                blocks = client.two_step_extract(image.convert('RGB'))
                page_error = None
            except Exception as error:
                blocks = []
                page_error = type(error).__name__
        texts = []
        for index, block in enumerate(blocks):
            record = dict(block)
            record.update(page=entry['page'], inputIndex=input_index, roiId=entry.get('roiId'), blockIndex=index, text=str(block.get('content') or ''), coordinateSystem='normalized_crop_0_1' if entry.get('region') else 'normalized_0_1', region=entry.get('region'))
            records.append(record)
            texts.append(record['text'])
        content = '\n'.join(texts).strip()
        if entry.get('region'):
            checkpoint = {'version':'v7-roi-checkpoint-1', 'model':'OpenDataLab/MinerU2.5-Pro-2605-1.2B', 'roiId':entry.get('roiId'), 'page':entry['page'], 'inputSha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'text':content, 'records':[r for r in records if r.get('inputIndex') == input_index], 'error':page_error}
            (source.parent / 'worker-output.json').write_text(json.dumps(checkpoint, ensure_ascii=False), encoding='utf-8')
        if not content and not entry.get('region'):
            raise ValueError('Empty OCR page '+str(entry['page']))
        pages.append({'page':entry['page'], 'text':content, 'inputIndex':input_index, 'roiId':entry.get('roiId'), 'status':'failed' if not content else 'returned', 'error':page_error or ('empty_ocr' if not content else None)})
    content = '\n\n'.join(p['text'] for p in pages)
    if len(content) > 60000 or len(records) > 1500:
        raise ValueError('OCR output budget exceeded; no silent truncation')
    if not content:
        raise ValueError('All local OCR inputs empty or failed')
    from importlib.metadata import version
    return {'adapterVersion':'v7-p1-09-r2-1', 'libraries':{name:version(name) for name in ['transformers', 'torch', 'mineru-vl-utils']}, 'content':content,'records':records,'pages':pages,'model':'OpenDataLab/MinerU2.5-Pro-2605-1.2B','device':'cuda:0','layoutNative':True,'peakGpuBytes':torch.cuda.max_memory_allocated(),'reviewRequired':True}

try:
    req = json.loads(sys.stdin.read(65536))
    with contextlib.redirect_stdout(sys.stderr):
        result = run(req)
    print(json.dumps({'ok':True, **result}, ensure_ascii=False), flush=True)
except Exception as error:
    # No source text or credentials in diagnostics.
    print(json.dumps({'ok':False,'errorType':type(error).__name__,'error':str(error)[:500]}, ensure_ascii=False), flush=True)
    sys.exit(1)
