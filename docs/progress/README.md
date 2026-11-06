# 任务与成果总入口

以后从此页找成果，无需逐个翻分支。这里链接实际工作分支，不表示已经合并主分支或部署成同一版本。[统一推送与交付要求](PUBLISHING.md)自2026-11-06起执行。

## 按任务找

- **合同审核工作报告**：[Word及案例证据目录](https://github.com/zik-wang/banxing-agent/tree/codex/delivery-quality-20261103/docs/reports/2026-11-03-contract-review)；[直接下载Word](https://github.com/zik-wang/banxing-agent/blob/codex/delivery-quality-20261103/docs/reports/2026-11-03-contract-review/final-report.docx?raw=true)。这是11月3日增补报告，后续实验另列。
- **T1 Codex接入与框架对照**：[执行源码与既有对照分支](https://github.com/zik-wang/banxing-agent/tree/codex/c-end-quality-20261104)；[已核对讨论摘要](2026-11-05-mentor-1600.md)。对应worker-01，QA由worker-05提供。
- **T2 1.5B/27B及大额计算**：[模型对比补充报告](https://github.com/zik-wang/banxing-agent/blob/codex/money-8884-20261104/docs/reports/2026-11-04-t2-supplement/README.md)；[财务代码和后续报告](https://github.com/zik-wang/banxing-agent/tree/codex/money-8884-20261104)。对应worker-02。
- **T3 CAD**：已交用户在DSH独立推进。[此前通用代码](../../tools/cad-harness/PUBLIC_CHECKOUT.md)；[代码及验证范围](../../tools/cad-harness/CURRENT_STATUS.md)；[原目标未达标说明](2026-11-05-worker03-cad-limitations.md)。这些是既有交付，不代表后续DSH成果。
- **T4 Harness失败案例与修复**：[执行及诊断代码](https://github.com/zik-wang/banxing-agent/tree/codex/workspace-and-scenario-regression-20261104)；[独立QA](https://github.com/zik-wang/banxing-agent/tree/codex/execution-convergence-20261103)。对应worker-04/05，并关联worker-01对照。
- **V8/8884场景交付**：[执行报告目录](https://github.com/zik-wang/banxing-agent/tree/codex/money-8884-20261104/docs/reports)；[此前通过案例与PARTIAL边界](2026-11-05-mentor-1600.md)。运行版本另行核实，GitHub更新不会自动部署。

结论保留各文档原取证日期，不把旧结论当今天重新验收。本轮统一导航与交付要求，未重跑业务实验。

## 按维护窗口找代码

- worker-01：`codex/c-end-quality-20261104`。
- worker-02：`codex/money-8884-20261104`。
- worker-04：`codex/workspace-and-scenario-regression-20261104`。
- worker-05：`codex/execution-convergence-20261103`。
- 协调汇总：本页所在`codex/afk-progress-board-20261104`，由协调端根据各窗口固定交付页与回执统一更新。

## 历史记录

- [2026-11-05 16:00 mentor讨论：四项工作、已推代码与未完成项](2026-11-05-mentor-1600.md)
- [CAD通用代码交付与验证范围](../../tools/cad-harness/CURRENT_STATUS.md)
- [2026-11-05：候选验证与新增8884场景梳理任务T5](2026-11-05-afk.md)
- [2026-11-04：本机看板与AFK协作建立](2026-11-04-afk.md)

提交和推送不代表部署、业务通过或用户验收。本分支也不代表其他工作分支已合并主分支。
