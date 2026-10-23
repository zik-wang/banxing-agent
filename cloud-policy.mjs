import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const cloudRuleHash=text=>createHash('sha256').update(text||'').digest('hex');
export function assertCloudTaskAllowed(harness,files,rules,args){
 const provider=harness?.modelStatus?.()?.provider;
 if(!['siliconflow','cloud'].includes(provider))return {provider:provider||'unknown',applies:false};
 if(!Array.isArray(files)||!files.length)throw Object.assign(Error('公网调用阻断：授权来源不能为空'),{code:'CLOUD_SCOPE_DENIED'});
 const policyFile=process.env.V7_PUBLIC_TEST_GRANTS||'D:/pro222/personal-agent-v7/.local-runtime/public-test-grants.json';
 let policy;try{policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));}catch{throw Object.assign(Error('公网调用阻断：缺少服务端批准的公开/合成测试授权清单'),{code:'CLOUD_SCOPE_DENIED'});}
 if(policy.version!=='v7-p2-public-grants-1'||!Array.isArray(policy.grants))throw Object.assign(Error('公网授权清单无效'),{code:'CLOUD_SCOPE_DENIED'});
 const grant=policy.grants.find(g=>g.revoked!==true&&['public','synthetic'].includes(g.classification)&&g.ruleHashes?.includes(cloudRuleHash(rules))&&files.every(f=>g.files?.some(a=>a.id===f.id&&a.sha256===f.sha256)));
 if(!grant)throw Object.assign(Error('公网调用阻断：所选材料或执行规则不在批准的公开/合成测试范围'),{code:'CLOUD_SCOPE_DENIED'});
 if(args){const allowed=new Set(files.map(f=>f.id));for(const d of args.documents||[]){if(d.id!=='page-batch'&&!allowed.has(d.id)||d.units?.some(u=>u.sourceId&&!allowed.has(u.sourceId)))throw Object.assign(Error('公网调用阻断：模型输入包含未授权来源'),{code:'CLOUD_SCOPE_DENIED'});}}
 return {provider:'cloud',grantId:grant.id,classification:grant.classification};
}
