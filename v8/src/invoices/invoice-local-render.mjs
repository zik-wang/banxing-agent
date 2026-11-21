import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

// Install this file beside V7 package.json. No absolute production paths,
// network loaders, model calls, shell tools, or external converters are used.
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF_SCALE = 2; // 144 DPI; maxPixels is a hard per-page limit, not a resize hint.

function byteBuffer(bytes) {
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw new TypeError('Expected PDF/image bytes (Buffer, Uint8Array or ArrayBuffer), never a path or URL');
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
}

function checkPixels(width, height, maxPixels) {
  positiveInteger(width, 'width');
  positiveInteger(height, 'height');
  if (width > maxPixels / height) {
    throw new RangeError(`Image/page ${width}x${height} exceeds maxPixels=${maxPixels}`);
  }
}

function abortError(signal) {
  const error = new Error('Invoice rendering aborted', { cause: signal?.reason });
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal);
}

// Native image decode/encode cannot be forcibly interrupted. Stop awaiting on
// abort, observe the native promise, and never return a partial result.
async function abortable(promise, signal) {
  if (!signal) return promise;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function imageDimensions(bytes, kind) {
  if (kind === 'png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw new TypeError('Invalid PNG header');
    }
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new TypeError('Invalid JPEG header');
  // Read SOF dimensions before native allocation. No EXIF interpretation here.
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker)) {
      if (length < 8) break;
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  throw new TypeError('JPEG has no valid SOF dimensions');
}

function canvasFactory(maxPixels) {
  return class LocalCanvasFactory {
    create(width, height) {
      width = Math.ceil(width);
      height = Math.ceil(height);
      checkPixels(width, height, maxPixels);
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext('2d') };
    }
    reset(target, width, height) {
      width = Math.ceil(width);
      height = Math.ceil(height);
      checkPixels(width, height, maxPixels);
      target.canvas.width = width;
      target.canvas.height = height;
    }
    destroy(target) {
      target.canvas.width = target.canvas.height = 0;
      target.canvas = target.context = null;
    }
  };
}

function result(pages, totalPages) {
  return {
    pages,
    totalPages,
    // Local per-page image attachments, sharing the PNG Buffer (no base64,
    // upload, or PDF embedded-file extraction). Parent may adapt for its API.
    attachments: pages.map(({ page, width, height, png }) => ({
      page, width, height, mimeType: 'image/png', buffer: png,
    })),
  };
}

