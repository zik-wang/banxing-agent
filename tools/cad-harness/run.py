import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
p=argparse.ArgumentParser();p.add_argument('--deps',action='append',default=[]);p.add_argument('command',choices=['run','replay','package']);p.add_argument('--job',required=True);p.add_argument('--run-id',default='current');p.add_argument('--resume',action='store_true');p.add_argument('--seed-from-run');p.add_argument('--plan');p.add_argument('--out');p.add_argument('--no-render',action='store_true');args=p.parse_args()
for d in args.deps:sys.path.insert(0,str(Path(d).resolve()))
from cad_harness.storage import read
from cad_harness.runner import run,evaluate,package
if args.command=='run':
 state=run(args.job,args.run_id,args.resume,not args.no_render,args.seed_from_run);print(state);sys.exit(0 if state['status']=='ACCEPTED' else 3 if state['status']=='CHECKS_PASS_SCOPE_LIMITED' else 2)
elif args.command=='package':print(package(args.job,args.run_id))
else:
 if not args.plan or not args.out:p.error('replay requires --plan and --out')
 result=evaluate(read(args.plan),read(Path(args.job)/'contract.json'),Path(args.out),not args.no_render);print(result['status']);sys.exit(2 if result['failures'] else 0 if result['status']=='ACCEPTED' else 3)
