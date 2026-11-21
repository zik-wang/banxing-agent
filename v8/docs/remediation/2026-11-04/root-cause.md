# 实际根因与修复边界

基线：47a05c4a37c83b2bed10b9fda12def009be0a0a5。经逐文件 LF/CRLF 归一比对，其 v8-tools 运行模块与上一轮真实报告的 harness-runtime 一致（baseline-runtime-comparison.json）。当前生产 8884 使用独立冻结目录，不是本次开发树；本轮不覆盖它。8874 本轮读取连接未成功，未改变该进程或配置。

## 三例数据路径

- 11：operator JSON → v8-tools/run.mjs → TextTools.read_json_range/read_text_range → ToolHarness/模型可见工具 schema → DeliveryTools.export_document → DocumentExtras/输出文件 → Continuity checkpoint → settleDelivery。旧 schema 的 title/format 是必填，但正文或已存正文引用没有组成必填条件，source_ids 被模型反复当正文。旧 JSON 返回同时带值与长 quote，工具历史逐轮累积。旧失败回包存在，但相同失败只拒绝执行仍可继续消耗模型轮次。
- 15：同一 run 入口 → PDF 文字层 → SourceRecordTools.labeledRecords → export_source_records → XLSX。旧抽取只按打印 key/value 区块处理，正文中的仅年精度事实留在附录；原值存在不等于角色正确。后续把 XLSX artifact_ids 当可直接生成说明正文的材料，能力不支持时阻断后续回复。现在明确字段角色与日期精度，事实台账一次保存，五种视图从同一版本渲染。
- 19：原件 asset → read_text_range → apply_patch_copy → 修改副本和 patch artifact → read_artifact → 说明正文 → 导出。旧 UUID 不提示引用种类，读原件接口拒绝成果 ID；模型随后自行数行引入第59行错误。现在成果引用分派至对应读取器，补丁回执返回实际 changed_lines/before_occurrences/原件和副本SHA。

## 已有 Workspace 的复用

并未认定原 Workspace 失效。继续使用 continuity.mjs 的操作日记、operationKey、ResourceSpace 和 checkpoint。草稿提交在渲染前原子保存；文件写入后、回包前中断时先用幂等键及哈希恢复，避免重复导出。已完成的 PDF 解析页和JSON投影按来源SHA/读取器版本/范围缓存。能力开关变化的检查点显式拒绝直接 resume，要求 revise；不删除旧证据。

## 开关与未证明能力

executionRepair 默认关闭；factProfile=expiry 只针对到期清单。网页 expiryFactRepair 仅匹配明确的到期提取请求。原1.5B及合同专项路由不变。规则不是语义完整性证明，多值关系仍待核，历史到期不是当前未续约。字段投影完整不是完整JSON对象读取；保存/回读一致不是事实正确。原生strict structured outputs未作为服务能力假设，宿主实际校验同一注册schema。

## 预算与故障分类

新旧真实对照均固定 temperature=.1、top_p=.95、max_tokens=8192、enable_thinking=false，24次入口/任务、20分钟/运行、300秒/请求（包含实验节流）。实际gateway回执另记 pacingWaitMs 与 elapsedMs；网络阶段近似用 elapsedMs减节流，含协议与文件开销，不伪称精确纯网络。provider429、传输超时、本地预算、确定性工具错误分别保留。未知价格标 unknown。

## 新旧比较的局限

每组只预注册一次，不能从一次成功推导准确率提升；分块、提示、验证器和调度均有变化，不把差异归因于单一Prompt因素。原生Codex仅引用历史同材料/同模型结果。本批未新建独立Gold，不把开发侧合成回归当盲测。


## 真实页面追加定位与最终最小修复

- 9415页面并行读5页时，旧压缩器在模型首次看到前压缩前三页回执；be97520按已呈现边界压缩，新增正反测试。
- be975页面Qwen实际生成Excel/Word后用户停止，进程未写最终settlement，页面没有交付卡。e24bfce仅暴露既有rebuild_delivery通道，以当前权限/SHA/读文件校验另建取回回执；取消状态不改。
- 首个文件写完的检查点先于事实元数据落盘，且泛化恢复会把多格式首个文件当全部返回。e24bfce在写文件检查点前绑定事实版本/格式；事实导出按版本+格式读回现有文件，仅生成缺少格式。
- 同一有效成果已有Word时取回原文件；只有已保存台账且缺Word才本地转换，未收到写作正文不伪造简报。

页面case11写作300秒超时后仍无稿，Word跟进重复list_materials直到无进展停止（5个模型请求/7个业务工具），未交付。此项仍未完成；不能把读取改进称写作交付通过。
