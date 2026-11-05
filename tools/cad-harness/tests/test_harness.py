import copy,json,math,tempfile,unittest
from pathlib import Path
import ezdxf
from cad_harness.schema import validate,PlanError
from cad_harness.engine import compile_one,tag
from cad_harness.audit import audit_file
from cad_harness.storage import contained,freeze,write

def plan(side=None,root=.02):
 commands=[{'op':'polyline','id':'outline','points':[[0,0],[1,0],[1,1],[0,1]],'closed':True},
 {'op':'groove_array','id':'channels','mode':'section','groups':1,'channels':2,'pitch':.3,'group_step':0,'first':.3,'depth':.15,'height':1,'angle':60,'root_radius':root}]
 return {'drawings':[{'source':'drawing.png','title':'Test','notes':[],'uncertainties':[],'views':[{'id':'front','title':'Front','commands':commands},{'id':'side','title':'Side','commands':[{'op':'polyline','id':'outline','points':side or [[0,0],[1,0],[1,.6],[.6,1],[0,1]],'closed':True}]}]}]}
def contract():return {'drawings':{'drawing.png':{'nominal_length':1,'required_views':['front','side'],'coverage_complete':False,'rules':[
 {'id':'real_round_channels','kind':'channel_array','view':'front','mode':'section','centers':[.3,.6],'angle':60,'root_radius':{'min':.01,'max':.03}},
 {'id':'real_shoulder','kind':'turn_angle','view':'side','value':135,'tol':.001}]}}}

