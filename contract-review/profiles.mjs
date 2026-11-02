import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fingerprint} from './protocol.mjs';
const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'profiles');
export function validateProfile(value){
 if(!value||value.schemaVersion!==1||typeof value.id!=='string'||typeof value.version!=='string'||!Array.isArray(value.checks)||!value.checks.length||value.checks.length>40)throw Error('REVIEW_PROFILE_INVALID');
 const allowed=['schemaVersion','id','version','title','contract_type','region','scope_description','title_pattern','checks','cross_checks','program_check_map','local_signal_checks'];
 if(Object.keys(value).some(k=>!allowed.includes(k)))throw Error('REVIEW_PROFILE_AUTHORITY_FIELD_DENIED');
 if(new Set(value.checks.map(c=>c.id)).size!==value.checks.length)throw Error('REVIEW_PROFILE_DUPLICATE_CHECK');
 for(const c of value.checks){if(!/^[A-Z][A-Z0-9_-]{1,30}$/.test(c.id)||['title','pattern','trigger','safeguards','consequence','acceptable_alternative','positive_example','negative_example'].some(k=>typeof c[k]!=='string'||!c[k].trim()))throw Error('REVIEW_PROFILE_CRITERIA_REQUIRED');new RegExp(c.pattern);}
 if(!Array.isArray(value.cross_checks)||value.cross_checks.some(c=>typeof c.title!=='string'||typeof c.pattern!=='string'))throw Error('REVIEW_PROFILE_CROSS_CHECK_INVALID');
 const ids=new Set(value.checks.map(c=>c.id));if(Object.values(value.program_check_map||{}).some(id=>!ids.has(id))||Object.values(value.local_signal_checks||{}).some(id=>!ids.has(id)))throw Error('REVIEW_PROFILE_MAPPING_INVALID');
 return {...value,sha256:fingerprint(value)};
}
export function loadReviewProfile(id='equipment_purchase_cn',file){
 const name={equipment_purchase_cn:'equipment-cn',service_cn:'service-cn',basic_cn:'basic-cn'}[id];
 if(!file&&!name)throw Error('UNKNOWN_REVIEW_PROFILE');
 return validateProfile(JSON.parse(fs.readFileSync(file||path.join(directory,name+'.json'),'utf8').replace(/^\uFEFF/,'')));
}
export function detectReviewType(text){
 const head=String(text).split('\n').slice(0,12).join('\n');
 if(/(?:设备|仪器|仪表|机电).{0,12}(?:采购|购销|买卖).{0,8}(?:合同|协议)|(?:采购|购销|买卖).{0,12}(?:设备|仪器).{0,8}合同/.test(head))return 'equipment_purchase_cn';
 if(/(?:软件|技术|咨询|运维|维护|信息|项目)?.{0,6}服务(?:合同|协议)/.test(head))return 'service_cn';
 return 'basic_cn';
}
export function profileScope(documents,context,profile){
 const primary=documents.filter(d=>d.role==='contract');
 const scope={state:'supported',contractType:profile.contract_type,region:context.region,stance:context.stance,materialScope:'unknown',coverage:profile.scope_description,evidence:[]};
 if(context.region!==profile.region||!['buyer','seller','neutral'].includes(context.stance))return {...scope,state:'unsupported',reason:'地区或立场不在已配置审核范围内。'};
 if(primary.length!==1)return {...scope,state:'needs_clarification',reason:'必须选择一份主合同，其余材料作为附件。'};
 const units=primary[0].units,text=units.map(u=>u.raw_text).join('\n'),detected=detectReviewType(text);
 if(/不是完整|公开节录|公开案例|合同.{0,3}节录|仅.{0,12}节录/.test(text))scope.materialScope='excerpt';
 if(profile.contract_type!=='basic_cn'&&detected!==profile.contract_type)return {...scope,state:'needs_clarification',reason:'主合同标题与本次配置类型不符；未执行不匹配的专项清单。',detectedType:detected};
 scope.evidence=units.slice(0,5).map(u=>({unit_id:u.id,text:u.raw_text}));
 if(profile.contract_type==='basic_cn')scope.reason='仅执行基础文本与义务核查；未声称覆盖该合同类型的全部专项风险。';
 return scope;
}
