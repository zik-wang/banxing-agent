import unittest,tempfile
from pathlib import Path
import fitz,ezdxf
from cad_harness.pdf_source_audit import audit_source

class IndependentSourceAuditTests(unittest.TestCase):
 def test_saved_file_is_compared_with_original_and_tampering_is_rejected(self):
  root=Path(__file__).resolve().parents[1]/'.test-tmp';root.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=root) as d:
   pdf=Path(d)/'source.pdf';cad=Path(d)/'saved.dxf';f=fitz.open();p=f.new_page(width=200,height=100);p.draw_line((10,20),(110,20));p.insert_text((20,15),'SOURCE');f.save(pdf);f.close()
   s=25.4/72;doc=ezdxf.new();doc.units=4;ms=doc.modelspace();line=ms.add_line((10*s,80*s),(110*s,80*s));txt=ms.add_text('SOURCE',dxfattribs={'insert':(20*s,85*s),'height':3});doc.saveas(cad)
   self.assertTrue(audit_source(pdf,cad,s)['source_geometry_exact_within_rounding'])
   ms.delete_entity(line);doc.saveas(cad);self.assertEqual(audit_source(pdf,cad,s)['missing_segments'],1)
   txt.dxf.text='WRONG';doc.saveas(cad);self.assertEqual(audit_source(pdf,cad,s)['extra_or_changed_text'],1)

if __name__=='__main__':unittest.main()
