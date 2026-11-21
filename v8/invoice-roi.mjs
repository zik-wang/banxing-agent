import {createHash} from 'node:crypto';

export const ROI_VERSION='v7-p1-09-r2-1';
export const ROI_DEFAULTS=Object.freeze({dpi:300,maxDpi:400,maxRegions:6,maxRegionsPerField:2,maxSearchPages:10,maxPixels:16000000,maxInputBytes:30*1024*1024,imageScale:1.5,padding:0.012,maxRegionArea:0.65,maxMilliseconds:900000});
export function roiConfig(config={}){
  const c={...ROI_DEFAULTS,...config};
  for(const k of ['dpi','maxDpi','maxRegions','maxRegionsPerField','maxSearchPages','maxPixels','maxInputBytes','maxMilliseconds'])if(!Number.isSafeInteger(c[k])||c[k]<1)throw Error('Invalid ROI '+k);
  if(c.dpi<72||c.dpi>c.maxDpi||c.maxDpi>600||c.maxRegions>10||c.maxSearchPages>100||c.maxPixels>32000000||c.imageScale<1||c.imageScale>3||!Number.isFinite(c.imageScale)||!Number.isFinite(c.padding)||c.padding<0||c.padding>0.1||!Number.isFinite(c.maxRegionArea)||c.maxRegionArea<=0||c.maxRegionArea>0.9)throw Error('Invalid ROI limits');
  return c;
}
export function validBox(b){return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];}
export function normalizeBox(b,{space='normalized',width=1,height=1,viewport}={}){
  if(!validBox(b))throw Error('Invalid bbox');
  let n;
  if(space==='pdf_points'){
    if(!viewport||!(width>0&&height>0))throw Error('PDF viewport required');
    const r=[...viewport.convertToViewportPoint(b[0],b[1]),...viewport.convertToViewportPoint(b[2],b[3])];n=[Math.min(r[0],r[2])/width,Math.min(r[1],r[3])/height,Math.max(r[0],r[2])/width,Math.max(r[1],r[3])/height];
  }else if(space==='image_pixels'){
    if(!(width>0&&height>0))throw Error('Image dimensions required');n=[b[0]/width,b[1]/height,b[2]/width,b[3]/height];
  }else if(space==='normalized')n=[...b];else throw Error('Unknown coordinate space');
  if(n.some(x=>x<0||x>1))throw Error('bbox outside page');return n;
}
export const unionBox=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
export function expandBox(b,p=0.012){normalizeBox(b);return [Math.max(0,b[0]-p),Math.max(0,b[1]-p),Math.min(1,b[2]+p),Math.min(1,b[3]+p)];}
export function rotateBox(b,angle){normalizeBox(b);if(![0,90,180,270].includes(angle))throw Error('Invalid rotation');const point=([x,y])=>angle===90?[1-y,x]:angle===180?[1-x,1-y]:angle===270?[y,1-x]:[x,y];const a=point([b[0],b[1]]),z=point([b[2],b[3]]);return [Math.min(a[0],z[0]),Math.min(a[1],z[1]),Math.max(a[0],z[0]),Math.max(a[1],z[1])];}
export function cropBoxToPage(b,region){
  normalizeBox(b);const angle=((360-(region.preprocessing?.rotation||0))%360),r=rotateBox(b,angle),s=region.actualBbox||region.bbox;
  return [s[0]+r[0]*(s[2]-s[0]),s[1]+r[1]*(s[3]-s[1]),s[0]+r[2]*(s[2]-s[0]),s[1]+r[3]*(s[3]-s[1])];
}
export function roiCacheKey({sha256,pageIndex,bbox,dpi,preprocessing,model,version=ROI_VERSION}){return createHash('sha256').update(JSON.stringify({sha256,pageIndex,bbox,dpi,preprocessing,model,version})).digest('hex');}
const dictionaries={
  invoiceNumber:/发票\s*(?:号码|号(?!码)|No\.?|Ｎｏ)|票据\s*(?:号码|号(?!码))|Invoice\s*(?:No\.?|Number|#)/i,
  billNumber:/账单\s*(?:编号|号码|号)|Bill\s*(?:No\.?|Number)|Invoice\s*(?:No\.?|Number|#)/i,
  invoiceCode:/发票\s*代码/i,machineNumber:/机器\s*(?:编号|号码)|机打号码/i,
  date:/开票日期|出具日期|发票日期|Invoice\s*Date|Issue\s*Date|Issued|^Date\b/i,
  buyer:/购买方|购方|买方|收货单位|Bill\s*to|Customer/i,
  seller:/销售方|销方|卖方|供应商|商户|Seller|Vendor/i,
  total:/价税合计|金额合计|合计金额|含税总额|应付金额|Grand\s*Total|Amount\s*Due|Total\s*Due|^Total\b/i,
  subtotal:/不含税金额|小计|Subtotal/i,tax:/税额|Tax/i,paid:/实付金额|Amount\s*Paid/i,
  currency:/币种|Currency|人民币|CNY|RMB|USD|美元|EUR|欧元|[￥¥€£]/i,
};
export function fieldLabel(field,text,type='unknown'){
  const t=String(text).replace(/<[^>]*>/g,' ').replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'$1').replace(/\s+/g,' ').trim();
  if(field==='buyer'&&/购买方(?:扣税|记账|抵扣|报销)(?:凭证|联)/.test(t)&&!/购买方(?:名称|信息)?\s*[:：]/.test(t))return false;
  if(field==='invoiceNumber'&&type==='delivery_note')return false;
  if(field==='total'&&/^(?:Sub\s*total|Tax\s*Total|Amount\s*Paid|实付金额|税额|小计)\b/i.test(t))return false;
  return dictionaries[field]?.test(t)||false;
}
function area(b){return (b[2]-b[0])*(b[3]-b[1]);}
function nearby(a,b,angle=0){
  a=rotateBox(a,(360-angle)%360);b=rotateBox(b,(360-angle)%360);
  const ah=a[3]-a[1],bh=b[3]-b[1];
  const row=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
  const col=Math.min(a[2],b[2])-Math.max(a[0],b[0]);
  return (row>=Math.min(ah,bh)*0.35&&b[0]>=a[0]&&b[0]-a[2]<0.23)||(col>0&&b[1]>=a[1]&&b[1]-a[3]<Math.max(ah,bh)*2.5);
}
export function recoveryRoutes(fields,candidates=[]){
  return fields.map(field=>{
    const rejected=candidates.filter(c=>c.raw?.field===field&&!c.result?.accepted),reasons=new Set(rejected.map(c=>c.result?.reason));
    const reason=reasons.has('semantic_role_conflict')?(field==='total'?'amount_role_ambiguous':'ambiguous_number_role'):reasons.has('source_not_located')?'source_text_corrupted':field==='currency'?'currency_unknown':'label_missing';
    return {field,reason,steps:['program_source_lookup','existing_bbox','label_anchor','value_anchor','layout_search','explicit_fallback'],maxAttempts:2};
  });
}
/** All geometry is top-left normalized in the effective rendered page. Anchors
 * identify a search ROI, never establish the field value or its business role. */
export function locateFieldRegions({file,fields,pages,blocks=[],candidates=[],sources=[],documentType='unknown',config={}}){
  const c=roiConfig(config),regions=[],outcomes=[],invalidBlocks=[];
  const pageMap=new Map(pages.map(p=>[p.page,p]));
  const usable=blocks.filter(b=>{try{normalizeBox(b.bbox);if(!pageMap.has(b.page))throw Error('unknown page');return true;}catch{invalidBlocks.push({page:b.page,sourceId:b.sourceId,reason:'invalid_or_unmapped_bbox'});return false;}});
  const add=(field,anchor,method,score,partners=[])=>{
    let bbox=partners.reduce((b,x)=>unionBox(b,x.bbox),anchor.bbox);bbox=expandBox(bbox,c.padding);
    if(area(bbox)>c.maxRegionArea)return false;
    const p=pageMap.get(anchor.page),angle=[0,90,180,270].includes(anchor.angle)?anchor.angle:0;
    const r={id:'roi-'+createHash('sha256').update(JSON.stringify([file.sha256,anchor.page,bbox,field,method])).digest('hex').slice(0,16),fileId:file.id,originalSha256:file.sha256,page:anchor.page,pageIndex:anchor.page-1,fields:[field],fieldType:field,bbox,coordinateSpace:'normalized',pageWidth:p.width,pageHeight:p.height,rotation:p.rotation||0,contentAngle:angle,preprocessing:{rotation:(360-angle)%360,imageScale:c.imageScale,method:'original_crop_then_bicubic_scale'},locatorMethod:method,selection:method,precision:method==='fallback'||method==='layout_search'?'search_prior':'block_anchor',anchorEvidenceIds:[anchor.sourceId,...partners.map(x=>x.sourceId)].filter(Boolean),anchorBlocks:[anchor,...partners].map(b=>({id:b.id,text:b.text,bbox:b.bbox,sourceId:b.sourceId})),score,dpi:p.kind==='pdf'?c.dpi:null,verification:'not_manually_verified'};
    regions.push(r);return true;
  };
  for(const field of fields){
    const start=regions.length,raw=candidates.filter(x=>x.raw?.field===field),labelled=usable.filter(b=>fieldLabel(field,b.text,documentType));
    // L1 ties an actual candidate source span to a recorded block. No global
    // text-index interpolation is used to invent a pixel location.
    for(const cand of raw){const e=cand.result?.evidence;if(!e)continue;const anchors=usable.filter(b=>b.sourceId===e.sourceId&&b.span&&b.span.start<=e.start&&b.span.end>=e.end&&fieldLabel(field,b.text,documentType));for(const b of anchors)add(field,b,'existing_bbox',100);}
    for(const b of labelled){
      const neighbours=usable.filter(v=>v!==b&&v.page===b.page&&nearby(b.bbox,v.bbox,b.angle||0)&&!Object.keys(dictionaries).some(other=>other!==field&&fieldLabel(other,v.text,documentType))).sort((x,y)=>area(unionBox(b.bbox,x.bbox))-area(unionBox(b.bbox,y.bbox))).slice(0,2);
      add(field,b,'label_anchor',90,neighbours);
    }
    // L3 only becomes a value anchor when a role-specific label is nearby.
    for(const cand of raw){const value=String(cand.raw.value??'').trim();if(!value)continue;for(const b of usable.filter(b=>b.text.includes(value))){const l=labelled.find(x=>x.page===b.page&&nearby(x.bbox,b.bbox,x.angle||0));if(l)add(field,l,'value_anchor',80,[b]);}}
    if(regions.length===start){
      // Candidate numeric observations can guide search, but never prove a role.
      const observations=usable.filter(b=>/\d/.test(b.text)&&b.text.length<120&&!Object.keys(dictionaries).some(other=>other!==field&&fieldLabel(other,b.text,documentType)));
      const relevant=raw.flatMap(x=>observations.filter(b=>b.text.includes(String(x.raw.value||'!'))));
      for(const b of relevant.slice(0,2))add(field,{...b,bbox:expandBox(b.bbox,0.045)},'layout_search',40);
    }
    if(regions.length===start){
      // Low-confidence fallbacks are explicitly visible, bounded, and cannot
      // establish semantic support. Search all indexed pages before budgeting.
      for(const p of pages.slice(0,c.maxSearchPages)){
        const heading=usable.find(b=>b.page===p.page&&/Invoice|发票|送货|销.*货|账单/i.test(b.text));
        const box=['total','currency'].includes(field)?[0.03,0.52,0.97,0.96]:['buyer','seller'].includes(field)?[0.03,0.08,0.97,0.48]:[0.03,0.02,0.97,0.34];
        const sourceBox=rotateBox(box,heading?.angle||0);add(field,{page:p.page,bbox:sourceBox,text:'No role-specific coordinate anchor; bounded orientation-mapped layout fallback',sourceId:heading?.sourceId,angle:heading?.angle||0},'fallback',10);
      }
    }
    outcomes.push({field,locatedCandidates:regions.slice(start).map(r=>r.id),status:regions.length===start?'not_attempted':'planned',reason:regions.length===start?'No usable bounded region; source geometry unavailable or region too broad':null});
  }
  const unique=[];
  for(const r of regions.sort((a,b)=>b.score-a.score)){
    const same=unique.find(x=>x.page===r.page&&x.preprocessing.rotation===r.preprocessing.rotation&&area(unionBox(x.bbox,r.bbox))<=Math.min(area(x.bbox),area(r.bbox))*1.18&&area(unionBox(x.bbox,r.bbox))<=c.maxRegionArea);
    if(same){same.bbox=unionBox(same.bbox,r.bbox);same.fields=[...new Set([...same.fields,...r.fields])];same.anchorEvidenceIds=[...new Set([...same.anchorEvidenceIds,...r.anchorEvidenceIds])];same.anchorBlocks.push(...r.anchorBlocks);continue;}
    unique.push(r);
  }
  const selected=[],counts={},uncovered=new Set(fields),core=new Set(['documentType','invoiceNumber','billNumber','date','buyer','seller','total','currency']),pool=[...unique];
  while(selected.length<c.maxRegions){
    const available=pool.filter(r=>r.fields.every(f=>(counts[f]||0)<c.maxRegionsPerField));if(!available.length)break;
    const priority=r=>{const newCore=r.fields.filter(f=>core.has(f)&&uncovered.has(f)).length,newOther=r.fields.filter(f=>uncovered.has(f)).length;return [newCore?2:newOther?1:0,newCore,newOther,r.score];};
    available.sort((a,b)=>{const x=priority(a),y=priority(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;});
    const r=available[0];selected.push(r);pool.splice(pool.indexOf(r),1);for(const f of r.fields){counts[f]=(counts[f]||0)+1;uncovered.delete(f);}
  }
  for(const o of outcomes){o.selectedRegionIds=selected.filter(r=>r.fields.includes(o.field)).map(r=>r.id);o.uncheckedPages=pages.map(p=>p.page).filter(p=>!selected.some(r=>r.page===p&&r.fields.includes(o.field)));if(!o.selectedRegionIds.length){o.status='not_attempted';o.reason=o.reason||'Document or field ROI budget exhausted';}}
  return {version:ROI_VERSION,regions:selected,outcomes,routes:recoveryRoutes(fields,candidates),indexedPages:pages.map(p=>p.page),totalPages:pages.totalPages||pages.length,unselectedRegions:unique.filter(r=>!selected.includes(r)).map(r=>({id:r.id,page:r.page,fields:r.fields,reason:'budget_exhausted'})),invalidBlocks,config:c};
}
