import sys,json,tempfile,unittest,copy
from pathlib import Path
from cad_harness.engine import compile_one
from cad_harness.schema import validate
from cad_harness.module_audit import audit_modules

def fixture():
 def box(cid,x1,y1,x2,y2):return {'op':'polyline','id':cid,'closed':True,'points':[[x1,y1],[x2,y1],[x2,y2],[x1,y2]]}
 commands=[box('outline',-1,-1,17,5),box('mount_module',0,0,4,3),box('locate_module',6,0,10,3),box('fasten_module',12,0,16,3),{'op':'line','id':'support_to_locate','points':[[4,1.5],[6,1.5]]},{'op':'line','id':'locate_to_fasten','points':[[10,1.5],[12,1.5]]}]
 return {'drawings':[{'source':'synthetic_fixture.png','title':'TEST FIXTURE ONLY NOT MODEL OUTPUT','views':[{'id':'functional','title':'Synthetic functional schematic','commands':commands}]}]}
SPEC={'nominal_length':20,'required_views':['functional'],'coverage_complete':False,'rules':[{'id':'frame','kind':'horizontal_levels','view':'functional','min':2}]}

class ModuleAuditTests(unittest.TestCase):
 def audit(self,p):
  contract={'drawings':{'synthetic_fixture.png':SPEC}};p=json.loads(json.dumps(p));validate(p,contract)
  tempbase=Path(__file__).resolve().parents[1]/'.test-tmp';tempbase.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=tempbase) as tmp:
   file,_=compile_one(p['drawings'][0],Path(tmp),SPEC);return audit_modules(file)
 def test_real_closed_boxes_and_attached_lines_pass(self):self.assertFalse(self.audit(fixture())['failures'])
 def test_missing_module_is_rejected(self):
  p=fixture();p['drawings'][0]['views'][0]['commands'].pop(2);self.assertTrue(self.audit(p)['failures'])
 def test_detached_connection_is_rejected(self):
  p=fixture();p['drawings'][0]['views'][0]['commands'][-1]['points'][0][0]=9;self.assertTrue(self.audit(p)['failures'])
 def test_overlap_is_rejected(self):
  p=fixture();p['drawings'][0]['views'][0]['commands'][2]['points']=[[3,0],[7,0],[7,3],[3,3]];self.assertTrue(self.audit(p)['failures'])
 def test_self_intersecting_module_is_rejected(self):
  p=fixture();p['drawings'][0]['views'][0]['commands'][1]['points']=[[0,0],[4,3],[0,3],[4,0]];self.assertTrue(self.audit(p)['failures'])
 def test_notes_do_not_replace_module_geometry(self):
  p=fixture();p['drawings'][0]['notes']=['mount_module locate_module fasten_module all correct'];p['drawings'][0]['views'][0]['commands']=p['drawings'][0]['views'][0]['commands'][:1];self.assertTrue(self.audit(p)['failures'])

if __name__=='__main__':unittest.main()
