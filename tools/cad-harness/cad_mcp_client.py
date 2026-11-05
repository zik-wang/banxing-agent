"""Small stdio MCP host client. Launches only this project's fixed tool server."""
import json,subprocess,sys,os
from pathlib import Path

class Client:
 def __init__(self,batch,deps,node,control,log):
  self.log=open(log,'a',encoding='utf-8');self.seq=0;self.trace=[];self.inflight=False
  args=[sys.executable,str(Path(__file__).with_name('cad_mcp.py')),'--batch',str(batch),'--node',str(node),'--control',str(control)]
  for p in deps:args+=['--deps',str(p)]
  self.p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
  self.request('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'cad-batch-host','version':'1.0.0'}})
  self.p.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n');self.p.stdin.flush()
 def request(self,method,params):
  self.seq+=1;message={'jsonrpc':'2.0','id':self.seq,'method':method,'params':params}
  self.inflight=True;self.p.stdin.write(json.dumps(message,ensure_ascii=False)+'\n');self.p.stdin.flush();line=self.p.stdout.readline()
  if not line:raise RuntimeError('MCP tool server ended without response')
  r=json.loads(line)
  if r.get('id')!=self.seq or 'error' in r:raise RuntimeError('MCP protocol error')
  self.inflight=False;self.trace.append({'id':self.seq,'method':method,'tool':params.get('name'),'response_received':True})
  return r['result']
 def call(self,name,args=None):
  r=self.request('tools/call',{'name':name,'arguments':args or {}})
  if r.get('isError'):raise RuntimeError('MCP tool rejected operation: '+r['content'][0]['text'])
  return json.loads(r['content'][0]['text'])
 def close(self):
  self.p.stdin.close()
  try:self.p.wait(timeout=15)
  except subprocess.TimeoutExpired:
   if not self.inflight:
    # Only this owned, idle stdio tool server; never interrupt an unknown supplier call.
    self.p.terminate();self.p.wait(timeout=10)
  self.log.close()
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
