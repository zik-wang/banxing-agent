import unittest,tempfile
from pathlib import Path
import fitz
from cad_harness.pdf_anchors import candidates

class AnchorCandidateTests(unittest.TestCase):
 def make(self,path):
  doc=fitz.open();p=doc.new_page(width=200,height=160)
  # Four source triangles, two independent perpendicular dimension directions.
  for pts in [[(20,40),(28,38),(28,42)],[(100,40),(92,38),(92,42)],[(140,60),(138,68),(142,68)],[(140,140),(138,132),(142,132)]]:
   s=p.new_shape();s.draw_polyline(pts);s.finish(color=None,fill=(0,0,0),closePath=True);s.commit()
  p.insert_text((106,43),'16mm');p.insert_text((145,105),'32mm');doc.save(path);doc.close()
 def test_original_arrow_tips_and_directions_are_retained(self):
  base=Path(__file__).resolve().parents[1]/'.test-tmp';base.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=base) as d:
   f=Path(d)/'source.pdf';self.make(f);r=candidates(f)
  self.assertEqual(len(r['arrows']),4)
  self.assertEqual({x['axis'] for x in r['collinear_opposed_arrow_pairs']},{'x','y'})
  self.assertEqual({x['distance_pt'] for x in r['collinear_opposed_arrow_pairs']},{80})
  self.assertEqual({x['value_mm'] for x in r['explicit_mm_labels']},{16,32})
  self.assertEqual(r['status'],'SOURCE_CANDIDATES_ONLY_NOT_ACCEPTED_DIMENSIONS')

if __name__=='__main__':unittest.main()
