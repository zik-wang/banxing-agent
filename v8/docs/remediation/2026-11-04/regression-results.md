# 本轮实际回归结果

最终执行日志：regression-delivery-recovery.log。
实际执行364项：358通过，0失败，6跳过。不是复用历史342项或先前353/354的计数。此日志针对最终运行代码e24bfce；CLI对照仍使用3bb0894。

运行入口：
`node --test --test-concurrency=2 tests/v8*.test.mjs tests/same-model-protocol.test.mjs`

依赖：V8_PYTHON、V8_DOCX_MODULE、V8_ARTIFACT_MODULE明确指向本机已安装运行库，完整版本见environment.json。Windows子进程、原子重命名与Edge均使用获准的实际宿主执行环境；没有将沙箱EPERM误报为产品错误。

## 本轮新增22项

- 执行收敛11项：模型可见与宿主schema、缺正文、有效正文先保存、必需Word失败、附加格式降级、相同错误停止、JSON完整body投影、超长字符串续读、历史协议配对、预算分类、提交草稿直接渲染、写入后回复前恢复（部分内容同一用例包含多项断言）。实际总数以Node具名日志为准，不把断言数当用例数。
- 到期事实5项：跨行跨页与年精度、字段角色与多值关系、中文月精度及邻近数量、原件18事实组、同一台账真实五格式与最终聊天来源。
- 草稿恢复2项：导出前中断续接；参数校验失败时草稿及draft_ref可取回。
- 实际CLI引用分派1项：明确标注的本地合成协议stub调用真实run.mjs，已登记artifact_id误放asset_id仍可正确读取；未知ID仍拒绝。4次本地stub请求，0次公网模型调用。

以上分组含综合测试，禁止再加断言数量凑总数。原342项加本轮22项合计364。

## 六项跳过的真实原因

以下是既有具名测试的专用输入环境变量没有配置，不是声明功能通过：

1. real PDF text retains invoice leading zeros and page boundaries：V8_SMALL_PDF未设置。
2. nested schemas and ragged matrices fail before workbook creation：V8_SMALL_PDF未设置。
3. real XLSX readback preserves zeros, source symbols and literal formulas; tampering fails：V8_SMALL_PDF未设置。
4. real PDF render and split recover from an injected API 413, with provenance：V8_TEST_PDF未设置。
5. actual XLSX can be read, exported with numeric amounts and independently read back：V8_WORKBOOK_A未设置。
6. XML-forbidden original character gets explicit display representation and exact original sidecar：V8_SMALL_PDF未设置。

本轮新增的公开PDF、真实DOCX渲染、XLSX/CSV/JSON/MD/Word保存后回读与恢复用例均实际运行，不以这六项跳过替代验证。未新增这些专用票据测试材料来扩大本轮范围。

## 独立于单元测试的验证

- local-format-integration：真实公开PDF→同一事实台账→5种实际格式，0次模型请求。独立解析器逐行逐字段回读均为18组、核心字段一致；实际固定15的122处字段/标签证据跨度匹配来源。不是独立Gold。
- 真实模型：六次旧版/修复版CLI预注册运行，实际POST、失败、usage缺口均在API回执中。不能当作本地单测。
- 页面：真实Edge、上传/发送/下载事件、恢复操作及模型请求单独记page/e2e-results.json，不能用本地stub替代。
- 新真实留出材料与独立人工Gold：本轮0，尚未完成。合成月精度/跨页/数量反例仅用于开发回归，不冒称陌生材料盲测。

## 留存的初次失败

初始Word写入恢复问题、中文数量误识别、材料诊断层抢先拒绝成果ID均有原失败日志及修复后的具名回归。XLSX独立读取器最初误把标题/来源行当表头，原失败文件保留；根据真实文件表头位置重新解析后才通过，这不是产品少行或数据修补。候选归档曾有一次PowerShell参数错误，造成空候选启动失败，已保留日志并用验证后启动流程纠正，生产8884未受影响。

## 最终新增三项

- 新并行工具回执先完整呈现给模型，只有已呈现过的旧长回执才可压缩。
- 真实PDF多格式导出在首个XLSX写入后注入中断，恢复保留原ID/哈希，仅补缺少Word；变换标题/格式顺序也不重复生成。
- 同一已存到期台账本地转Word、再次请求取回原Word，零模型请求。

regression-fact-recovery.log专项7/7实际通过。页面本地恢复第一次脚本过早查询未刷新的DOM，后端已完成；保留该脚本失败。修正等待DOM完成的v2后，3次真实下载全部SHA一致，原失败状态保留、0新模型请求；独立openpyxl/DOCX XML回读均18组核心字段一致。