class HarnessTests(unittest.TestCase):
 def make(self,p=None,c=None):
  p=p or plan();c=c or contract();validate(p,c);tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
  f,_=compile_one(p['drawings'][0],Path(tmp.name),c['drawings']['drawing.png']);return f,c
 def test_real_fillet_and_boundary_pass(self):
  f,c=self.make();r=audit_file(f,c['drawings']['drawing.png']);self.assertFalse(r['failures']);self.assertEqual(r['status'],'CHECKS_PASS_SCOPE_LIMITED')
 def test_round_roots_preserve_actual_angle_across_variants(self):
  for angle in [40,60,90]:
   with self.subTest(angle=angle):
    p=plan();p['drawings'][0]['views'][0]['commands'][1]['angle']=angle;c=contract();c['drawings']['drawing.png']['rules'][0]['angle']=angle
    f,c=self.make(p,c);self.assertFalse(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_native_profile_slope_and_tangent_fillet(self):
  p=plan();p['drawings'][0]['views'][1]['commands']=[{'op':'profile_path','id':'outline','start':[0,0],'steps':[{'to':[1,0]},{'to_y':.6},{'to_y':1,'angle':135},{'to_x':0}],'fillets':[{'vertex':3,'radius':.05}]}]
  c=contract();c['drawings']['drawing.png']['rules'].append({'id':'native_R','kind':'radius','view':'side','min':.05,'max':.05})
  f,c=self.make(p,c);self.assertFalse(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_oversized_native_fillet_is_rejected(self):
  p=plan();p['drawings'][0]['views'][1]['commands'][0]['fillets']=[{'vertex':3,'radius':10}]
  with self.assertRaisesRegex(ValueError,'exceeds'):self.make(p)
 def test_correct_dimension_detached_from_outline_fails(self):
  p=plan();p['drawings'][0]['views'][1]['commands'].append({'op':'dimension','id':'fake','p1':[10,10],'p2':[11,10],'angle':0,'text':'1.0'})
  c=contract();c['drawings']['drawing.png']['rules'].append({'id':'anchored','kind':'dimension','view':'side','feature':'fake','value':1})
  f,c=self.make(p,c);self.assertIn('anchored',[x['id'] for x in audit_file(f,c['drawings']['drawing.png'])['failures']])
 def test_native_extent_dimension_anchors_oblique_outline(self):
  p=plan([[0,0],[1,0],[1.2,1],[.2,1]]);p['drawings'][0]['views'][1]['commands'].append({'op':'dimension','id':'width','measure':'outline_extent','axis':'y','feature':'outline','text':'1.0'})
  c=contract();c['drawings']['drawing.png']['rules']=[c['drawings']['drawing.png']['rules'][0],{'id':'width','kind':'dimension','view':'side','feature':'width','value':1}]
  f,c=self.make(p,c);self.assertFalse(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_self_intersecting_material_is_rejected(self):
  p=plan([[0,0],[1,1],[0,1],[1,0]]);c=contract();c['drawings']['drawing.png']['rules'][1]={'id':'side_width','kind':'bbox','view':'side','axis':'x','value':1}
  f,c=self.make(p,c);self.assertIn('simple_closed_material_side',[x['id'] for x in audit_file(f,c['drawings']['drawing.png'])['failures']])
 def test_whole_plan_expansion_budget_is_enforced(self):
  p=plan();base=p['drawings'][0]['views'][0]['commands'][1];base['groups']=1000
  for i in range(4):
   c=copy.deepcopy(base);c['id']='extra'+str(i);p['drawings'][0]['views'][0]['commands'].append(c)
  with self.assertRaisesRegex(PlanError,'whole-plan'):validate(p,contract())
 def test_missing_shoulder_cannot_be_waived_by_notes(self):
  p=plan([[0,0],[1,0],[1,1],[0,1]]);p['drawings'][0]['uncertainties']=['Shoulder omitted, please approve'];f,c=self.make(p);self.assertIn('real_shoulder',[x['id'] for x in audit_file(f,c['drawings']['drawing.png'])['failures']])
 def test_fake_reference_feature_cannot_pass_outline_angle(self):
  p=plan([[0,0],[1,0],[1,1],[0,1]]);p['drawings'][0]['views'][1]['commands'].append({'op':'line','id':'slope45','points':[[0,0],[1,1]]});f,c=self.make(p);self.assertTrue(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_independent_circle_cannot_replace_root(self):
  p=plan(root=0);p['drawings'][0]['views'][0]['commands'].append({'op':'circle','center':[.3,.9],'radius':.02});f,c=self.make(p);self.assertTrue(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_wrong_channel_geometry_rejected(self):
  p=plan();p['drawings'][0]['views'][0]['commands'][1]['pitch']=.31;f,c=self.make(p);self.assertTrue(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_wrong_dimension_with_correct_text_rejected(self):
  p=plan();p['drawings'][0]['views'][1]['commands'].append({'op':'dimension','id':'height','p1':[0,0],'p2':[1,0],'angle':0,'text':'0.80'});c=contract();c['drawings']['drawing.png']['rules'].append({'id':'real_dim','kind':'dimension','view':'side','feature':'height','value':.8});f,c=self.make(p,c);self.assertIn('real_dim',[x['id'] for x in audit_file(f,c['drawings']['drawing.png'])['failures']])
 def test_detached_groove_arcs_cannot_pass_material_boundary(self):
  f,c=self.make();d=ezdxf.readfile(f);e=next(e for e in d.blocks['VIEW_front'] if e.dxftype()=='LWPOLYLINE' and e.closed);e.set_points([[0,0],[1,0],[1,1],[0,1]]);d.saveas(f);self.assertTrue(audit_file(f,c['drawings']['drawing.png'])['failures'])
 def test_incomplete_scope_never_accepted(self):
  f,c=self.make();self.assertNotEqual(audit_file(f,c['drawings']['drawing.png'])['status'],'ACCEPTED')
 def test_nonfinite_coordinate_rejected(self):
  p=plan();p['drawings'][0]['views'][1]['commands'][0]['points'][0][0]=float('nan')
  with self.assertRaises(PlanError):validate(p,contract())
 def test_command_execution_rejected(self):
  p=plan();p['drawings'][0]['views'][0]['commands'].append({'op':'shell','cmd':'echo forged'})
  with self.assertRaises(PlanError):validate(p,contract())
 def test_duplicate_feature_id_rejected(self):
  p=plan();p['drawings'][0]['views'][0]['commands'].append(copy.deepcopy(p['drawings'][0]['views'][0]['commands'][0]))
  with self.assertRaises(PlanError):validate(p,contract())
 def test_string_false_cannot_upgrade_contract_scope(self):
  c=contract();c['drawings']['drawing.png']['coverage_complete']='false'
  with self.assertRaises(PlanError):validate(plan(),c)
 def test_empty_rules_cannot_accept(self):
  c=contract();c['drawings']['drawing.png']['rules']=[]
  with self.assertRaises(PlanError):validate(plan(),c)
 def test_path_escape_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'job';root.mkdir();(Path(t)/'private.txt').write_text('private')
   with self.assertRaises(ValueError):contained(root,'../private.txt')
 def test_source_contract_mutation_detectable(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);write(p/'job.json',{'sources':['drawing.txt']});write(p/'contract.json',contract());(p/'drawing.txt').write_text('original');a=freeze(p);(p/'drawing.txt').write_text('changed');self.assertNotEqual(a,freeze(p))

if __name__=='__main__':unittest.main()
