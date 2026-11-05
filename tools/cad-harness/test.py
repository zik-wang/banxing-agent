"""Run adversarial geometry and state-machine tests without any model calls."""
import sys,tempfile,argparse,unittest,json
from pathlib import Path
r=Path(__file__).resolve().parent;sys.path.insert(0,str(r));p=argparse.ArgumentParser();p.add_argument('--deps',action='append',default=[]);p.add_argument('--report');a=p.parse_args()
for x in a.deps:sys.path.insert(0,str(Path(x).resolve()))
tempfile.tempdir=str(r/'.test-tmp');Path(tempfile.tempdir).mkdir(exist_ok=True)
suite=unittest.defaultTestLoader.discover(str(r/'tests'));result=unittest.TextTestRunner(verbosity=2).run(suite)
if a.report:
 path=Path(a.report);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'tests_run':result.testsRun,'passed_count':result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped),'successful':result.wasSuccessful(),'failures':[str(t) for t,_ in result.failures],'errors':[str(t) for t,_ in result.errors],'skipped':[{'test':str(t),'reason':reason} for t,reason in result.skipped]},indent=2),encoding='utf-8')
sys.exit(not result.wasSuccessful())
