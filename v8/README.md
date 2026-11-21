# 伴行 V8 开发与运行

安装 Node.js 22.19 或更高版本，在本目录执行 `npm ci --ignore-scripts`。将网页配置准备在 `.local-runtime/v8-web-config.json` 后执行 `npm start`。自定义配置路径使用 `npm start -- <配置文件路径>`。打开终端打印的本机地址。[网页使用说明](docs/v8-web.txt)

| 要处理的工作 | 从这里开始 |
| --- | --- |
| 网页、上传、对话和下载 | [v8-web](v8-web/) |
| 助理工具、执行流程和模型调用 | [v8-tools](v8-tools/) |
| 合同审核流程、规则和报告 | [contract-review](contract-review/) |
| 办公业务与底层服务 | [src](src/)：按票据、文档、日历、证据、工作空间等职责拆分 |
| 连接外部服务和本地能力 | [config](config/) · [local-integrations](local-integrations/) |
| 测试、示例与验收说明 | [tests](tests/) · [examples](examples/) · [docs](docs/) |

早期版本的功能记录见[开发历史](docs/history/development-notes.md)。需要复现旧版网页时使用 `npm run start:p4`。
