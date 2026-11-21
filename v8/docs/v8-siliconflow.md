# 硅基流动：本机部署和连接切换

当前分支：`codex/delivery-quality-20261103`。这是源码运行说明；不包含开发机的模型认证、历史工作区或本地1.5B权重。

## 准备

需要 Node.js 22.19+、Python 和硅基流动账号。本轮开发机使用 Node 24.15。服务仅监听回环地址；mentor 在自己的电脑启动后访问自己的 `127.0.0.1:8884`。

```powershell
git clone --branch codex/delivery-quality-20261103 https://github.com/zik-wang/banxing-agent.git
cd banxing-agent
npm ci --ignore-scripts
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r v8-tools/requirements.txt
```

复制 `examples/v8/siliconflow.example.json` 到 `.local-runtime/mentor-profile.private.json`，按电脑实际情况调整 `python` 路径。在 `.local-runtime/siliconflow-key.private.json` 中保存 `{"apiKey":"你的密钥"}`。这两个实际配置文件受 Git 忽略，不提交。

```powershell
node v8-web/server.mjs .local-runtime/mentor-profile.private.json
```

`npm start` 仍是历史V7入口。不要拿旧启动入口的结果作为本轮V8验收。

## Office 与本地模型依赖

Word 使用 npm 的 `docx` 模块；读取和回读还需要相应 Python 包。Excel 导出当前需要宿主配置可用的 `artifactModule`（既有 Artifact 运行库入口）；它没有随本仓库分发。没有该模块时不能承诺完整 Excel 交付，不能用目录可打开或HTTP200代替验收。开发机本轮已配置该模块并运行实际 Office 回读测试。

本地1.5B是可选审核能力，不在仓库内；样例默认关闭。启用时另行配置 `contractReview.localReview` 的解释器与模型目录。ASR、OCR、Office转PDF、真实日历账号也按各自配置验收；没有配置就明确标记不可用，不借用开发机内网或伪造成功。

## 内网／公网选择

网页右上角可切换保存的连接。仅操作员配置的固定HTTPS公网服务可用；公司地址使用10网段接口。运行中的任务、上传和会议会阻止切换。内网材料及其历史上下文不会随切换自动发到公网；公网测试请使用新对话及获准材料。

合同的临时外发授权仅针对明确选定的原始合同，具有时效且不包含私人录音。不得把云端推理理解为“材料从未外发”。本轮评测只发送四份已授权的公开文件，没有发送录音或私有业务材料。

## 费用、限流与本轮实测

开发机已真实验证 `Qwen/Qwen3.8-27B` 的短文本及合成图片请求，关闭聊天思考。余额恢复不代表每分钟吞吐无限：本轮真实出现过 `50602 / TPM limit reached`。硅基流动将TPM作为账户／模型的速率限制，详见[官方限流说明](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation)。大文档应保留已取得结果并控制节奏；不要连续重试刷请求。

本轮同模型对照使用统一采样、明确请求上限和实验节流。Codex通过纯传输适配器调用相同Chat Completions接口，适配器不解析合同、不生成答案、不代跑工具；它不是生产模型的隐式替换。具体实测结果与未完成范围以评测目录为准。
