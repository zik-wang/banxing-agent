import fs from 'node:fs';import path from 'node:path';
export const isCloudProvider=p=>['cloud','siliconflow','iteracompute'].includes(p);
export function apiKeyFor(config={}){if(config.apiKeyFile){const data=JSON.parse(fs.readFileSync(config.apiKeyFile,'utf8'));if(typeof data.apiKey!=='string'||!data.apiKey.trim())throw Error('Model API key file is empty');return data.apiKey;}if(config.apiKeyEnv){const key=process.env[config.apiKeyEnv];if(!key)throw Error('Configured model credential environment variable is missing');return key;}return config.apiKey;}
export function checkWebProfile(config){
 if(config.chat?.provider==='intranet'&&/^http:\/\/10\./.test(config.chat.baseUrl))return;
 if(config.chat?.provider!=='iteracompute'||config.chat.baseUrl!=='https://api.iteracompute.com/v1'||config.externalWorkspace!==true||config.workspaceId!=='external-iteracompute')throw Error('External model requires the fixed HTTPS provider and an isolated external workspace');
 const root=path.resolve(config.dataRoot),marker=path.join(root,'external-workspace.json');
 if(fs.existsSync(path.join(root,'web-state.json'))&&!fs.existsSync(marker))throw Error('Cannot attach an external model to an existing internal workspace');
 if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).provider!=='iteracompute')throw Error('External workspace provider mismatch');
 fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(marker))fs.writeFileSync(marker,JSON.stringify({provider:'iteracompute',workspaceId:config.workspaceId,purpose:'User explicitly supplied an external API key. New inputs may be sent to this provider; original internal workspace was not imported.'},null,2),{flag:'wx'});
 apiKeyFor(config.chat);
}
