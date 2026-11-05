"""Local stdio MCP tool server; no shell tool, uploads, credential loader, or arbitrary paths."""
import sys,json,argparse,shutil,contextlib
from pathlib import Path

ROOT=Path(__file__).resolve().parent

class Server:
 def __init__(self,batch):self.batch=batch;self.initialized=False;self.ready=False
 def dispatch(self,message):
  if not isinstance(message,dict) or message.get('jsonrpc')!='2.0' or not isinstance(message.get('method'),str):return {'jsonrpc':'2.0','id':message.get('id') if isinstance(message,dict) else None,'error':{'code':-32600,'message':'Invalid Request'}}
  method=message['method'];mid=message.get('id');params=message.get('params') or {}
  def result(value):return {'jsonrpc':'2.0','id':mid,'result':value}
  def error(code,msg):return {'jsonrpc':'2.0','id':mid,'error':{'code':code,'message':msg}}
  if method=='notifications/initialized':self.ready=self.initialized;return None
  if mid is None:return None
  if method=='initialize':
   self.initialized=True
   requested=params.get('protocolVersion');version=requested if requested in ['2024-11-05','2025-03-26','2025-06-18'] else '2025-06-18'
   return result({'protocolVersion':version,'capabilities':{'tools':{}},'serverInfo':{'name':'cad-frozen-batch','version':'1.0.0'}})
  if method=='ping':return result({})
  if not self.ready:return error(-32000,'Initialize and send notifications/initialized first')
  if method=='tools/list':
   return result({'tools':[
    {'name':'cad_batch_status','description':'Read frozen batch counts, actual model receipts and blockers. Does not expose reference geometry.','inputSchema':{'type':'object','properties':{},'additionalProperties':False},'annotations':{'readOnlyHint':True}},
    {'name':'cad_verify_candidate','description':'Compile one JSON plan and check real DXF units, dimensions, boundaries, holes and functional graph. Candidate checks do not count as model generations.','inputSchema':{'type':'object','properties':{'case_id':{'type':'string'},'plan':{'type':'object'}},'required':['case_id','plan'],'additionalProperties':False}},
    {'name':'cad_run_next','description':'One real DeepSeek image+brief request for the next authorized case, max one per case / 20 total. Stops on auth, capability, 429, uncertain transport, pause or deadline. No retry.','inputSchema':{'type':'object','properties':{},'additionalProperties':False},'annotations':{'readOnlyHint':False,'destructiveHint':False,'idempotentHint':False,'openWorldHint':True}}]})
  if method=='tools/call':
   name=params.get('name');args=params.get('arguments',{})
   try:
    if name=='cad_batch_status' and not args:value=self.batch.status()
    elif name=='cad_run_next' and not args:value=self.batch.run_next()
    elif name=='cad_verify_candidate' and isinstance(args,dict) and set(args)=={'case_id','plan'}:value=self.batch.tool_verify(args['case_id'],args['plan'])
    else:return error(-32602,'Unknown tool or invalid arguments')
    return result({'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False,allow_nan=False)}],'isError':False})
   except Exception as exc:
    # Do not stringify arbitrary network/credential errors into the MCP channel.
    from cad_harness.single_pass_batch import BatchBlocked
    detail=str(exc)[:300] if isinstance(exc,(BatchBlocked,ValueError)) else type(exc).__name__
    return result({'content':[{'type':'text','text':detail}],'isError':True})
  return error(-32601,'Method not found')

def serve(server,stdin,stdout):
 while True:
  line=stdin.readline(8*1024*1024+1)
  if not line:break
  if len(line)>8*1024*1024:raise ValueError('MCP message limit exceeded')
  try:
   msg=json.loads(line)
   with contextlib.redirect_stdout(sys.stderr):reply=server.dispatch(msg)
  except (ValueError,TypeError):reply={'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':'Parse error'}}
  if reply is not None:stdout.write(json.dumps(reply,ensure_ascii=False,allow_nan=False)+'\n');stdout.flush()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--batch',required=True);p.add_argument('--deps',action='append',default=[]);p.add_argument('--node',default=shutil.which('node'));p.add_argument('--control',required=True);a=p.parse_args()
 sys.path[:0]=[str(ROOT)]+a.deps
 from cad_harness.single_pass_batch import Batch,LocalControl
 if not a.node:p.error('Node executable required for local control')
 sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
 serve(Server(Batch(a.batch,LocalControl(a.node,a.control))),sys.stdin,sys.stdout)
