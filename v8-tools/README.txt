V8通用工具执行原型（独立于V7产品入口）

已实现7个真实业务基础工具：list_materials、inspect_material、render_pdf_page、split_image、vision_extract、read_result、processing_status；另有discover_tools能力发现工具，共8个。
ToolHarness接收任意工具数组；模型选择调用顺序。没有场景编号、PDF固定顺序或按业务标题分派。
MCP仅提供listTools()/mcpCall()结果适配；尚未启动MCP stdio/HTTP服务，不声称MCP部署完成。

运行
Node>=22。配置python解释器并安装requirements.txt中的pypdfium2、Pillow。
node v8-tools/run.mjs <operator-config.json>
配置由宿主提供，包含：directory（必须是新的独立运行目录）、inputs（授权文件绝对路径数组）、python、request、chat、vision。
chat/vision都包含baseUrl（以/v1结尾）、model，可选apiKey；不要把含密钥配置提交进Git。
可配置maxCalls、maxRounds、maxVisionCalls。仅宿主可配置API地址，模型参数不能重定向请求。
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
这是CLI工具运行原型，尚未接入产品UI；仅支持PDF/PNG/JPEG输入族，未实现所有规划工具。
没有持久化恢复后的自动续跑、跨页表格合并或语义缺行的完整检测；这些保留为后续工作。
已实现基础按需发现：注册工具超过可见数量阈值后先提供discover_tools，名称/描述关键词检索并分页激活有限数量的schema；50个合成处理器用于发现机制测试，不算已实现50个业务工具。语义检索及更复杂授权分组仍待实现。
catalog.json列出8个已实现工具和各能力族后续清单；待接入条目不注册为可调用工具。
