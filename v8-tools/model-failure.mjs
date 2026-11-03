// Public feedback is host-authored. Never render a provider's raw error body as UI text.
export function modelFailure(error) {
 if (!error) return null;
 if (error.failure?.kind) return error.failure;
 const d=error.details||{},code=error.code||'';
 let body;try{body=JSON.parse(d.responsePreview||'');}catch{}
 const status=Number(d.httpStatus)||Number((error.message||'').match(/\bHTTP\s+(\d{3})\b/)?.[1])||null;
 const hint=String(d.providerErrorCode||body?.error?.code||body?.error?.type||'');
 const capacity=/capacity.{0,30}(?:exhaust|unavailable)|overloaded/i.test(body?.error?.message||d.providerMessage||'');
 let kind,title,message,action;
 if(code==='TASK_TIME_BUDGET_EXHAUSTED'){kind='local_budget';title='本轮任务时间已用完';message='任务整体处理时间预算已耗尽，现有进度和成果保留。';action='查看剩余工作后继续处理；这不是服务商限流，也不是用户主动取消。';}
 else if(code==='CUMULATIVE_BUDGET_EXHAUSTED'||/LOCAL_EXPERIMENT_BUDGET/.test(d.providerMessage||d.responsePreview||'')){kind='local_budget';title='本轮处理预算已用完';message='本地累计请求预算已耗尽，已保存现有进度和成果。';action='查看剩余工作后继续处理；这不是服务商限流。';}
 else if(status===429){kind=capacity?'capacity':'rate_limit';title=capacity?'模型服务繁忙':'模型请求受到限流';message=capacity?'模型接口返回“容量暂时不足”，本轮已停止继续请求。':'模型服务返回请求限制，本轮已停止继续请求。';action='稍后手动重试，或在右上角切换到可用的模型连接。';}
 else if(status===402||/insufficient_quota|insufficient_balance/i.test(hint)){kind='quota';title='模型账户额度不足';message='模型服务的余额或可用额度不足，本轮已停止。';action='补充额度或切换到可用的模型连接后再重试。';}
 else if(status===401||status===403){kind='authentication';title='模型访问未获授权';message='模型服务拒绝了当前凭据或访问权限。';action='检查模型连接配置和访问权限后再重试。';}
 else if(status===503||status===502||status===504){kind='unavailable';title='模型服务暂时不可用';message='模型服务或其网关暂时不可用，本轮已停止继续请求。';action='稍后重试或切换模型连接。';}
 else if(code==='MODEL_REQUEST_TIMEOUT'){kind='timeout';title='等待模型响应超时';message='本轮模型请求已达到等待上限，已停止等待。';action='稍后重试或切换模型连接；无需重复上传材料。';}
 else if(code==='MODEL_NETWORK_ERROR'){kind='network';title='无法连接模型服务';message='未能取得模型服务的有效响应，已停止本轮处理。';action='检查网络和模型地址后再重试。';}
 else if(status){kind='http_error';title='模型请求未成功';message='模型服务返回错误，本轮已停止继续请求。';action='查看处理详情，检查模型连接后再重试。';}
 else return null;
 const retry=Number(d.retryAfterSeconds),elapsed=Number(d.elapsedMs);
 return {kind,title,message,action,httpStatus:status,requestId:d.requestId||null,elapsedMs:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null,retryAfterSeconds:Number.isFinite(retry)&&retry>0?Math.min(Math.ceil(retry),86400):null,stopAutomatic:true};
}

export function retryAfterSeconds(value,now=Date.now()) {
 if(!value)return null;
 const n=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):((Date.parse(value)-now)/1000);
 return Number.isFinite(n)&&n>0?Math.min(Math.ceil(n),86400):null;
}
