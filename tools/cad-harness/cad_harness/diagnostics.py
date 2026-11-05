"""Actionable repair advice derived from actual failures, never edits model geometry."""
import math,json
def signature(feedback):
 ids=[]
 def visit(x):
  if isinstance(x,dict):
   if 'id' in x:ids.append(str(x['id']))
   if 'error' in x:ids.append(str(x['error']))
   for k,v in x.items():
    if k!='requirement':visit(v)
  elif isinstance(x,list):
   for v in x:visit(v)
 visit(feedback);return '|'.join(sorted(set(ids)))
def hints(previous,feedback):
 if not previous:return []
 text=json.dumps(feedback,ensure_ascii=False);out=[]
 if 'edge_angle' in text or 'turn_angle' in text:
  out.append('角度修复：不要再次沿用错误斜边两端坐标。profile_path的原生坡边必须用 {"to_y":目标Y,"angle":绝对方向角}；同时给to:[x,y]不会让工具求坡边。先走到斜坡起点，再to_y按角度求终点；向左上是135、向右下315、向右上45、向左下225，按原图选方向。不要通过添加独立参考线充数。')
 if 'circle_pattern' in text:
  out.append('孔修复：分别核对实际center、radius以及孔是否全部落在实体材料内；radius和孔距正确但孔贴在材料外边界，仍会失败。允许扩大未知宽度仅限标明是示意布局；不能移动已知孔心。孔心坐标与定位舌/凹槽坐标必须使用同一视图原点。')
 if 'outline_edges' in text:
  out.append('缺口/台阶修复：反馈edges是实际材料边界的端点坐标。把缺失边按相邻顺序接入同一outline封闭多边形，不能另画line/polyline参考框。保持基体、上方凸起及底部定位舌连成同一不自交材料边界，不要多次往返同一路径。')
 if 'simple_closed_material' in text or 'overlap' in text:
  out.append('轮廓修复：逐段检查V槽口或多边形边是否重叠，禁止绕过simple_closed检查。主边界只绕材料一圈，闭合不重复首点；groove_array会自动切槽，别手工重复画槽。')
  for row in previous.get('drawings',[]):
   for v in row.get('views',[]):
    for c in v.get('commands',[]):
     if c.get('op')=='groove_array' and c.get('mode')=='section':
      a=c.get('angle',60);depth=c.get('depth',0);pitch=c.get('pitch',0);width=2*depth*math.tan(math.radians(a/2))
      if width>pitch and c.get('channels',0)>1:
       out.append(f'{row["source"]}/{v["id"]}: 旧槽口宽由实体参数算得{width:.9g}，超过中心距{pitch:.9g}，相邻槽必重叠。请重新读原图的槽深，不能用整件高度代替槽深；在此夹角下尖底深度必须小于{pitch/(2*math.tan(math.radians(a/2))):.9g}才有正平台。')
 return out
