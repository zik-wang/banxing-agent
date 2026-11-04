// Optional offline-suite preloader. Never imported by product code.
import http from 'node:http';
import https from 'node:https';
if(process.env.V8_TEST_LOOPBACK_ONLY!=='1')throw Error('OFFLINE_TEST_GUARD_REQUIRES_EXPLICIT_ENV');
function allowed(input){
 const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input?.hostname||input?.host||'localhost';
 if(!['127.0.0.1','localhost','[::1]','::1'].includes(host))throw Object.assign(Error('Offline test blocked non-loopback network request'),{code:'TEST_NON_LOOPBACK_BLOCKED'});
}
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{allowed(input instanceof Request?input.url:input);return originalFetch(input,options);};
for(const library of [http,https]){const original=library.request;library.request=function(input,...args){allowed(input);return original.call(this,input,...args);};}
