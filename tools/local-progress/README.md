# 本机多任务进度看板

Windows / Node.js 24，基础看板仅 Node 内置模块，无 npm 安装或新增模型服务。可选审查复用既有 Codex 原聊天及其模型。默认 127.0.0.1:18764；不搬运材料，不直接读取私有会话目录或数据库。

## 运行

PowerShell 执行 `& 'D:\pro222\pccr-eye-gaze\local-progress\manage.ps1' start`，同一路径支持 `stop`、`status`。

两个独立隐藏 Node 进程（HTTP + AFK），脱离启动终端。关闭终端后继续运行，注销、关机时结束；休眠期间不能巡检，唤醒后恢复。不是 Windows 系统服务，不保证崩溃自愈。`status` 核实 PID 与健康检查/心跳，不能据服务存活推断 worker 存活。

`manage.ps1 pause` 停止派发并向原聊天发送暂停控制指令；`resume` 仅供用户明确授权恢复后执行，过了截止时间需先重新授权。data/run-control.json 保存明确的 ISO 截止时刻与暂停状态，数据文件不提交Git。派发在每次调用前检查截止时间，独立观察约15秒内发送到点暂停消息；休眠/关机期间不能发送，恢复后补查。worker 每批新调用、实验和推送前运行 `node control.mjs check`，非0退出即停止新工作。服务不能强行中断原聊天已经发出的远端模型请求，暂停控制消息的实际消费仍以worker回执为准，不能承诺瞬间停止所有在途调用。

可选 `enable-startup` / `disable-startup` 写入/移除当前用户 Startup 文件；为登录后启动，不需要管理员。当前默认不启用。若本机策略禁止运行脚本，可用 `pwsh -NoProfile -ExecutionPolicy Bypass -File 'D:\pro222\pccr-eye-gaze\local-progress\manage.ps1' start`。

## 上报

`node 'D:\pro222\pccr-eye-gaze\local-progress\report.mjs' worker-01 T1,T4 running '对照框架失败原因' '分别复核模型和工具' '-' '-'`

位置参数：worker_id、任务列表、status(todo/running/blocked/done)、stage、next_step、blocker、result_path；`-` 表示空字符串。每窗口使用 worker-01 至 worker-07 中不同的 ID，不绑定任务。任务参数允许 T1/T2/T3/T4/T5、逗号分隔的多项，或 GENERAL（跨任务/待归类）。同一条进度同时涉及多项才多选；任务进度不同则分别上报。旧 t1-client 等 ID 与旧命令继续兼容，旧 ID 也可显式切换任务；有实际旧上报的窗口继续显示，未接入的旧预留项不重复展示。演示 ID 仍只允许 DEMO，不污染真实任务。

本地接口 `POST /api/report`，Content-Type application/json，Authorization Bearer WORKER_TOKEN。JSON 字段 task_id、worker_id、status、stage、next_step、blocker、result_path 必填；多任务可追加 task_ids 数组，必须包含 task_id，所有任务同时校验后单次原子提交。服务端添加 updated_at（UTC ISO 时间）。凭证在 data/credentials.json，report.mjs 自动读取。各 worker 专属凭证、独立原子文件，文件内按任务保留最新上报。因此更新 T4 不覆盖同窗口 T1 进度，T1 的时效也不会被刷新。旧格式数据自动兼容。窗口视图显示最近一次汇报，任务视图分别显示各自记录，GENERAL 单独展示；AFK 同样覆盖未接入窗口与待归类内容。

只报告允许存储的简短状态和路径。不要在任何字段复制公司测试材料、合同正文、账号凭证等敏感数据。服务不会读取 result_path 指向的文件。禁止材料上传，16KB 请求上限；未提供任意文件读取功能。浏览器无凭证，不能直接更改进度/验收。该服务面向可信本机用户，不隔离共享同一 Windows 账号的恶意程序。

## 巡检与验收

每次启动立即巡检，此后每 1800000ms（30 分钟）。15 秒写一次巡检进程心跳。30 分钟没有上报即状态待核实；不代表 worker 停止。完成状态也保留原上报并单独显示新鲜度。任务汇总不会凭某一个 worker 完成就假设全任务完成。

data/summaries 时间戳 JSON/Markdown、data/afk.jsonl 巡检日志、data/events 每日上报日志、runtime 标准输出/错误。不修改工作产物。日志只增不自动清理，用户可按需归档。

## AFK 审查与原聊天消息队列

用户追加授权后，独立巡检可读取 data/supervisor-config.json，向指定的原审查聊天用 `codex queue` 排队发送有限一次审查请求。复用现有 Codex 聊天与其模型，不新增模型服务；仍受账号额度与客户端可用性约束。每个 worker 下次运行 report.mjs 时从当前环境自动填 thread_id，服务拒绝跨聊天抢占 worker 或同一聊天占用多个 worker。已有旧上报保留，不会凭 worker 名猜测聊天 ID。未绑定、演示、审查聊天自身不派发。

审查聊天收到请求后运行 supervision.mjs context CYCLE，只读取本地允许保存的状态快照；结合当前阶段、阻塞、下一步与任务目标，判断哪些窗口有可推进事项，形成具体1至3步动作和验证/停止标准，再通过 supervision.mjs send CYCLE WORKER '建议' 排队发给对应原聊天，最后用 complete 记录本轮结论。保留现有原窗口，不调用 resume，不启动同一线程的第二执行器，不自动批准权限请求或用户验收。发送前再次核对绑定；本轮每窗口最多一条建议；没有结束的审查请求不叠加排队，不确定投递停止重试。