async function renderPdf(bytes, { signal, maxPages, maxPixels }) {
  const pdfjs = await abortable(import('pdfjs-dist/legacy/build/pdf.mjs'), signal);
  checkAbort(signal);
  const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const localAssetPath = name => join(packageRoot, name).replace(/\\/g, '/') + '/';
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes), // PDF.js may transfer/detach; caller bytes stay intact.
    CanvasFactory: canvasFactory(maxPixels),
    cMapUrl: localAssetPath('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: localAssetPath('standard_fonts'),
    wasmUrl: localAssetPath('wasm'),
    useWorkerFetch: false, // NodeBinaryDataFactory reads local files, never fetch.
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: true,
    enableXfa: false,
    // Do not set maxImageSize: PDF.js would silently omit oversized images.
  });
  let activeRender;
  let destruction;
  let failure;
  const destroy = () => destruction ??= loading.destroy();
  const onAbort = () => {
    activeRender?.cancel();
    // Observe cleanup rejection here; the finally block also awaits cleanup.
    destroy().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    checkAbort(signal);
    const document = await abortable(loading.promise, signal);
    const totalPages = document.numPages;
    if (totalPages > maxPages) {
      throw new RangeError(`PDF has ${totalPages} pages; exceeds maxPages=${maxPages}; no pages returned`);
    }
    const pages = [];
    for (let number = 1; number <= totalPages; number++) {
      await yieldToLoop();
      checkAbort(signal);
      const page = await abortable(document.getPage(number), signal);
      let canvas;
      try {
        const viewport = page.getViewport({ scale: PDF_SCALE });
        const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
        checkPixels(width, height, maxPixels);
        canvas = createCanvas(width, height);
        activeRender = page.render({ canvas, viewport, background: 'rgb(255,255,255)' });
        await abortable(activeRender.promise, signal);
        activeRender = undefined;
        checkAbort(signal);
        const png = await abortable(canvas.encode('png'), signal);
        checkAbort(signal);
        pages.push({ page: number, width, height, png,
          rotation: viewport.rotation, pdfPageRotation: page.rotate });
      } finally {
        activeRender?.cancel();
        activeRender = undefined;
        if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    return result(pages, totalPages);
  } catch (error) {
    failure = signal?.aborted ? abortError(signal) : error;
    throw failure;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { await destroy(); } catch (error) { if (!failure) throw error; }
  }
}

/**
 * Local PDF/PNG/JPEG -> full set of PNG pages. Page numbers are 1-based.
 * PDF renders at 144 DPI with PDF.js's effective /Rotate; maxPixels applies to
 * each output page and temporary PDF canvas. Limits reject, never truncate.
 * Image pixels are as decoded by canvas: rotation=null and EXIF is unverified.
 * Cancellation stops PDF.js; native image codec work may finish in background.
 */
export async function renderInvoicePages(bytes, extension, { signal, maxPages = 10, maxPixels = 16000000 } = {}) {
  positiveInteger(maxPages, 'maxPages');
  positiveInteger(maxPixels, 'maxPixels');
  checkAbort(signal);
  if (typeof extension !== 'string') throw new TypeError('extension must be pdf, png, jpg or jpeg');
  const kind = extension.toLowerCase().replace(/^\./, '');
  if (!['pdf', 'png', 'jpg', 'jpeg'].includes(kind)) throw new TypeError('Unsupported invoice extension');
  const input = byteBuffer(bytes);
  if (!input.length) throw new TypeError('Empty invoice bytes');
  await yieldToLoop();
  checkAbort(signal);
  if (kind === 'pdf') {
    if (!input.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new TypeError('Invalid PDF header');
    const output = await renderPdf(input, { signal, maxPages, maxPixels });
    checkAbort(signal);
    return output;
  }
  const [sourceWidth, sourceHeight] = imageDimensions(input, kind === 'png' ? 'png' : 'jpeg');
  checkPixels(sourceWidth, sourceHeight, maxPixels);
  const image = await abortable(loadImage(input), signal); // Buffer-only branch: no URL/path loader.
  checkAbort(signal);
  const width = image.width, height = image.height;
  checkPixels(width, height, maxPixels);
  const canvas = createCanvas(width, height);
  try {
    canvas.getContext('2d').drawImage(image, 0, 0);
    const png = await abortable(canvas.encode('png'), signal);
    checkAbort(signal);
    return result([{ page: 1, width, height, png, rotation: null,
      pdfPageRotation: null, exifOrientationVerified: false }], 1);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/**
 * bbox=[x0,y0,x1,y1], normalized to the rendered PNG, top-left origin.
 * No PDF-point coordinates, XYWH inference, coordinate repair or EXIF claims.
 * pixelBounds uses [left,right) x [top,bottom), enclosing the padded bbox.
 */
export async function cropInvoiceRegion(png, bbox, { coordinateSystem = 'normalized_0_1', padding = 0.015 } = {}) {
  if (coordinateSystem !== 'normalized_0_1') throw new TypeError('Only normalized_0_1 coordinates are supported');
  if (!Array.isArray(bbox) || bbox.length !== 4 ||
      !bbox.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) ||
      bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new RangeError('bbox must be [x0,y0,x1,y1], finite in 0..1, with positive area');
  }
  if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0 || padding > 1) {
    throw new RangeError('padding must be finite in 0..1');
  }
  const input = byteBuffer(png);
  const [headerWidth, headerHeight] = imageDimensions(input, 'png');
  checkPixels(headerWidth, headerHeight, Number.MAX_SAFE_INTEGER);
  const image = await loadImage(input);
  const sourceWidth = image.width, sourceHeight = image.height;
  const left = Math.floor(Math.max(0, bbox[0] - padding) * sourceWidth);
  const top = Math.floor(Math.max(0, bbox[1] - padding) * sourceHeight);
  const right = Math.ceil(Math.min(1, bbox[2] + padding) * sourceWidth);
  const bottom = Math.ceil(Math.min(1, bbox[3] + padding) * sourceHeight);
  const width = right - left, height = bottom - top;
  const canvas = createCanvas(width, height);
  try {
    canvas.getContext('2d').drawImage(image, left, top, width, height, 0, 0, width, height);
    return { buffer: await canvas.encode('png'),
      pixelBounds: { left, top, right, bottom, width, height },
      sourceWidth, sourceHeight, bbox: [...bbox], coordinateSystem, padding };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
