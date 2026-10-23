# 单机部署与恢复

1. Node.js 22.19+，npm ci --ignore-scripts，npm start。默认 8814；PORT 可覆盖。不要在不清楚进程归属时关闭占用端口的服务。
2. 没有配置时启动未连接模式：页面、历史成果、确定性表格编辑仍可用，模型相关任务明确阻断。不会自动连接任何旧地址。
3. 将 config/deployment.example.json 复制为 config/deployment.private.json，填入获准的模型 API 地址、实际模型 ID、allowedOrigins；不要根据型号猜测部署量化或模板。填入 services.ocr/asr，以及按需添加 capabilities（例如 kind:convert，baseUrl 为兼容 /formats 与 /convert 的转换服务）。
4. 将 .env.example 复制为 .env，设置 V7_DEPLOYMENT_CONFIG、DEMO_DATA_DIR、PORT。路径相对启动目录。若采用 auth.type=env，keyVariable 必须指向已导出的进程环境变量；启动脚本只读取白名单 .env 字段，不加载任意代码。
5. 通用配置的 Chat 支持无认证或环境变量 Bearer。媒体能力当前按既有服务协议调用；需要认证的媒体服务应先提供获准的兼容代理，不承诺任意厂商协议直连。
6. 09 的专用配置读取 .local-runtime/invoice09-config.json；它有独立模型/媒体/原件哈希门禁，需维护者按现有内网环境配置。没有这份配置时保留确定性文本路径，不能声称完整 OCR 已连接。不要复制他人的私有配置。
7. 日历文件由 CALENDAR_CONFIG_FILE 指定，或默认 data/calendar-config.json。isolated 是测试日历。CalDAV 凭据从 CALDAV_USERNAME/CALDAV_PASSWORD 读取。真正写入由页面确认触发。

## 独立实例

每个端口必须使用不同 DEMO_DATA_DIR。启动锁拒绝另一活跃进程写相同目录。进程退出后异常残留锁会检查 PID，不能将“文件存在”误当永久锁死。state.json 损坏时停止写入，保留原件和 .bak，不用空数据覆盖。

## 备份和回退

先停自己启动的服务，确认没有任务运行。随后：

```powershell
node scripts/data-backup.mjs backup ./data ./backups/before-update
node scripts/data-backup.mjs restore ./backups/before-update ./data-restored
$env:DEMO_DATA_DIR='./data-restored'
npm start
```

目标目录必须为空；恢复核对文件哈希，不覆盖旧目录。代码回退采用另一个 clone/工作目录检出保留版本，配合其对应数据快照，不对当前项目做粗暴 reset。GitHub 代码仓库不代替数据备份。

只监听 127.0.0.1。浏览器同源/CSRF 不是多租户认证；不得直接转发到公网作为多人服务。文档转换或媒体服务不可用时只交付实际成功的文件并说明剩余部分。
