import test from 'node:test';import assert from 'node:assert/strict';
import {checkSpreadsheetSourceMode} from '../v8-tools/document-extras.mjs';
const refs=[{asset_id:'pdf',page:1}];
function docs(overrides={}){return {asset:id=>{if(id!=='pdf')throw Error('UNKNOWN_ASSET');return {kind:'pdf'};},results:new Map([['r',{sourceId:'pdf',page:1,method:'pdf_text',answer:'Mixed layout with source values'}]]),...overrides};}
test('mixed-layout export requires explicit interpretation and previously read exact page',()=>{
 assert.throws(()=>checkSpreadsheetSourceMode(docs(),refs),e=>e.code==='SOURCE_RECORDS_REQUIRED');
 assert.doesNotThrow(()=>checkSpreadsheetSourceMode(docs(),refs,'interpreted'));
 assert.throws(()=>checkSpreadsheetSourceMode(docs(),[{asset_id:'pdf',page:2}],'interpreted'),e=>e.code==='SOURCE_PAGE_NOT_READ');
 assert.throws(()=>checkSpreadsheetSourceMode(docs({results:new Map()}),refs,'interpreted'),e=>e.code==='SOURCE_PAGE_NOT_READ');
});
test('interpretation does not bypass expiry ledger, asset permissions or typed workbook path',()=>{
 assert.throws(()=>checkSpreadsheetSourceMode(docs({factProfile:'expiry'}),refs,'interpreted'),e=>e.code==='SOURCE_RECORDS_REQUIRED');
 assert.throws(()=>checkSpreadsheetSourceMode(docs(),[{asset_id:'foreign',page:1}],'interpreted'),/UNKNOWN_ASSET/);
 assert.throws(()=>checkSpreadsheetSourceMode(docs({asset:()=>({kind:'workbook'})}),refs,'interpreted'),e=>e.code==='TYPED_TABLE_REQUIRED');
});
