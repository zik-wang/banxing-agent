# 同一个公网27B：伴行与原生Codex

2026-11-03 实际结果见 [评测交付](../../docs/evaluations/2026-11-03/README.md)。此目录是可审计的开发侧比较运行器，不是另一套生产Agent，也不自动判定业务验收通过。

## 比较什么

两边使用相同公开原件、原始请求及通用交付要求，硅基流动 `Qwen/Qwen3.8-27B`，temperature=0.1、top_p=0.95、max_tokens=8192、thinking=false。每例每框架累计最多24次网关入口尝试（实际POST另行计数）；每次运行20分钟，包含记录下来的限流等待。没有调用GPT替千问完成任务，没有使用本地1.5B。

伴行使用固定代码快照里的结构化工具；原生Codex使用它自身的文件与Shell工具。环境说明不同、工具能力不同、模型非确定性、没有随机顺序和重复样本，不能把差异全部归因于某一个框架设计，更不能推断全部场景准确率。

本轮原生Codex使用Responses协议，而本轮硅基流动只接收ChatCompletions；`protocol.mjs`负责消息、工具和事件的有限协议兼容转换，`gateway.mjs`统一模型参数及预算。适配器不读取材料、不选择工具、不执行任务、不补答案，原始请求和响应保存在本地。开发者协议单元测试另行列明，不能冒充真实Qwen运行。

首次旧Windows沙箱执行失败后使用MXC隔离；保持workspace-write，并关闭插件、远程技能、搜索与子Agent。原件内的指令只当数据。源码修复禁止运行上传代码和创建PR；只做唯一before、静态AST及差异回读。

## 复现

需要Windows、已安装原生Codex CLI、Node、Python（pypdf、python-docx、openpyxl），以及伴行Office导出宿主模块。请设置 `V8_PYTHON`、`V8_DOCX_MODULE`、`V8_ARTIFACT_MODULE`、`BENCH_CODEX_EXE` 为自己的实际路径。准备脚本保留开发机默认值，其他电脑必须覆盖。

```powershell
node benchmarks/same-model/prepare.mjs docs/evaluations/2026-11-03/inputs.json qa-output/my-new-comparison
node benchmarks/same-model/gateway.mjs qa-output/my-new-comparison/manifest.json .local-runtime/siliconflow-key.private.json
```

密钥文件为 `{"apiKey":"自己的密钥"}`；放在忽略目录，禁止提交。网关只监听本机8951，不能与旧实验同时占用端口。在另一终端逐个运行：

```powershell
node benchmarks/same-model/run-one.mjs qa-output/my-new-comparison/manifest.json harness 19
node benchmarks/same-model/run-one.mjs qa-output/my-new-comparison/manifest.json codex 19
node benchmarks/same-model/observe.mjs qa-output/my-new-comparison
python benchmarks/same-model/readback.py qa-output/my-new-comparison
```

依次替换为11、15。为了避免账户TPM竞争，应顺序执行；24次网关入口尝试是同一例累计上限，恢复不会清零。运行器拒绝覆盖已开始任务。历史失败必须先留存，不能通过删日志获得更多预算。

`publish.py`必须先取得明确的开发侧 `assessment.json`。它不按模型说完成或HTTP200自动给通过，不会伪造缺失下载链接。发布包只收公开输入与真实成果，原始API数据和宿主配置不推送。单次价格未知时记录unknown，token和真实POST另行统计。

## 已知运行器限制

当前节流按请求长度估计token，不是服务商计费器；超过估算预算的单请求独占下一窗口。并发小请求可能延后大请求，因此推荐串行；墙钟不等于模型推理耗时。provider的HTTP429与本地实验预算拒绝有独立字段，均不能诊断为账号余额不足。单次计时也包含节流，原始回执用于拆分说明。

资料：[Codex模型配置](https://learn.chatgpt.com/docs/config-file/config-reference)、[Windows MXC隔离](https://learn.chatgpt.com/docs/windows/windows-sandbox)、[硅基流动限流](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation)。
