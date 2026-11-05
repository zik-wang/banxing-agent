import copy,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from cad_harness.engine import compile_one
from cad_harness.audit import audit_file
from cad_harness.provider import invoke
from cad_harness.schema import validate,PlanError
from test_provider import Response

class WebGeometryTests(unittest.TestCase):
 def measure(self,commands,rule):
  spec={'nominal_length':10,'required_views':['front'],'coverage_complete':False,'rules':[{'id':'pattern','view':'front',**rule}]}
  row={'source':'test.png','title':'Test','views':[{'id':'front','title':'Front','commands':commands}]}
  with tempfile.TemporaryDirectory() as t:
   f,_=compile_one(row,Path(t),spec);return audit_file(f,spec)
 def body(self):return [{'op':'polyline','id':'outline','points':[[0,0],[10,0],[10,10],[0,10]],'closed':True}]
 def test_unlabelled_real_holes_pass(self):
  c=self.body()+[{'op':'circle','center':[3,5],'radius':1},{'op':'circle','center':[7,5],'radius':1}]
  self.assertFalse(self.measure(c,{'kind':'circle_pattern','radii':[1,1],'pair_spacing':4})['failures'])
 def test_correct_hole_labels_cannot_replace_real_diameter(self):
  c=self.body()+[{'op':'circle','id':'diameter2','center':[3,5],'radius':.8}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1]})['failures'])
 def test_hole_spacing_is_measured(self):
  c=self.body()+[{'op':'circle','center':[3,5],'radius':1},{'op':'circle','center':[7.1,5],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1,1],'pair_spacing':4})['failures'])
 def test_hole_pair_rotation_is_not_equivalent(self):
  c=self.body()+[{'op':'circle','center':[3,3],'radius':1},{'op':'circle','center':[3,7],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1,1],'pair_spacing':4,'pair_axis':'x'})['failures'])
 def test_holes_above_box_do_not_pass_below_relationship(self):
  c=self.body()+[{'op':'circle','center':[3,3],'radius':1},{'op':'circle','center':[7,3],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1,1],'below_feature':'outline'})['failures'])
 def test_real_connected_fiber_bundle_required(self):
  rule={'kind':'line_bundle','base':'outline','axis':'x','side':'max','count':8,'min_run':5}
  c=self.body()+[{'op':'line','points':[[10,y],[20,y]]} for y in range(1,9)]
  self.assertFalse(self.measure(c,rule)['failures'])
  c[-1]['points']=[[11,8],[20,8]];self.assertTrue(self.measure(c,rule)['failures'])
 def test_concentric_rim_requires_same_center(self):
  rule={'kind':'circle_relationship','max_radius':5,'min_wall':.1}
  c=self.body()+[{'op':'circle','center':[5,5],'radius':1},{'op':'circle','center':[6,5],'radius':2}]
  self.assertTrue(self.measure(c,rule)['failures'])
  c[-1]['center']=[5,5];self.assertFalse(self.measure(c,rule)['failures'])
 def test_fastener_projection_rejects_extra_displaced_circles(self):
  c=self.body()+[{'op':'circle','center':[5,5],'radius':1},{'op':'circle','center':[5,5],'radius':2},{'op':'circle','center':[8,5],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_relationship','max_radius':2.5,'all_concentric':True})['failures'])
 def test_corresponding_extents_must_match_actual_geometry(self):
  c=self.body()+[{'op':'polyline','id':'second','points':[[0,0],[9,0],[9,10],[0,10]],'closed':True}]
  rule={'kind':'same_extent','other_view':'front','other_feature':'second','axis':'x'}
  self.assertTrue(self.measure(c,rule)['failures'])
  c[-1]['points'][1][0]=10;c[-1]['points'][2][0]=10;self.assertFalse(self.measure(c,rule)['failures'])
 def test_missing_or_off_center_protrusion_is_rejected(self):
  rule={'kind':'upper_profile','level':10,'width_min':1.999,'width_max':2.001,'centered':True}
  self.assertTrue(self.measure(self.body(),rule)['failures'])
  c=[{'op':'polyline','id':'outline','points':[[0,0],[10,0],[10,10],[6,10],[6,12],[4,12],[4,10],[0,10]],'closed':True}]
  self.assertFalse(self.measure(c,rule)['failures'])
  for p in c[0]['points'][3:7]:p[0]-=2
  self.assertTrue(self.measure(c,rule)['failures'])
 def test_exact_hole_count_rejects_extra(self):
  c=self.body()+[{'op':'circle','center':[x,5],'radius':1} for x in [2,5,8]]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1,1],'exact':True})['failures'])
 def test_translated_holes_cannot_pass_known_centers(self):
  c=self.body()+[{'op':'circle','center':[3,5],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1],'centers':[[4,5]]})['failures'])
 def test_detached_holes_cannot_pass_material_containment(self):
  c=self.body()+[{'op':'circle','center':[11,5],'radius':1}]
  self.assertTrue(self.measure(c,{'kind':'circle_pattern','radii':[1],'material_contained':True})['failures'])
 def test_actual_outline_edges_pass_but_reference_lines_do_not(self):
  rule={'kind':'outline_edges','edges':[[[0,0],[10,0]]]}
  self.assertFalse(self.measure(self.body(),rule)['failures'])
  c=self.body()+[{'op':'line','id':'fakeShoulder','points':[[0,5],[10,5]]}]
  self.assertTrue(self.measure(c,{'kind':'outline_edges','edges':[[[0,5],[10,5]]]})['failures'])
 def test_plan_width_does_not_require_unused_depth(self):
  c=self.body()+[{'op':'groove_array','id':'channels','mode':'plan','groups':1,'channels':1,'pitch':1,'group_step':0,'first':5,'depth':0,'width':.2,'height':0,'angle':90,'run_start':0,'run_end':10}]
  rule={'kind':'channel_array','mode':'plan','relative':True,'centers':[0],'run':[0,10]}
  spec={'drawings':{'test.png':{'coverage_complete':False,'required_views':['front'],'rules':[{'id':'array','view':'front',**rule}]}}}
  validate({'drawings':[{'source':'test.png','views':[{'id':'front','commands':c}]}]},spec)
  self.assertFalse(self.measure(c,rule)['failures'])
 def test_plan_channels_outside_material_fail_even_with_correct_count(self):
  c=self.body()+[{'op':'groove_array','id':'channels','mode':'plan','groups':1,'channels':1,'pitch':1,'group_step':0,'first':11,'depth':.1,'angle':90,'run_start':0,'run_end':10}]
  self.assertTrue(self.measure(c,{'kind':'channel_array','mode':'plan','relative':True,'centers':[0]})['failures'])
 def test_relative_groove_pattern_allows_unspecified_edge_offset(self):
  c=self.body()+[{'op':'groove_array','id':'channels','mode':'section','groups':1,'channels':2,'pitch':1,'group_step':0,'first':3.7,'height':10,'depth':.3,'angle':70.52}]
  rule={'kind':'channel_array','mode':'section','relative':True,'centers':[0,1],'angle':70.52}
  self.assertFalse(self.measure(c,rule)['failures'])
  c[-1]['pitch']=1.1;self.assertTrue(self.measure(c,rule)['failures'])
 def test_true_circular_material_outline_passes(self):
  c=[{'op':'polyline','id':'outline','points':[[1,0,1],[-1,0,1]],'closed':True},{'op':'circle','center':[0,0],'radius':1}]
  self.assertFalse(self.measure(c,{'kind':'circle_pattern','radii':[1]})['failures'])
 def test_outer_circle_must_coincide_with_actual_round_material(self):
  c=[{'op':'polyline','id':'outline','points':[[1,0,1],[-1,0,1]],'closed':True},{'op':'circle','center':[0,2],'radius':1}]
  rule={'kind':'circle_pattern','radii':[1],'boundary_circle':True}
  self.assertTrue(self.measure(c,rule)['failures'])
  c[-1]['center']=[0,0];self.assertFalse(self.measure(c,rule)['failures'])
 def test_private_numeric_contract_is_absent_from_actual_request(self):
  contract={'model_instructions':['Read the image.'],'drawings':{'a.png':{'required_views':['front'],'rules':[{'kind':'bbox','view':'front','axis':'x','value':123.456789}]}}}
  reply={'usage':{'total_tokens':1},'choices':[{'finish_reason':'stop','message':{'content':'{"drawings":[]}'}}]};requests=[]
  def http(req,timeout):requests.append(json.loads(req.data));return Response(reply)
  with tempfile.TemporaryDirectory() as t,patch.dict(os.environ,{'DEEPSEEK_API_KEY':'TEST'}),patch('cad_harness.provider.materials',return_value=[]),patch('urllib.request.urlopen',side_effect=http):
   invoke(Path(t),{'sources':[],'expose_contract':False},contract,None,[],Path(t),10000)
   record=json.loads((Path(t)/'request.json').read_text(encoding='utf-8'))
  self.assertNotIn('123.456789',json.dumps(requests));self.assertFalse(record['contract_values_exposed'])
