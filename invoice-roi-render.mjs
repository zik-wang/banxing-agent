import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {renderInvoicePages} from './invoice-local-render.mjs';
import {normalizeBox,roiConfig} from './invoice-roi.mjs';
const require=createRequire(import.meta.url),{createCanvas,loadImage}=require('@napi-rs/canvas');
const check=(w,h,c)=>{if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>c.maxPixels)throw Error('ROI pixel/memory budget exceeded');};
async function openPdf(bytes,c){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),root=dirname(require.resolve('pdfjs-dist/package.json')),asset=n=>join(root,n).replace(/\\/g,'/')+'/';
  class Factory{create(w,h){w=Math.ceil(w);h=Math.ceil(h);check(w,h,c);const canvas=createCanvas(w,h);return {canvas,context:canvas.getContext('2d')};}reset(t,w,h){check(Math.ceil(w),Math.ceil(h),c);t.canvas.width=Math.ceil(w);t.canvas.height=Math.ceil(h);}destroy(t){t.canvas.width=t.canvas.height=0;t.canvas=t.context=null;}}
  const loading=pdfjs.getDocument({data:new Uint8Array(bytes),CanvasFactory:Factory,cMapUrl:asset('cmaps'),cMapPacked:true,standardFontDataUrl:asset('standard_fonts'),wasmUrl:asset('wasm'),useWorkerFetch:false,useSystemFonts:false,disableFontFace:true,isEvalSupported:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,disableRange:true,disableStream:true,disableAutoFetch:true,stopAtErrors:true,enableXfa:false});
  try{return {loading,pdf:await loading.promise,pdfjs};}catch(e){await loading.destroy();throw e;}
}
function abort(signal){signal?.throwIfAborted();}
function pdfBlock(item,viewport,page,index){
  const t=item.transform,dx=t[0],dy=t[1],len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,h=Math.abs(item.height)||Math.hypot(t[2],t[3])||8,w=Math.abs(item.width)||1;
  const pts=[[t[4],t[5]],[t[4]+ux*w,t[5]+uy*w],[t[4]-uy*h,t[5]+ux*h],[t[4]+ux*w-uy*h,t[5]+uy*w+ux*h]].map(p=>viewport.convertToViewportPoint(...p));
  const b=[Math.max(0,Math.min(...pts.map(p=>p[0]))/viewport.width),Math.max(0,Math.min(...pts.map(p=>p[1]))/viewport.height),Math.min(1,Math.max(...pts.map(p=>p[0]))/viewport.width),Math.min(1,Math.max(...pts.map(p=>p[1]))/viewport.height)];
  try{normalizeBox(b);}catch{return null;}
  return {id:`pdf-${page}-${index}`,page,bbox:b,text:item.str,angle:0,coordinateSystem:'normalized_0_1',sourceType:'pdf_text'};
}
export async function inspectInvoiceGeometry(bytes,extension,{signal,...options}={}){
  const c=roiConfig(options);abort(signal);if(bytes.length>c.maxInputBytes)throw Error('ROI input file size budget exceeded');
  if(extension.replace(/^\./,'').toLowerCase()!=='pdf'){
    const r=await renderInvoicePages(bytes,extension,{signal,maxPixels:c.maxPixels});return {totalPages:1,indexedPages:[1],unindexedPages:[],pages:r.pages.map(({png,...p})=>({...p,kind:'image',sourceQuality:{sourceWidth:p.width,sourceHeight:p.height,interpolationAddsDetail:false,exifOrientationVerified:false}})),blocks:[]};
  }
  const {loading,pdf,pdfjs}=await openPdf(bytes,c);const pages=[],blocks=[];
  try{
    for(let n=1;n<=Math.min(pdf.numPages,c.maxSearchPages);n++){
      abort(signal);const page=await pdf.getPage(n);try{
        const v=page.getViewport({scale:1}),text=await page.getTextContent(),ops=await page.getOperatorList(),images=[];
        for(let i=0;i<ops.fnArray.length;i++)if([pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject].includes(ops.fnArray[i])){
          const a=ops.argsArray[i];let image=typeof a?.[0]==='object'?a[0]:null;
          if(!image&&typeof a?.[0]==='string')try{image=page.objs.has(a[0])?page.objs.get(a[0]):null;}catch{}
          const width=image?.width||a?.[1],height=image?.height||a?.[2];if(Number.isFinite(width)&&Number.isFinite(height))images.push({width,height});
        }
        let mode=0,opacity=1;const stack=[],textPaintRisks=[];
        for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],args=ops.argsArray[i];if(op===pdfjs.OPS.save)stack.push([mode,opacity]);else if(op===pdfjs.OPS.restore){const saved=stack.pop();if(saved)[mode,opacity]=saved;}else if(op===pdfjs.OPS.setTextRenderingMode)mode=args[0];else if(op===pdfjs.OPS.setGState){for(const pair of args[0]||[])if(pair[0]==='ca')opacity=pair[1];}else if([pdfjs.OPS.showText,pdfjs.OPS.showSpacedText,pdfjs.OPS.nextLineShowText,pdfjs.OPS.nextLineSetSpacingShowText].includes(op)){if(mode===3||mode===7)textPaintRisks.push('invisible_text');if(opacity===0)textPaintRisks.push('zero_opacity_text');}}
        pages.push({page:n,pageIndex:n-1,kind:'pdf',width:v.width,height:v.height,rotation:v.rotation,view:[...page.view],userUnit:page.userUnit,viewportTransform:[...v.transform],sourceQuality:{textPaintRisks:[...new Set(textPaintRisks)],textItems:text.items.filter(x=>x.str).length,embeddedImages:images,scanLikely:text.items.filter(x=>x.str?.trim()).length<3&&images.length>0,renderDpiCannotRestoreEmbeddedDetail:images.length>0}});
        blocks.push(...text.items.map((x,i)=>x.str?pdfBlock(x,v,n,i):null).filter(Boolean));
      }finally{page.cleanup();}
    }
    return {totalPages:pdf.numPages,indexedPages:pages.map(p=>p.page),unindexedPages:Array.from({length:pdf.numPages},(_,i)=>i+1).filter(n=>n>c.maxSearchPages),pages,blocks};
  }finally{await loading.destroy();}
}
async function transformCrop(buffer,rotation,scale,c){
  const image=await loadImage(buffer),turn=rotation===90||rotation===270,w=Math.ceil((turn?image.height:image.width)*scale),h=Math.ceil((turn?image.width:image.height)*scale);check(w,h,c);
  const canvas=createCanvas(w,h),ctx=canvas.getContext('2d');try{ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.scale(scale,scale);if(rotation===90){ctx.translate(image.height,0);ctx.rotate(Math.PI/2);}if(rotation===180){ctx.translate(image.width,image.height);ctx.rotate(Math.PI);}if(rotation===270){ctx.translate(0,image.width);ctx.rotate(3*Math.PI/2);}ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0);return {png:await canvas.encode('png'),width:w,height:h};}finally{canvas.width=canvas.height=0;}
}
export async function renderInvoiceRoi(bytes,extension,region,{signal,...options}={}){
  const c=roiConfig(options),bbox=normalizeBox(region.bbox);abort(signal);if(bytes.length>c.maxInputBytes)throw Error('ROI input file size budget exceeded');
  const kind=extension.replace(/^\./,'').toLowerCase();let raw,preview,meta;
  if(kind==='pdf'){
    const {loading,pdf}=await openPdf(bytes,c);try{
      if(region.pageIndex<0||region.pageIndex>=pdf.numPages)throw Error('ROI page index outside original PDF');
      const p=await pdf.getPage(region.pageIndex+1);try{
        const v=p.getViewport({scale:c.dpi/72}),left=Math.floor(bbox[0]*v.width),top=Math.floor(bbox[1]*v.height),right=Math.ceil(bbox[2]*v.width),bottom=Math.ceil(bbox[3]*v.height),w=right-left,h=bottom-top;check(w,h,c);
        const canvas=createCanvas(w,h);let task;const stop=()=>task?.cancel();signal?.addEventListener('abort',stop,{once:true});
        try{task=p.render({canvas,viewport:v,transform:[1,0,0,1,-left,-top],background:'white'});abort(signal);await task.promise;abort(signal);raw=await canvas.encode('png');}finally{signal?.removeEventListener('abort',stop);canvas.width=canvas.height=0;}
        const pv=p.getViewport({scale:Math.min(1,1400/Math.max(p.view[2]-p.view[0],p.view[3]-p.view[1]))}),pw=Math.ceil(pv.width),ph=Math.ceil(pv.height);check(pw,ph,c);const pc=createCanvas(pw,ph);let pt;const ps=()=>pt?.cancel();signal?.addEventListener('abort',ps,{once:true});try{pt=p.render({canvas:pc,viewport:pv,background:'white'});abort(signal);await pt.promise;preview=await pc.encode('png');}finally{signal?.removeEventListener('abort',ps);pc.width=pc.height=0;}
        const av=[left/v.width,top/v.height,Math.min(1,right/v.width),Math.min(1,bottom/v.height)];
        const corners=[[left,top],[right,bottom]].map(x=>v.convertToPdfPoint(...x));
        meta={renderDpi:c.dpi,actualBbox:av,pixelBounds:{left,top,right,bottom,width:w,height:h},pagePixelWidth:v.width,pagePixelHeight:v.height,pdfView:[...p.view],pdfRotation:p.rotate,rotation:v.rotation,viewportTransform:[...v.transform],pdfPointCorners:corners,source:'original_pdf_regional_render',preprocessing:{rotation:region.preprocessing?.rotation||0,imageScale:1,method:'original_pdf_render_no_screenshot_upscale'},sourceQuality:region.sourceQuality||null};
      }finally{p.cleanup();}
    }finally{await loading.destroy();}
  }else{
    if(region.pageIndex!==0)throw Error('Image only has one page');const r=await renderInvoicePages(bytes,extension,{signal,maxPixels:c.maxPixels}),p=r.pages[0];preview=p.png;const image=await loadImage(p.png),left=Math.floor(bbox[0]*p.width),top=Math.floor(bbox[1]*p.height),right=Math.ceil(bbox[2]*p.width),bottom=Math.ceil(bbox[3]*p.height),w=right-left,h=bottom-top;check(w,h,c);
    const canvas=createCanvas(w,h);try{canvas.getContext('2d').drawImage(image,left,top,w,h,0,0,w,h);raw=await canvas.encode('png');}finally{canvas.width=canvas.height=0;}
    meta={renderDpi:null,actualBbox:[left/p.width,top/p.height,right/p.width,bottom/p.height],pixelBounds:{left,top,right,bottom,width:w,height:h},pagePixelWidth:p.width,pagePixelHeight:p.height,source:'original_image_pixels',preprocessing:{rotation:region.preprocessing?.rotation||0,imageScale:c.imageScale,method:'canvas_high_quality_interpolation'},sourceQuality:{sourceWidth:p.width,sourceHeight:p.height,interpolated:c.imageScale!==1,interpolationAddsDetail:false,blur:'not_automatically_certified',exifOrientationVerified:false}};
  }
  abort(signal);const output=await transformCrop(raw,meta.preprocessing.rotation,meta.preprocessing.imageScale,c);
  if(output.png.length>c.maxInputBytes)throw Error('ROI PNG byte budget exceeded');
  const image=await loadImage(preview),overlay=createCanvas(image.width,image.height),ctx=overlay.getContext('2d');try{ctx.drawImage(image,0,0);ctx.strokeStyle='#d91f26';ctx.lineWidth=Math.max(2,image.width/500);const b=meta.actualBbox;ctx.strokeRect(b[0]*image.width,b[1]*image.height,(b[2]-b[0])*image.width,(b[3]-b[1])*image.height);return {...output,preview,overlay:await overlay.encode('png'),metadata:{...region,...meta,inputWidth:output.width,inputHeight:output.height}};}finally{overlay.width=overlay.height=0;}
}
