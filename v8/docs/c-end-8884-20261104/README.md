# 8884 真实C端验收入口（2026-11-04）

本批十项均有真实页面运行与下载证据，其中包含多轮修改；没有把离线成果导入对话冒充运行。以下链接指向开发机当前工作区的真实对话和已验证文件。`127.0.0.1`只指运行者自己的电脑，mentor在另一台电脑克隆代码不会自动得到这些历史对话。

冻结代码：`3824f5ebba991b6603ea293810df7060087a4fff`；运行指纹：`1cd363a4b398aeea17150a4d419edfa590a25558981d629e127861cf3a48590b`。验收说明分支：`codex/c-end-8884-acceptance-20261104`，未合并main。共享开发树后续架构提交不纳入本次固定版本验收。

## 先看这三条

1. [采购表合并→领导Word](http://127.0.0.1:8884/#3f480fe0-992f-4116-a494-3ec4b859d6ce)：实际核算30行、275,012,056.75元、15条来源说明非空；金额列为数值，Word主文引用对应表格版本。
2. [版本变化对照](http://127.0.0.1:8884/#080be3b9-923b-4dc9-b460-7fb89c2c5d7a)：5项技术、2项日期变化与未读附件分开。
3. [三份README选型](http://127.0.0.1:8884/#282016fc-742c-4516-9a50-a54a0b4edd5d)：已阅读材料与未核实许可、文档宣称与实测分开。

## 十项真实会话与推荐文件

### 03 会前背景资料准备

[打开真实对话](http://127.0.0.1:8884/#fbeee86f-7f8d-4e0b-8e96-f6161897c0af)

已回读分离政策文本、吹风会与地方会议，修正编写日期和统一统计时点推断；追加的800字限制未严格满足，不计为篇幅验收通过。

- [下载 服务业扩能提质政策摘要（800字内）.docx](http://127.0.0.1:8884/api/conversations/fbeee86f-7f8d-4e0b-8e96-f6161897c0af/turns/8e7c3613-6d85-4a1a-9d55-38c850b804f1/files/139d8636-fc6d-410d-a188-85e308181394/download) · SHA256 `d905d1a22db8a7231fa6a9c4108d63db8413692d57c4c878de23087c1b1bacf5`

### 06 查找最终文件与确认依据

[打开真实对话](http://127.0.0.1:8884/#21308b03-6a52-48ee-a5d3-78f9398a3f04)

核对项目编号、三名候选人及报价，区分候选公示与最终通知/合同；没有从未取得后续文件推断现实业务未发生。追加篇幅约束仍有偏差。

- [下载 材料核对说明.docx](http://127.0.0.1:8884/api/conversations/21308b03-6a52-48ee-a5d3-78f9398a3f04/turns/98a9935b-e73f-463b-b09d-c068c7b9d780/files/de4db95f-b330-42cb-b034-41a3ae6a5ec1/download) · SHA256 `1db92a8a0f55a8cbcbfa830ab916daaa5e9dfa2f71aa0da2fb1d245fc160c2f5`

### 08 合同或方案版本比较

[打开真实对话](http://127.0.0.1:8884/#080be3b9-923b-4dc9-b460-7fb89c2c5d7a)

开发回读确认5项明确技术变化、2项日期变化，SSD不变，第七项未展开及未提供附件明确列作缺口；这是已知材料复测，不是陌生材料召回率。

- [下载 070GXH2026096 更正公告对比摘要.docx](http://127.0.0.1:8884/api/conversations/080be3b9-923b-4dc9-b460-7fb89c2c5d7a/turns/b33f1b1b-3fc1-408e-839b-0129c388b71f/files/4b1815c2-af68-4b8b-a8e4-edf7367229ee/download) · SHA256 `a57c85f775144519f51c57923bea2ea443a1f328c57ca517786ecf73b1436232`

### 10 按规则追加业务台账

[打开真实对话](http://127.0.0.1:8884/#3f480fe0-992f-4116-a494-3ec4b859d6ce)

实际Excel为30条数据、9列，独立求和275012056.75元、15条来源说明非空，Word主文统计一致。额外的去重复查回合曾失败，原Excel保留；不能把整条连续修改链判为全通过。

- [下载 合并报表.xlsx](http://127.0.0.1:8884/api/conversations/3f480fe0-992f-4116-a494-3ec4b859d6ce/turns/fb7ef79b-9ccc-45e2-9433-3f4104adc997/files/1c8ba2f1-e07e-4a48-880f-dd426aff1f26/download) · SHA256 `6e6a7e665c9f2a19379cae0b766f3e397aaa6148962b9b1ac0a39bada2e62046`
- [下载 业务数据统计报告.docx](http://127.0.0.1:8884/api/conversations/3f480fe0-992f-4116-a494-3ec4b859d6ce/turns/150cfed1-e43e-4196-bbdc-40a89e51a246/files/7379b132-2966-4392-839d-38085a2693ce/download) · SHA256 `1a6691d3ea3971b73a89e0061517e1d1b3f0442cc3aebd105abda40da0fab8c8`

### 11 有依据的个人周报

[打开真实对话](http://127.0.0.1:8884/#9472a75e-2d08-458a-a504-8a63359f12b8)

最终成果表核对原JSON五条发布记录的版本、完整发布时间、发布者；不把公开成果写成个人进展或硬件性能认证。同一最终回合重复导出两份同名Word，推荐最后一份；两份正文一致但文件SHA不同。

- [下载 FunASR 阶段工作简报（修订版）.docx](http://127.0.0.1:8884/api/conversations/9472a75e-2d08-458a-a504-8a63359f12b8/turns/8be082df-a728-4550-b97c-b43427b9ce28/files/f7f7290f-7cbd-46a9-a7e9-c66ad54abcc0/download) · SHA256 `d569a3da8a4d06af99dcb5ca8cf193a1929a06963e85c0749222f32a30dbd119`

### 13 技术选型与可核查比较

[打开真实对话](http://127.0.0.1:8884/#282016fc-742c-4516-9a50-a54a0b4edd5d)

三份README实际进入最终报告；代码与模型许可分开，CosyVoice未提供许可留待确认，不拿动态徽章当安装版本。旧版同句曾重复检索失败，新版同句实际交付Word。

- [下载 语音AI组件选型简报.docx](http://127.0.0.1:8884/api/conversations/282016fc-742c-4516-9a50-a54a0b4edd5d/turns/39c4ee4c-0446-4d40-aa52-967c81f8e1ac/files/163e4f78-2b7b-42b4-b202-c9b3d3470ce5/download) · SHA256 `28c46be59079231de3e2b96ea98bca73448c9ac0a0ff85267c02192e770fcccf`

### 14 收藏沉淀为知识库

[打开真实对话](http://127.0.0.1:8884/#fe53f52e-8bf8-42d5-b00e-ea6c8937b74a)

全文条目持久保存，按指定字面查询取得入职0、发票69、电子发票13处命中并交付全部已取得原句；不等于跨语言语义召回，0字面命中不等于没有相关内容。

- [下载 知识原句检索结果.txt](http://127.0.0.1:8884/api/conversations/fe53f52e-8bf8-42d5-b00e-ea6c8937b74a/turns/272b749a-7b56-4d7d-b529-bab0002273dc/files/d446b5c3-a40b-4af1-b1ac-ff21b7dc575c/download) · SHA256 `8c4dfc907abd07fc013be7b6eba1194842f86ed7ba35e13826c7ce92df2fbf95`
- [下载 知识原句检索结果.docx](http://127.0.0.1:8884/api/conversations/fe53f52e-8bf8-42d5-b00e-ea6c8937b74a/turns/2d4c5663-206b-4172-b65b-d1d0ab32be2e/files/29a3798a-ae2e-4bce-a372-8b8d40aa0c9d/download) · SHA256 `3f71b965a05f46a0f4c313d1c097760f7ec35c13bceb6a249faf5dd790d7c79f`

### 15 订阅与合同到期管理

[打开真实对话](http://127.0.0.1:8884/#27950f3d-4647-452a-873f-d947a4232b35)

18组原文事实，122处引文跨度已对回PDF；不是18份独立合同。保留原词、年精度及并列歧义，时区、续约和合同供应商无依据不补值。

- [下载 清单.xlsx](http://127.0.0.1:8884/api/conversations/27950f3d-4647-452a-873f-d947a4232b35/turns/271f9188-c996-4d21-a0ba-1fc299b1046d/files/382e7ed7-18df-4859-90d7-a6784efb70f7/download) · SHA256 `76042095dfe30561e7273be14b672436f062c05890138e647bc2da1eeb8cf7a8`

### 18 长音视频主题片段导出

[打开真实对话](http://127.0.0.1:8884/#b0b2d571-a094-456e-ab4d-42c6bf6bc28d)

真实18分01.88秒录音仅本地识别，13段均返回，交付TXT/SRT；云端模型回执为0。尚未人工核听，分段时码不是逐字强制对齐，不能报告转写准确率。

- [下载 录音转写原文_未经人工核听.txt](http://127.0.0.1:8884/api/conversations/b0b2d571-a094-456e-ab4d-42c6bf6bc28d/turns/e3b61f0c-1576-4086-af82-9887d8e44f1b/files/aa6f26d0-bff4-4608-9557-2df99381b03a/download) · SHA256 `05a727361250f13be8e97381e87ffcd8c429bb0b197c401396815ef030d17533`
- [下载 录音转写原文_未经人工核听.srt](http://127.0.0.1:8884/api/conversations/b0b2d571-a094-456e-ab4d-42c6bf6bc28d/turns/e3b61f0c-1576-4086-af82-9887d8e44f1b/files/abdabf94-9c4d-498f-996c-11ea6d56b164/download) · SHA256 `f2282e982c8d1b545b0f7b4c82bd208cdf35e82369ad9340056652638c234573`

### 19 限定范围代码修复与PR

[打开真实对话](http://127.0.0.1:8884/#8afd3a2e-1d0b-4d82-8569-2845d3fe9dcc)

原源码SHA和唯一before核对后生成副本/补丁；没有执行上传源码或创建PR。仅静态与保存回读通过，未宣称运行回归通过。

- [下载 修改副本-CSVExporter-pyqtgraph-0.11.0.py](http://127.0.0.1:8884/api/conversations/8afd3a2e-1d0b-4d82-8569-2845d3fe9dcc/turns/71583418-0100-4766-8815-0b852e0b0122/files/c1415974-3a6d-4f7a-b79b-85f8f733ef81/download) · SHA256 `4b87bddffd62d27923bfdeadf15289c1e37d67025e7335620ba631943defeb39`
- [下载 CSVExporter-pyqtgraph-0.11.0.py.patch](http://127.0.0.1:8884/api/conversations/8afd3a2e-1d0b-4d82-8569-2845d3fe9dcc/turns/71583418-0100-4766-8815-0b852e0b0122/files/1ce0b3a7-3062-4445-9850-4bebe9292b8a/download) · SHA256 `388cffad6727a6c0a1fd7c698da96f0a6d4af1e57fdc261880437b0307150d19`

## 必须保留的结论边界

- 10项都有真实可下载成品，不等于10项首次自主成功，也不等于全部C端验收通过。若干成品经过开发人员以普通用户消息提出纠正要求；聊天和文件历史全部保留，没有手工改写本轮页面成品。
- 10的追加去重复查曾失败；11同回合重复导出同名Word，重复卡片问题仍在。部分追加篇幅限制没有严格满足。长报告仍可能等待数分钟，需要人工检查无依据推断。
- Word已实际下载、结构与内容回读；部分正文仍保留Markdown标记、表格顺序和原生分页未逐页视觉验收，不能承诺正式公文排版已通过。
- 14验证的是持久化和字面检索；18尚未人工核听；19按授权只做静态修改。它们各自不能证明语义召回、转写准确率或运行正确性。
- 独立人工Gold为0，不能计算可信Precision/Recall或宣称陌生文件零遗漏；这批已知材料也参与过调优。
- 当前模型为硅基流动公网 `Qwen/Qwen3.8-27B`；录音仅本地ASR，选定录音对话云模型回执0。本轮没有重新验收本地1.5B合同联审、日历、群聊、所有Office格式或便携包。
- 部分会话来自前一冻结版本，最终3824f5e保留其历史并重新核对下载。最终版重新执行11/13；不是十项全部重新调用模型一次，也不把文件回读算成新模型推理。

## 代码与环境

先使用本页指定分支：

```powershell
git clone --branch codex/c-end-8884-acceptance-20261104 https://github.com/zik-wang/banxing-agent.git banxing-agent-c-end
cd banxing-agent-c-end
```

依赖安装参考下面旧部署说明时，仍使用上方分支，不要跟随其中旧分支名重新克隆。

使用 [V8部署说明](../v8-siliconflow.md) 的依赖步骤；本分支真实入口是 `node v8-web/server.mjs <本机配置.json>`，`npm start`仍是旧V7入口。

本次宿主显式启用 `executionRepair: true`、`expiryFactRepair: true`、`documentComposition: true`；Qwen连接设置 `streaming: true`、`maxTokens: 8192`、`maxAttempts: 2`、`timeoutMs: 600000`，任务预算 `maxRounds: 24`、`maxCalls: 100`、`timeoutMs: 1200000`。按电脑配置真实Python、docx与Artifact模块路径；这些依赖不是模型上下文长度，也不是无限调用预算。

本机启动脚本在 `.local-runtime/start-external.ps1`，指向固定快照和原有数据；实际密钥、配置、历史工作区、录音、转写及模型权重不提交。本次没有替换旧便携包。

## 证据说明

- [机器可读结果、下载SHA与开发回读范围](results.json)。所有推荐下载均同时核对实际文件、登记SHA和当前8884的HTTP回读，并有真实浏览器下载记录。
- 独立冻结工作树补齐Artifact/Excel依赖后实际全量回归：413项，408通过、0失败、5项因指定PDF样本路径未配置而跳过（其中156页视觉测试不在本批修复范围）。单元、合成故障注入、真实模型、历史文件取回和内容审查分别留证。
- 本机完整原始日志：`qa-output/v8-c-end-8884-20261104/`。首轮错误、驱动竞态、移除尚未执行的测试消息、格式修订及各轮API回执均保留。该目录未整体上传，避免混入密钥与历史私有材料。
- 本次独立QA尚未签收；不要用开发回读替代mentor陌生材料验收。
