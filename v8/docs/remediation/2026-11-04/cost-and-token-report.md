# 请求与已返回usage

{
  "baseline": {
    "POST": 27,
    "entrances": 27,
    "localBudgetRefusals": 0,
    "provider429": 0,
    "promptTokens": 699925,
    "completionTokens": 4860,
    "missingUsage": 2,
    "pacingMs": 737070,
    "requestPhaseMinusPacingMs": 1098905,
    "providerPrefixCacheTokens": 82176
  },
  "fixed": {
    "POST": 11,
    "entrances": 11,
    "localBudgetRefusals": 0,
    "provider429": 0,
    "promptTokens": 90174,
    "completionTokens": 4130,
    "missingUsage": 1,
    "pacingMs": 4,
    "requestPhaseMinusPacingMs": 661033,
    "providerPrefixCacheTokens": 10240
  }
}

金额unknown；usage缺失的实际外发请求不能当作0成本。模型等待、实验节流、工具时间及墙钟不互相混算。页面模型请求另见page实际运行目录和page/e2e-results.json，不计入六次CLI可比表。

## 页面追加请求单列

页面Workspace预算入口34次；已保存传输尝试回执32份，另2次在途中停止缺最终回执，不能按零费用。原始逐次usage与错误见page-model-cost.json。最终页面取回链路新增0次模型请求。页面请求不纳入同预算六次CLI对比，不隐藏在38次之外。
