# T2 摘要协议 v2：离线候选

本轮只修复23d3421有限复核输入中的摘要歧义，新增真实模型调用为0。v1的真实 `rejected / NOT_VERIFIED` 结果、原始输入输出和供应商回执均保留；没有用v2离线结果追溯改判。生产8884、独立QA工作树及原生产A→B→A记录没有改动。

## 摘要对象与规则

`scripts/t2-receipt-protocol-v2.mjs` 为每个摘要声明objectId、objectType、algorithm、encoding、representation、serialization、serializationVersion、normalization、normalizationVersion、byteLength和value。

- 算法固定为SHA-256，字节编码为UTF-8；未知算法或版本明确拒绝，不猜测。
- `sourceRawUtf8` 哈希传入解析文本值的精确UTF-8字节。它不是DOCX/PDF物理文件字节哈希。程序不trim、不改换行、不做Unicode归一化；无效原文Unicode会被拒绝，不静默替换。
- `sourceJsonStringUtf8` 哈希 `JSON.stringify(source)` 的UTF-8结果，包含JSON引号和转义。这是不同表示域，不能与原文UTF-8摘要直接判等。
- `financePlanJson` 哈希取数计划的JSON序列化结果。
- `calculatorReceiptJson` 哈希完整回执的具体JSON表示；它不等于旧receiptId的后缀。
- `receiptCoreJson` 哈希宿主按money-rational-v1重新计算、排除receiptId后的回执核心，保持该计算器构造顺序。旧receiptId明确绑定为 `MONEY-` 加此摘要。

JSON规则是ECMAScript JSON.stringify、无replacer、无space，应用序列化版本为 `no-replacer-no-space-v1`；不排序对象字段，不冒称canonical JSON。成员顺序变化可能改变JSON摘要，这只证明序列化表示不同，不能直接推断原合同文字改变。旧回执核心由已知版本计算器重新构造，不让模型猜历史字段顺序。原文规范化固定none，版本为 `no-normalization-v1`。

## 校验与提示构造

比较前先校验描述符，再比较对象和全部域字段。域不同返回 `comparable=false, equal=null`，不会返回“摘要不一致、原文被篡改”。同域分别重算，值或长度不符则拒绝。

宿主明确映射旧sourceSha256到sourceJsonStringUtf8、旧planSha256到financePlanJson、旧receiptId到receiptCoreJson。输入进入模型前会重算摘要，并用现有计算器重算计划和完整回执；真正的文本、数值、映射或描述符篡改会被阻断。现有摘要算法、回执ID和旧缓存没有改写。

`buildReviewMessagesV2` 将typed-digest-envelope-v2及已校验关系写入新提示；提示明确“宿主只校验摘要和既定计算，不代表金额提取完整或业务结论正确”。输出仍需原文、取数、换算及最终引用校验；rejected或uncertain不会被升级为verified。

有限操作员入口 `scripts/t2-real-receipt-verify.mjs` 已改为使用v2构造和校验。它仍保留原权限、模型配置、一次请求限制及请求级共享单槽规则。**本轮没有执行该真实入口**。历史v1代码可在23d3421提交查看，v1提示/校验模块保持原样。

## 本轮验证

10项新增协议测试加4项既有有限校验测试：**14通过，0失败，0跳过**。没有重跑134项全批，也没有付费采样。

用明确标注的合成输入覆盖中文、CRLF/LF、JSON引号与反斜线、BOM及空格、空串、Unicode组合形式、JSON对象字段顺序、篡改原文/摘要/算法/版本/映射/回执金额。对重新排列字段但业务内容相同的回执，宿主重新建立其具体JSON表示，同时通过版本化构造顺序核对旧receiptId。

另外，仅在内存中为既有获准合成案例构造v2消息，确认原文摘要、JSON字符串摘要、计划摘要及回执核心摘要均可重算，旧回执ID保持不变；只保存脱敏身份元数据和新提示指纹，没有复制原材料正文。

重跑定向检查：`node --test tests/t2-receipt-protocol-v2.test.mjs tests/t2-receipt-verification.test.mjs`。

## 未验证范围

v2尚无真实模型复验，不能声称它一定消除了模型的来源拒绝。独立QA尚未确认协议归因。原生产B计算与A复核仍缺完整证据，本候选不代表T2业务复核或生产A→B→A通过。未来任何获准SF调用仍须单槽完整消费，并分开记录排队与模型响应耗时。
