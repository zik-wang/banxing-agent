# 隔离执行工作区与18场景回归

宿主在 `workspaceExecution` 中显式配置 `enabled: true`、`backend: "codex-mxc"` 及 Codex/Python/PowerShell 可执行文件绝对路径。`readOnlyRuntimeRoots` 只配置受信任的已安装运行库目录。本功能仅使用 Codex 的原生Windows沙箱，不调用Codex模型；规划仍使用宿主选择的千问。

每次运行拥有独立 `command-workspace`：原件按SHA复制到只读 `inputs/`，生成代码和数据在可写 `work/`，无凭据的沙箱配置在不可向模型读取的 `control/`。模型不能提供权限profile、宿主可执行文件路径或扩大目录范围。网络关闭；不支持MXC或沙箱启动失败时不回退到宿主直接执行。

`workspace_files/read/write/run/publish` 分别提供目录元数据、分页文本读取、生成文件写入、Python/PowerShell执行和真实成果登记。命令有宿主时间/输出限制，取消和超时终止本次进程树。输入、目录穿越、junction、符号链接和硬链接受到独立检查。发布支持文本、CSV、JSON、DOCX、XLSX、PDF，实际重开文件和结构后才成为下载成果；这不证明业务内容正确。

本地私密录音/转写政策不允许开放通用执行器或读取其内容。“不要运行代码”等原任务禁令会移除通用命令工具；静态补丁等原有专用工具保留。未实现容器级CPU/磁盘配额，也不承诺任意缺失软件可用；离线执行不自动安装联网依赖。

## 固定回归

`benchmarks/scenario-regression/prepare.mjs` 从既有intake和active-scope冻结18项原REQUEST与原件SHA。当前原材料包明确缺少16/18/20的订单、录音、巡检输入，这三项保持阻断。未使用合成原件填补。

`run.mjs` 对baseline/candidate分别运行原任务及“保持实际回复的事实与限制，仅转Markdown、不重新分析”的续接变体，共72个结果槽位。基线8ae6854与候选版使用相同硅基流动Qwen/Qwen3.8-27B、采样参数和每项8次累计入口/10分钟预算；变体共享该项网关预算，失败基线不得导出错误消息冒充成果。原指令不加统一的文件生成要求，不改变任务授权。

网关统一节流与记录实际POST、HTTP、usage、缺失usage和失败，最多160次全套推理请求；预算拒绝与服务商限流分开。接口和文件成功不自动算业务正确；内容依据、未完成范围及条件阻断单列。继续运行已有suite会跳过已完成结果，拒绝覆盖已开始但未结算的任务。

本机执行清单、原件、双版本回执及结果在工作树父目录 `qa-output/workspace-regression-20261104`。密钥只由回环网关读取，不复制到原件、候选工作区或发布包。
