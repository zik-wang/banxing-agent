# worker-05 固定交付页

更新：2026-11-06。维护者：worker-05。此页持续更新，不再为每日汇报新开远端分支。此次仅整理已有证据，没有新实验、模型请求或部署。

[返回统一成果入口](https://github.com/zik-wang/banxing-agent/blob/codex/afk-progress-board-20261104/docs/progress/README.md)

源码分支：`codex/execution-convergence-20261103`。已公开关键证据固定在提交 [7d2e608](https://github.com/zik-wang/banxing-agent/commit/7d2e6081cb30df98854a1255c2802d8890c97c23)。本页的实际发布提交可从[页面提交历史](https://github.com/zik-wang/banxing-agent/commits/codex/execution-convergence-20261103/docs/progress/worker-05-latest.md)核查；发布后精确 SHA、远端复核时间和本地位置同步进本机 worker-05 发布回执。部署提交未知，不能把本分支 HEAD 当作实际运行版本。

## T1：Codex/Qwen 兼容及 Harness 查询入口

已有有限协议适配与 DSH 文档插件双模型试跑记录，工具目录为 31 项。旧证据来自 11 月 4 日，未在本轮重跑。不是 Codex 官方后台替换，也未证明任意工具或全场景支持。

- [兼容里程碑、真实请求与限制](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-04/worker05-harness-diagnostics.md)
- [原分支 Harness 源码](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/v8-tools/harness.mjs)、[工具目录](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/v8-tools/catalog.json)。这是固定源码快照，不等于生产运行副本。
- DSH 登录、启动器配置和本机插件运行态不上传。完整多模态迁移仍未验证。

## T2：合同金额及 verify 协议独立 QA

已完成：v1 摘要域歧义归因、v2 域隔离定向检查，以及一条真实 v2 合成金额回执的独立核查。该案例实跑记录为 11 月 5 日约 03:00，独立 QA 于约 03:36 完成；46 项一致性断言属于一个案例。原 v1 NOT_VERIFIED 保留。

- [v1 原因与未排除项](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-23d3421-verify-protocol-qa.txt)、[v2 离线复核](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-f1d83df-protocol-v2-recheck.txt)
- [单条真实 v2 回执独立结论](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-c30e33d-real-v2-evidence-qa.txt)；[下载脱敏结论](https://raw.githubusercontent.com/zik-wang/banxing-agent/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-c30e33d-real-v2-evidence-qa.txt)
- [允许公开的合成核查程序](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/qa-support/audit-one-synthetic-v2-receipt.mjs)
- 本窗口未验证完整 1.5B 对 27B 对比、生产 A-B-A、模型逐项解释五域或生产 EPERM 根因。单条金额正确不等于协议、全部材料及生产能力全通过。

## T3：图转 CAD

本窗口未独立核查 CAD 代码、几何或交付物，不替其他窗口作结论。该工作已由用户交 DSH 独立推进，本次不联系或唤醒 CAD 窗口，不猜设远端，不搬运图纸。

## T4：失败定位及修复候选

11 月 4 日晚已有 3 次原 Qwen 真实请求诊断；历史长超时未复现，来源角色仍存在错误。19 项独立候选检查、26 项受控临时目录关联检查通过是两个验证范围，不是线上修复完成。原失败和非等价上下文/工具路径差异保留。

- [诊断与验证范围](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-04/worker05-harness-diagnostics.md)
- [来源提案守卫源码](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/v8-tools/expiry-proposal-guard.mjs)、[截止监督器源码](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/qa-support/deadline-supervisor.mjs)
- [草稿来源恢复原失败](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-489cfa5-independent-qa.txt)、[修复后定向复验](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-e8dcbe2-source-recovery-recheck.txt)
- 候选保护未证明接入正式交付边界；不把整条路径的差异归因于单一框架内核。

## T5：8884 已有真实流程的独立 QA

以下仅为 11 月 5 日三个合成案例；不是 18 场景可靠性或用户签收。本次没有重跑，文件存在、HTTP200、执行端自验不单独作为通过依据。未发布公网产品演示；本地历史对话入口及成果路径仅记录在本机回执。

- **S08-001：独立 PASS。** 新旧条款、服务期未变及新增维护义务，实际 MD/DOCX 下载与同 run 绑定核对通过。4 次真实模型请求。DOCX 视觉版面仍未验证。[固定证据](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-s08-001-intranet-pass.json)
- **S10-001：独立 PASS。** 5 行、A03 完全重复去 1、精确合计 1500.00、排序和原件 SHA 核对通过。4 次真实模型请求。原 8 请求/0 产物失败保留；运行目录与开发整提交不完全相同，独立下载发生于后续服务启动后。[固定证据](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-s10-001-independent-pass.json)
- **S05-001：独立 PASS，保留 P3。** 回复/旧引用、2 确认与 1 备用待确认、时间、仅待回复线程草稿正确；13:10 左右完成独立下载及回执核对。1 次模型文本响应、3 次宿主固定工具执行，不能称模型自主选择工具。建议中的立即发送措辞待改，无实际发送/调度。[固定证据](https://github.com/zik-wang/banxing-agent/blob/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-s05-001-independent-pass.json)

[下载三例及四项状态脱敏摘要](https://raw.githubusercontent.com/zik-wang/banxing-agent/7d2e6081cb30df98854a1255c2802d8890c97c23/docs/evaluations/2026-11-05/worker05-mentor-status-1551.json)。实际材料、完整模型原始记录和运行态不随交付页上传。

## 发布与验收状态

- **Push：** 已有证据已公开；本页发布以 Git 提交历史和本机回执的 verified_remote_commit 为准。仅暂存此固定页，原分支、本地其他历史与旧分支均保留。
- **部署：** 本窗口本次无部署、无重启、无模型配置切换。实际运行版本不能用源码 HEAD 冒充，部署提交 unknown。
- **执行端自验：** 开发断言数量只作为候选信息，不是独立 QA 案例数。
- **独立 QA：** 以上分别给出具体范围与遗留项；不得由一个 done 概括所有任务完成。
- **用户验收：** 未代用户签收。自动派发保持关闭。
