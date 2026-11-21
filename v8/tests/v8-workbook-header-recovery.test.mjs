import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WorkbookTools} from '../v8-tools/workbook-tools.mjs';
test('invalid guessed header returns original row positions; retry preserves all data and provenance',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'header-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const rows=[['Public registry',null,null],[null,null,null],['ref','supplier','value'],['A','First',12.5],['B','Second',40]];
 const docs={directory,asset:()=>({id:'source',kind:'workbook',path:'original.xlsx'}),inspect:async()=>{},worker:async()=>({sheets:[{name:'register',rows,formulas:[]}]}),results:new Map(),save(){}};
 const tools=new WorkbookTools(docs,{});let error;
 try{await tools.read({asset_id:'source',sheet:'register'},{});}catch(e){error=e;}
 assert.equal(error.code,'INVALID_HEADERS');assert.equal(error.details.preview[2].row,3);assert.deepEqual(error.details.preview[2].values,['ref','supplier','value']);assert.equal(tools.tables.size,0);
 const result=await tools.read({asset_id:'source',sheet:'register',header_row:3},{}),table=tools.tables.get(result.tableId);
 assert.deepEqual(table.rows,rows.slice(3));assert.deepEqual(table.provenance.map(p=>p[0].row),[4,5]);assert.equal(typeof table.rows[0][2],'number');
});
