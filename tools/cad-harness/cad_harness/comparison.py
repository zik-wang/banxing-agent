"""Immutable original / actual-CAD-render comparison sheets for delivery."""
from pathlib import Path
import fitz
from PIL import Image,ImageDraw,ImageFont
from .storage import contained
def sheets(job,cfg,verification):
 font=None
 for f in ['C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
  if Path(f).exists():font=ImageFont.truetype(f,25);break
 if font is None:font=ImageFont.load_default()
 for name in cfg['sources']:
  path=contained(job,name);cad=verification/(path.stem+'_deepseek_harness.png')
  if not cad.exists():continue
  if path.suffix.lower()=='.pdf':
   with fitz.open(path) as pdf:
    pix=pdf[0].get_pixmap(matrix=fitz.Matrix(2,2));original=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
  elif path.suffix.lower() in ['.jpg','.jpeg','.png','.webp']:original=Image.open(path).convert('RGB')
  else:continue
  generated=Image.open(cad).convert('RGB');im=Image.new('RGB',(2100,1080),'#f2f3f5');draw=ImageDraw.Draw(im)
  for i,(label,picture) in enumerate([(path.name+' / Original',original),('Generated CAD / Reopened DXF',generated)]):
   picture.thumbnail((1010,870));x=i*1050;draw.text((x+20,20),label,font=font,fill='black');im.paste(picture,(x+(1050-picture.width)//2,80+(870-picture.height)//2))
  draw.text((25,995),'Layouts differ. Acceptance uses actual geometry; full source-contract coverage is separate.',font=font,fill='black')
  im.save(verification/(path.stem+'_original_vs_CAD.png'))
