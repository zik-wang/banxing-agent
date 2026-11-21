# Calendar MCP

实现：`calendar-service.mjs` → `CalendarMcpClient` → 官方SDK stdio会话 → `calendar-mcp-server.mjs` → Provider。

SDK锁定 `@modelcontextprotocol/sdk@1.32.1`，采用v1维护线支持的2025-11-25协议；不是自造的JSON工具接口。官方传输与客户端依据：[Server](https://ts.sdk.modelcontextprotocol.io/server)、[Client](https://ts.sdk.modelcontextprotocol.io/client)。

## 工具与授权

工具发现包含list_calendars、list_events、find_free_slots、create_event、get_event，均带 `calendar_` 前缀。模型可读取日历和准备提议，不能把自己生成的“同意”当授权。浏览器同源、CSRF校验后的明确确认将提议内容哈希与授权绑定。MCP create只接收已批准operationId，从受控账本读取不可替换的事件内容。

保存operationId、conversationId、runId、calendarId、idempotencyKey、providerEventId、createdAt、verifiedAt、status。创建后独立get_event核对标题、起止、地点和说明。没有verified回执，界面不显示已创建。重复创建使用同一幂等资源，创建响应丢失时先回查同一资源。

## Provider

- `isolated`：真实持久化的本地隔离验证日历。分类 `isolated_calendar_test`，不代表外部Provider。
- `caldav`：显式配置授权collection URL，认证取环境变量。REPORT查询、PUT条件创建、GET回读。HTTP仅允许明确配置的回环协议测试；实际连接须HTTPS。
- 未配置或不可达：报错，不返回“空日历”。配置、工具发现和日历列表并不等于外部连接验收。

当前没有真实CalDAV账号，因此真实Provider测试为 `not_tested`。不得把本地模拟HTTP协议测试写成真实外部日历成功。

## 时间和限制

要求带UTC偏移的ISO时间与有效IANA时区。用户环境当前Asia/Shanghai，相对日期按用户当地日期解释；提议必须展示具体日期和时区再确认。相邻半开区间不冲突。第一版不创建全天、重复、超过24小时的事件，不发送邀请。查询中含无法正确展开的重复/全天/无时区事件时停止自动忙闲结论。仅检查当前有权限读取的日历。

CalDAV并发外部写入无法形成跨系统原子忙闲锁；确认后再次检查可减少竞态，但不能承诺绝对无竞争。真实Provider上线前须补充该系统实际认证、权限、分页、递归与时区验收。
