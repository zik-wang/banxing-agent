V8通用工具执行原型（独立于V7产品入口）

已实现7个真实业务基础工具：list_materials、inspect_material、render_pdf_page、split_image、vision_extract、read_result、processing_status；另有discover_tools能力发现工具，共8个。
配置documentExtras:true另启用extract_pdf_text、export_xlsx、validate_artifact，共11个已实现接口。它们不含场景编号或预置业务答案。
配置workbookTools:true再启用read_workbook、merge_tables、export_table（也启用文档扩展），共14个。read_workbook保留数值类型和源行；merge_tables按列名对齐，默认append不去重，仅模型显式选择deduplicate才按选定键处理，非空值冲突保留原记录；export_table直接导出表ID，避免模型重打几十行数据。
工作表枚举由inspect_material支持，去重由merge_tables支持，因此规划中的list_workbook_sheets、deduplicate_rows能力已覆盖，未另立同名接口。追加原工作簿、公式引用改写及样式保留尚未实现；含公式的表格合并会明确拒绝。
ToolHarness接收任意工具数组；模型选择调用顺序。没有场景编号、PDF固定顺序或按业务标题分派。
MCP仅提供listTools()/mcpCall()结果适配；尚未启动MCP stdio/HTTP服务，不声称MCP部署完成。

运行
Node>=22。配置python解释器并安装requirements.txt中的pypdfium2、Pillow。
node v8-tools/run.mjs <operator-config.json>
配置由宿主提供，包含：directory（必须是新的独立运行目录）、inputs（授权文件绝对路径数组）、python、request、chat、vision。
chat/vision都包含baseUrl（以/v1结尾）、model，可选apiKey；不要把含密钥配置提交进Git。
可配置maxCalls、maxRounds、maxVisionCalls。仅宿主可配置API地址，模型参数不能重定向请求。
chat.maxTokens可配置规划模型单轮输出上限，默认仍2000；真实09/15实验使用7000。模型回执记录在model-responses，截断仍报错，不冒充完整回答。
chat.enableThinking是可选宿主配置，只向支持的服务传递chat_template_kwargs.enable_thinking；不是所有模型的通用参数。未设置时保持上游默认。本机Qwen已通过无材料短探针核实false返回0 reasoning tokens；旧V7运行器亦设置关闭思考。focusedGuidance:true启用通用任务聚焦/不猜关系/导出预算指导，无场景编号或原件答案。
文档扩展需要openpyxl（仅回读），artifactModule由宿主指定已安装的@oai/artifact-tool入口绝对路径。当前测试使用Codex随附运行库；没有打成可移机V8便携产品。
export_xlsx使用真实xlsx格式，单元格暂按文字保留，防止编号前导零、并列日期和年精度被改写；不提供数值公式计算。validate_artifact核对所有保存单元格是否等于导出参数，不证明这些参数符合源文件。预览只渲染每页前13行，完整内容仍逐单元格回读。
Ctrl+C取消；运行目录保存原件副本、图像、状态、逐次工具回执、原始API响应和模型工具链记录。

行为
- PDF交给vision_extract会返回本地INPUT_TYPE_UNSUPPORTED；不故意把不支持格式传到API。
- render_pdf_page按物理页码渲染，split_image按像素分块；每块保留父图、原文件、页码、坐标与哈希。
- 体积超过宿主配置限制，返回本地INPUT_TOO_LARGE；上游真实413或明确图片尺寸错误单独标记upstream_api。
- 错误返回模型，模型可改用其他工具或参数。Harness不自动强制“遇到任何错误就分块”。
- finish_reason=length、空输出及明显逐行重复会标partial；没有触发这些检测也只表示returned_unverified，不是识别完整。
- 长回答保存完整原文，read_result按游标继续读；不默默丢掉尾部。
- 模型说完成时标记model_finished，同时保留contentVerified=false；它不是独立QA验收通过。

测试
node --test tests/v8-tool-harness.test.mjs
设置V8_PYTHON与V8_TEST_PDF（用户WHO156页原PDF）可执行真实渲染+分块+模拟HTTP413集成测试。
这个集成测试的视觉HTTP响应是明确注入的故障/成功桩，不能当成真实模型识别质量证据。

当前边界
这是CLI工具运行原型，尚未接入产品UI；支持PDF/PNG/JPEG/XLSX输入族，未实现所有规划工具。
没有持久化恢复后的自动续跑、跨页表格合并或语义缺行的完整检测；这些保留为后续工作。
已实现基础按需发现：注册工具超过可见数量阈值后先提供discover_tools，名称/描述关键词检索并分页激活有限数量的schema；50个合成处理器用于发现机制测试，不算已实现50个业务工具。语义检索及更复杂授权分组仍待实现。
catalog.json列出14个已实现工具和44项待接入清单；待接入条目不注册为可调用工具。
