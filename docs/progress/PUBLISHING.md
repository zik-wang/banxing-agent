# 推送与交付要求

自2026-11-06起执行。已有成果应能从一个入口找到代码、报告和本机交付位置。本要求不授权新实验或恢复自动派发。

## 固定入口与分支

唯一总入口：[任务与成果索引](README.md)，所在分支为`codex/afk-progress-board-20261104`。各窗口的代码沿用其现有工作分支，协调窗口汇总索引。不要为了每天、每次修复或每轮汇报再开一个远端分支。

确需独立远端分支时，说明用途、任务、维护者及替代关系，并同步更新入口。旧分支暂不删除，不强推、不自行合并主分支。不同窗口不要同时写总入口的同一文件。

执行窗口只维护自己的源码分支和一个固定交付页，例如`docs/progress/worker-01-latest.md`，使用自己的worker_id。后续更新同一页并保留Git历史；已有固定交付页则沿用并回报路径。跨多任务时按任务分节，不用单一标签概括整个窗口。

## 每次交付要能直接找到

交付页写清：任务目标、本次完成项、报告/演示/代码可点击链接、验证结果及时间、未完成项、阻塞、原分支、实际发布commit和验证过的远端commit。给读者固定的最新文档链接，给关键证据固定commit链接，不能只甩分支名或SHA。

已push、已部署、执行端自测、独立QA、用户验收分别说明。源码与实际运行副本不一致时明确记录，不能把源码HEAD冒充运行版本；文件存在或HTTP200不等于业务通过。

GitHub只放获准发布的源码、合成测试和脱敏报告。合同正文、公司图纸、原始模型记录、凭证和运行态不随代码推送。受限产物的路径只进本机回执；只为获准发布的文件给仓库下载链接。CAD已由用户交DSH独立推进，原CAD窗口不因本要求恢复工作。

## 本机回执与上报

每次有实质交付，按原命令更新任务状态，并回报本机交付回执路径。回执至少包括：

```text
task_ids / worker_id / updated_at
repository / source_worktree / source_branch
published_commit / verified_remote_commit / remote_verified_at
stable_delivery_page_url / immutable_evidence_urls
local_delivery_directory / local_report_paths
runtime_directory_or_not_applicable / deployed_commit_or_unknown
verification_scope / independent_qa / user_acceptance
unpublished_items_and_reason / blockers
```

不写密钥或材料正文。可保存到本机`local-progress/data/publishing-receipts/<worker_id>.json`并用原`report.mjs`报告结果路径，协调端据此更新总入口。没有新实质内容则回报已同步，不空提交或重复推送。

## 推送前后

检查最新用户暂停和范围、工作树与差异，只暂存本次允许文件，完成与改动相关的必要检查。推送后实查目标分支远端commit，再回报“做了什么、去哪看、哪些未通过”。本地桥接commit与发布commit不同时说明关联，不以强推抹平历史。

未收到回执或未核对时标待确认，不能把消息入队说成要求已落实。本次不移动材料、不合并或删除分支。
