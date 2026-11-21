import {deploymentInvoiceOptions as baseOptions} from '../integrations/intranet-only.mjs';
// 09 owns this narrow adapter. The shared deployment guard continues disabling
// legacy cloud/local overrides. Only an explicit validated remote 09 can pass.
export function deploymentInvoiceOptions(directory,{factory,status}){
 if(directory.intranetOnly){const current=status?.();if(current?.configured&&current.provider==='intranet'&&current.localModelsEnabled===false&&current.ocrTransport==='intranet-http')return {invoiceRuntimeStatus:status,invoiceRuntimeFactory:(...args)=>{const runtime=factory(...args);if(runtime?.descriptor?.provider!=='intranet'||runtime.descriptor.localModelsEnabled!==false||runtime.descriptor.ocrTransport!=='intranet-http')throw Error('09专用运行器与全内网部署不一致；未处理材料');return runtime;}};}
 return baseOptions(directory,{factory,status});
}
