# 候选发布与回退（尚未应用到8884）

候选入口：http://127.0.0.1:8964/
候选运行代码：e24bfce8d8821a565796b129d2a5898f2c05f75a
候选指纹：7cb9d1adb308cd0dd9efe7ecbbb53e84858d97ffbd31ece95b883c377873c007
冻结目录：D:\pro222\pccr-eye-gaze\qa-output\v8-convergence-remediation-20261103\candidate-runtime-e24bfce
宿主配置：同根目录 candidate-profile.private.json；含密钥文件引用，不提交Git，不向模型发送。
独立数据：同根目录 candidate-workspace；没有导入生产私有原件或私人录音。

启动：
```powershell
& 'D:\New Folder\node.exe' 'D:\pro222\pccr-eye-gaze\qa-output\v8-convergence-remediation-20261103\candidate-runtime-e24bfce\v8-web\server.mjs' 'D:\pro222\pccr-eye-gaze\qa-output\v8-convergence-remediation-20261103\candidate-profile.private.json'
```
当前已后台启动；请先访问 /api/build 核对，不重复占用同一端口。

## 8884当前边界

本轮只读取8884的 /api/build，不停止或替换。它仍是 d812cd1152963cb68daf8e6101bf6b924763c556 加原硅基流动连接补丁的旧冻结实例；最终指纹与健康状态见 production-protection.json。8874本轮连接读取失败，未启动、停止或改写它。

## 供后续审批的准确发布步骤

1. 先审阅 result.json、真实失败记录与未完成项目；不能把候选回归通过当业务全量验收。
2. 获得正式发布授权后，确认8884无后台任务、排队消息或运行会议。保留现有进程启动命令、production-profile.private.json、web-state/ResourceSpace/模型连接状态和旧冻结目录；不删除原件、历史成果或操作日记。
3. 从固定提交git archive创建新的只读运行目录，安装/引用现有同版本依赖。用生产配置副本增加 executionRepair=true；expiryFactRepair=true仅对明确到期清单启用，保留原1.5B配置与审核路由，不覆盖用户连接状态。
4. 先在新端口和生产数据副本验证历史成果下载、权限、Word与恢复。旧读取器能力检查点若不兼容，保留原任务并创建revise；不强改版本号伪装resume。
5. 空闲时才切换8884到固定候选目录和经过核对的配置。检查/api/build真实指纹、上传、下载、历史成果与一个短任务。迁移失败立即回到保存的旧目录/旧配置；保留失败证据，不覆盖旧数据。

本轮没有执行步骤2–5，不提供虚假的“已发布”结论。不得通过恢复旧web-state覆盖切换后用户新产生的数据；回退代码、配置和数据恢复是不同操作，需按实际写入情况处理。

## 实验版本说明

新旧六次CLI对照固定使用47a05c4（旧）与3bb0894（两阶段修复）。之后新增真实CLI合成回归发现材料诊断层先拦截成果ID，补0fabd92。该补丁不改变模型提示或事实生成逻辑；六次对照旧快照没有热替换，最终页面使用0fabd92。不可把3bb0894的真实调用说成0fabd92重新实跑六次。

最终6656cef另补：已保存正文在格式参数校验失败时，把draft_ref/version回传给调用者，便于直接恢复。三例CLI冻结快照未变，页面使用最终提交。

9415d21完成：宿主整体时间预算与用户取消/单请求超时分开记录；事实台账生成的最终摘要标记fact_ledger，并保留真实原始模型答复。本轮最终回归355通过、0失败、6专用输入未配置跳过。


## 最终实际候选

代码e24bfce8d8821a565796b129d2a5898f2c05f75a；指纹7cb9d1adb308cd0dd9efe7ecbbb53e84858d97ffbd31ece95b883c377873c007。后续be97520修复未呈现回执过早压缩；e24bfce修复本地取回、同版本多格式恢复。最终364测试：358通过、0失败、6跳过。页面零模型取回/原Word下载通过，旧页面失败保持不变。CLI六次仍固定3bb0894；不能视为最终版本又跑六遍。
