import fs from 'node:fs';import path from 'node:path';
export const isCloudProvider=p=>['cloud','siliconflow','iteracompute'].includes(p);
const webClouds={iteracompute:{baseUrl:'https://api.iteracompute.com/v1',workspaceId:'external-iteracompute'},siliconflow:{baseUrl:'https://api.siliconflow.cn/v1',workspaceId:'external-siliconflow'}};
export const isApprovedWebCloud=chat=>!!(chat&&webClouds[chat.provider]?.baseUrl===chat.baseUrl);
export function apiKeyFor(config={}){if(config.apiKeyFile){const data=JSON.parse(fs.readFileSync(config.apiKeyFile,'utf8'));if(typeof data.apiKey!=='string'||!data.apiKey.trim())throw Error('Model API key file is empty');return data.apiKey;}if(config.apiKeyEnv){const key=process.env[config.apiKeyEnv];if(!key)throw Error('Configured model credential environment variable is missing');return key;}return config.apiKey;}
export function checkWebProfile(config){
 if(config.chat?.provider==='intranet'&&/^http:\/\/10\./.test(config.chat.baseUrl))return;
 if(!isApprovedWebCloud(config.chat)||config.externalWorkspace!==true||config.workspaceId!==webClouds[config.chat.provider].workspaceId)throw Error('External model requires the fixed HTTPS provider and an isolated external workspace');
 const root=path.resolve(config.dataRoot),marker=path.join(root,'external-workspace.json');
 if(fs.existsSync(path.join(root,'web-state.json'))&&!fs.existsSync(marker))throw Error('Cannot attach an external model to an existing internal workspace');
 if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).provider!==config.chat.provider)throw Error('External workspace provider mismatch');
 fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(marker))fs.writeFileSync(marker,JSON.stringify({provider:config.chat.provider,workspaceId:config.workspaceId,purpose:'User explicitly supplied an external API key. New inputs may be sent to this provider; original internal workspace was not imported.'},null,2),{flag:'wx'});
 apiKeyFor(config.chat);
}
