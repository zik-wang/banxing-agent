合同专项 Harness：现有 V8 审核助理的宿主处理器

入口
  保留 v8-web/server.mjs 与现有 UI。部署 profile 的 contractReview.enabled=true
  时，“审核助理”中设备采购合同请求由 host-run.mjs 执行；不是新网页或新端口。
  上传主合同 DOCX/PDF（附件可同时上传），发送“帮我审核这份设备采购合同”。
  后续直接发送“按供方立场补审付款条件”“把报告转Word”“给我之前的文件”。
  类型不确定、多份主合同、超出支持范围时需要澄清，不默默套用采购规则。

配置（模型地址、凭据继续复用宿主 profile，不写入本目录）
  contractReview: {
    enabled: true,
    approvalFile: "/本地维护者授权清单.json",
    maxCalls: 12,
    maxTokens: 6000,
    callTimeoutMs: 180000,
    timeoutMs: 900000,
    preflightModel: false
  }
  公网需要授权清单精确匹配材料 SHA256、审核助理指导哈希、政策文件哈希。
  清单只允许 public/synthetic；没有批准的合同在本地拦截，不外发。
  用户修改审核说明不能修改处理器、模型地址、工具权限或授权清单。
  内网沿用宿主已有 provider 配置。当前 8884 使用外网，不宣称是公司内网。

流程与存储
  Workspace 原件引用 -> SHA 校验 -> DOCX/PDF 解析 -> 程序规则 -> 16专题
  -> 跨条款 -> 反例复核 -> 引文/覆盖校验 -> 中文 HTML/TXT/审计 JSON。
  结果和文件登记到原 ResourceSpace/Artifact Registry，保留所有旧版本。
  contract-dispatch.json 记录 UI 文件 ID、资源 ID、版本、SHA 和审核文件 ID。
  Word 从已选中报告全文确定性转换，使用现有导出器，并回读实际 OOXML。
  取回已有文件不重新推理或导出。导出完成不改变原审核的 partial 状态。
  本轮补审是保留来源的新运行，不声称已具备任意阶段断点续跑。

边界
  首个支持合同类型仅为中国大陆设备采购；支持采购方/供方/中立。
  DOCX 页码不猜测；原批注与新发现分开保留。无法锚定/解析异常会阻断完整状态。
  扫描 PDF 尚未接入 OCR，PDF 布局未验证时保留 partial，不宣称全页已读准。
  没有法律检索、企业模板或合同台账时如实标记缺失，不伪造法律依据。
  当前报告直接支持 HTML/TXT/JSON/Word；不以 Markdown 冒充 Word/PDF/Excel。
  不承诺语义零遗漏、合同可签或法律意见；没有独立人工 Gold，不能计算准确率。

验证
  tests/v8-contract-bot.test.mjs 覆盖真实 WebWorkspace/子进程/DOCX 解析、
  附件改名后的正文编号、补审继承、Word 真文件、同 ID 取回、跨会话隔离、
  未授权公网输入本地拦截。离线测试 maxCalls=0，不冒充真实模型测试。
  本轮真实页面/真实 Qwen 记录、部署与回退资料见：
  qa-output/v8-review-bot-20261030/README.md
