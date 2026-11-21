// Test data adapter only. Production never synthesizes a model answer.
export function withCoverageFixture(args,raw={items:[],suggestions:[]}){
  const units=args.documents.flatMap(d=>d.units||[]),items=raw.items||[];
  const used=new Set(items.flatMap(i=>[...(i.basis||[]),...(i.evidence||[])].flatMap(r=>r.unitIds||units.filter(u=>r.quote?.includes(u.text)).map(u=>u.id))));
  return {...raw,items,dispositions:[{unitIds:args.documents.flatMap(d=>d.focusIds||[]).filter(id=>!used.has(id)),status:'context',reason:'测试已知材料中的其余上下文'}]};
}
