import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scales={'元':1n,'万元':10000n,'亿元':100000000n};
function number(s){if(typeof s==='string')s=s.replaceAll('，',',');if(typeof s!=='string'||s.length>45||! /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s))throw Error('INVALID_DECIMAL');s=s.replaceAll(',','');const neg=s.startsWith('-'),[a,b='']=s.replace('-','').split('.');if(b.length>12)throw Error('DECIMAL_PRECISION_LIMIT');return {n:BigInt(a+b)*(neg?-1n:1n),d:10n**BigInt(b.length)};}
function add(a,b,sign=1n){return {n:a.n*b.d+sign*b.n*a.d,d:a.d*b.d};}
function display(v){const neg=v.n<0n,n=neg?-v.n:v.n,cents=(n*100n+v.d/2n)/v.d,s=String(cents).padStart(3,'0');return (neg&&cents?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);}
function bind(source,term){
 if(typeof term.quote!=='string'||!term.quote||!source.includes(term.quote))throw Error('EVIDENCE_QUOTE_NOT_FOUND');
 const position=term.start??source.indexOf(term.quote);
 if(!Number.isInteger(position)||position<0||source.slice(position,position+term.quote.length)!==term.quote)throw Error('SPAN_MISMATCH');
 if(term.start===undefined&&source.indexOf(term.quote,position+1)!==-1)throw Error('AMBIGUOUS_EVIDENCE_SPAN');
 const inside=term.quote.indexOf(term.value);if(inside<0)throw Error('VALUE_NOT_IN_EVIDENCE');
 const valueStart=position+inside,token=[...source.matchAll(/[-+]?(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d+)?/g)].find(m=>m.index===valueStart&&m[0]===term.value);
 if(!token)throw Error('VALUE_SUBSTRING_NOT_ALLOWED');
 const prefix=source.slice(0,valueStart),clause=prefix.slice(Math.max(...['；',';','。','\n','\r','|','，',','].map(c=>prefix.lastIndexOf(c)))+1);
 if(term.unit){
  const actualUnit=source.slice(valueStart+term.value.length).match(/^\s*(亿元|万元|元)/)?.[1];
  if(!actualUnit)throw Error('UNIT_NOT_IN_EVIDENCE');if(actualUnit!==term.unit)throw Error('UNIT_CONTRADICTS_SOURCE');
  const markers=[...clause.matchAll(/人民币|CNY|USD|美元|EUR|欧元|￥|¥/gi)];
  const marker=markers.at(-1)?.[0].toUpperCase(),currency=marker?(/USD|美元/.test(marker)?'USD':/EUR|欧元/.test(marker)?'EUR':'CNY'):'CNY';
  if(currency!==term.currency)throw Error('CURRENCY_CONTRADICTS_SOURCE');
 }
 return {valueStart,clause};
}
export function calculateMoney(source,plan){
 if(typeof source!=='string'||source.length>500000)throw Error('SOURCE_LIMIT');if(!['sum','subtract','percent'].includes(plan.operation)||!Array.isArray(plan.operands)||!plan.operands.length||plan.operands.length>100)throw Error('INVALID_PLAN');
 const groups=new Map(),bindings=[],used=new Set();for(const t of plan.operands){const bound=bind(source,t);const inside=t.quote.indexOf(t.value);if(t.quote.indexOf(t.value,inside+1)!==-1)throw Error('AMBIGUOUS_VALUE_IN_QUOTE');const valueStart=(t.start??source.indexOf(t.quote))+inside;if(used.has(valueStart))throw Error('DUPLICATE_SOURCE_OPERAND');used.add(valueStart);if(!Object.hasOwn(scales,t.unit))throw Error('UNIT_REQUIRED');if(!t.quote.includes(t.unit))throw Error('UNIT_NOT_IN_EVIDENCE');if(!['CNY','USD','EUR'].includes(t.currency))throw Error('CURRENCY_REQUIRED');if(t.currency==='CNY'&&!/人民币|CNY|元|￥|¥/.test(t.quote)||t.currency==='USD'&&!/USD|美元/.test(t.quote)||t.currency==='EUR'&&!/EUR|欧元/.test(t.quote))throw Error('CURRENCY_NOT_IN_EVIDENCE');const v=number(t.value);v.n*=scales[t.unit];if(t.direction==='deduct'){if(!/退款|退回|扣除|退费/.test(bound.clause))throw Error('DEDUCTION_NOT_IN_EVIDENCE');if(plan.operation!=='sum')throw Error('AMBIGUOUS_DEDUCTION_OPERATION');v.n=-(v.n<0n?-v.n:v.n);}else if(t.direction&&t.direction!=='add')throw Error('INVALID_DIRECTION');const list=groups.get(t.currency)||[];list.push(v);groups.set(t.currency,list);bindings.push({...t,start:t.start??source.indexOf(t.quote),end:(t.start??source.indexOf(t.quote))+t.quote.length});}
 if(plan.operation!=='sum'&&groups.size!==1)throw Error('CROSS_CURRENCY_OPERATION_DENIED');if(plan.operation==='percent'&&(plan.operands.length!==1||!plan.rate))throw Error('PERCENT_REQUIRES_ONE_BASE_AND_RATE');
 let rate;if(plan.operation==='percent'){const bound=bind(source,plan.rate);if(!/^\s*[%％]/.test(source.slice(bound.valueStart+plan.rate.value.length)))throw Error('RATE_NOT_IN_EVIDENCE');rate=number(plan.rate.value);}
 const results=[...groups].map(([currency,vs])=>{let v=vs[0];for(let i=1;i<vs.length;i++)v=add(v,vs[i],plan.operation==='subtract'?-1n:1n);if(rate)v={n:v.n*rate.n,d:v.d*rate.d*100n};return {currency,amount:display(v),unit:'元'};});
 const receipt={version:'money-rational-v1',sourceSha256:hash(source),planSha256:hash(plan),operation:plan.operation,bindings,rate:plan.rate||null,results,rounding:'calculate exact rational, round half up once to 2 decimals; currency minor unit assumed 0.01',scope:'Only the submitted operands were calculated; source completeness and choice of tax/payment basis require separate checks.'};return {...receipt,receiptId:'MONEY-'+hash(receipt)};
}
export function verifyMoneyClaims(receipt,claims){return Array.isArray(claims)&&claims.length===receipt.results.length&&new Set(claims.map(x=>x.currency)).size===claims.length&&claims.every(c=>c.receiptId===receipt.receiptId&&receipt.results.some(r=>r.currency===c.currency&&r.amount===c.amount));}
export function moneyReport(receipt){return ['金额核算结果',...receipt.results.map(r=>`${r.currency} ${r.amount}（统一以原币元计）`),'取数依据',...receipt.bindings.map(b=>`${b.label||'金额项'}：${b.value}${b.unit}；${b.direction==='deduct'?'扣减':'计入'}；原文「${b.quote}」`),...(receipt.rate?[`比例原文「${receipt.rate.quote}」`]:[]),'计算回执：'+receipt.receiptId,'范围：仅对以上取数执行计算；未证明原件完整、取数口径正确或具备付款/报销资格。不同币种不作汇率折算。'].join('\n\n');}
export function moneyTool(source,receipts=[]){return {name:'calculate_money',description:'Exact source-bound money arithmetic. Never infer tax basis, missing units or FX rates. Returns receipt IDs for final citation.',inputSchema:{type:'object',properties:{operation:{type:'string',enum:['sum','subtract','percent']},operands:{type:'array',minItems:1,maxItems:100,items:{type:'object',properties:{value:{type:'string'},unit:{type:'string',enum:['元','万元','亿元']},currency:{type:'string',enum:['CNY','USD','EUR']},quote:{type:'string'},start:{type:'integer',minimum:0,maximum:500000},label:{type:'string'},direction:{type:'string',enum:['add','deduct']}},required:['value','unit','currency','quote'],additionalProperties:false}},rate:{type:'object',properties:{value:{type:'string'},quote:{type:'string'}},required:['value','quote'],additionalProperties:false}},required:['operation','operands'],additionalProperties:false},execute:async plan=>{const r=calculateMoney(source,plan);receipts.push(r);return r;}};}
