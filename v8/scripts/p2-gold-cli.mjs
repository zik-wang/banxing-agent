import fs from 'node:fs';
import {recordAnnotation,adjudicateReference,scoreGoldCase,validateReferenceFact} from '../src/evidence/gold-benchmark.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const [command,...args]=process.argv.slice(2);
try{
 if(command==='annotate'){const receipt=recordAnnotation(read(args[0]),args[1]);console.log(JSON.stringify(receipt));}
 else if(command==='validate'){const packet=read(args[0]),errors=(packet.facts||[]).flatMap(validateReferenceFact);console.log(JSON.stringify({errors}));if(errors.length)process.exitCode=2;}
 else if(command==='adjudicate'){const result=adjudicateReference(read(args[0]),read(args[1]),read(args[2]));fs.writeFileSync(args[3],JSON.stringify(result,null,2),{flag:'wx'});}
 else if(command==='score'){const result=scoreGoldCase(read(args[0]),read(args[1]));fs.writeFileSync(args[2],JSON.stringify(result,null,2));}
 else throw Error('Usage: annotate packet.json directory | validate packet.json | adjudicate case.json annotations.json resolution.json output.json | score case.json prediction.json output.json');
}catch(error){console.error(error.message);process.exitCode=1;}