本地队列成功只记录 queued，不能据此认定桌面应用已消费消息或已唤醒。审查聊天读取 context 后记 reviewing；worker 首次实际上报带 AFK_ACK:轮次UUID 时保存单独回执，再依据后续真实上报判断执行/完成。独立定时器继续运行，但如果桌面应用没有自动消费队列，自动推进会停在待接收，不能承诺无人值守唤醒。data/supervision 保存审查快照与建议，data/supervision-receipts 保存回执；data/supervision-status.json 暴露当前状态。关闭此功能：将 supervisor-config.json 的 enabled 改为 false 后仍保留常规30分钟状态巡检。

其他已有工作聊天的接入使用官方只读 app-server API 核对项目聊天编号和实际执行过的上报worker编号，再由 connect-workers.mjs 向确认的原聊天发一次接入与有限核查建议。该只读观察服务不恢复或启动原线程，不直接读取私有数据库或会话目录；它的 notLoaded 状态仅描述观察服务，不能据此判定桌面聊天未运行。onboarding 记录请求，onboarding-receipts 分别记录 AFK_CONNECT_ACK 与 AFK_CONNECT_PROGRESS 主动上报；原窗口自行绑定才算绑定成功，不由总控伪造。connection-verification.json 进一步检查本轮产物路径存在、属于本项目、是文件且修改时间不早于接入请求；只读文件元数据，不读取材料正文。看板每次刷新展示最新核对结果，独立巡检也会保存它。此核对不代表内容质量或用户验收。还未收到回执或阶段结果的接入不叠加派发新建议。编号06/07没有实际对应的工作聊天时保持未接入，不能按数字猜测并冒名登记。

独立巡检进程同时每15秒轻量核对本地连接结果，仅在新worker完成真实阶段产物核对或明确上报阻塞时向总控聊天排队一次验证通知。首次启动只建立观察基线，状态不变保持安静，不反复催促或重新派发。此观察不调用模型；正式模型审查请求仍每30分钟一次。connection-watch-state.json 记录通知游标与投递结果，不依赖永久占用的模型聊天充当计时器。

## 硅基流动错峰

`GET /api/siliconflow` 展示全机共享槽位、FIFO队列、冷却和迁移收尾确认。`sf-turn.mjs status` 同样可查看；`sf-turn.mjs run WORKER -- EXECUTABLE ARGS` 包装一个有限任务，Node请求入口也可导入 withSiliconflowSlot。完整接入说明见“硅基流动接入.txt”。调度只接收本机worker凭证与租约元数据，不接收SF密钥、请求正文或材料；原请求仍由原进程调用原已获准端点。

当前保守设置全机SF并发1、任务/请求结束后默认间隔60秒。真实429由客户端报告，统一按Retry-After及指数退避冷却，不自动重放原请求。官方按账号及模型计量，不按API Key分别计量；这里统一串行是本机保守策略，不能保证消除所有平台配额型429。来源：https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation 。

迁移时只有worker-01/04/05确认旧直连请求已结束并实际接入后才开闸，不能用消息入队当收尾确认。只约束接入此入口的调用，不拦截未改造的旧进程。槽位心跳丢失时保留占用，不能凭超时抢占；实际核实原调用已经结束后，持有者可用 `sf-turn.mjs release-confirmed WORKER --confirmed-ended` 恢复队列。服务重启保留活动租约，避免并发重叠。暂停/截止阻止新授予，上报与释放仍允许。

测试 `verify-siliconflow.mjs` 使用模拟时间验证迁移屏障、单槽、FIFO、60秒间隔、共享429冷却、错误归属、心跳失联保留及重启持久化。HTTP/浏览器验证另启两个真实假任务子进程，经包装入口确认开始/结束严格串行，无付费API调用。

## GitHub进度同步

用户已授权有经验证实质进展后提交代码与脱敏进度摘要到既有GitHub远端工作分支；不得提交data、runtime、test-output、.env、凭证、公司材料或敏感原始模型请求。不得force push或擅自合并主分支。推送前执行control.mjs check，同样受明确暂停和截止时间约束。推送成功需核对远端commit；失败保留本地提交并如实记录阻塞，不能把commit当作push成功。

用户实际验收后执行 `& 'D:\pro222\pccr-eye-gaze\local-progress\manage.ps1' accept -TaskId T1`，取消验收用 `reopen`。此命令仅供用户，接入 worker 的提示词禁止自行验收。用户验收状态独立于 worker 上报完成，后续 worker 上报不会覆盖它。

## 验证

`node 'D:\pro222\pccr-eye-gaze\local-progress\verify.mjs'`：独立临时端口、test-output 数据目录、400ms 测试巡检周期、600ms 超时。调用现有项目里的 Playwright 仅作浏览器验证（运行看板不依赖它）。不修改正式配置，正式固定为 30 分钟。检查并发、认证、跨任务隔离、超时、完成/验收区分、真实浏览器渲染和刷新、服务断开后独立巡检。证据及截图存于 test-output/时间戳。

型号名称按用户原文保留，尚未验证。官方文档仅作为 T1 的核实入口，并不能证明当前客户端兼容千问3.8：https://learn.chatgpt.com/docs/config-file/config-advanced 。此部署没有调用或配置任何模型。
