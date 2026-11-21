# Mentor 独立评估

目标：用户首次交办，后续只说修改要求，每次获得真实文件，始终修改明确成果。评估时记录 commit、模型配置标识、原始文件 SHA256、原话、操作记录和产物，不在看到评估答案后将同一数据宣称盲测。

config/mentor-evaluation-cases.json 给出 6 组共 30 项待执行检查；素材和参考答案由评审人独立选择。均为 pending，不能据此计算正确率。优先保留失败，不要求用户为适配程序改写原话。

## 六组流程

1. 多张真实票据 → Excel → 补列或补角色 → 更正 → Word → 下载。无法辨认的值仍待核，不得补造收件人。
2. 两份报表 → 合并 → 去重 → 按不同字段统计 → 排序筛选 → 领导报告。核对币种、百分比、总计行、空值和源行。
3. 宽表 → Word → PDF。回读列、行、单元格；视觉检查中文及跨页。格式转换成功不等于完全复刻。
4. 已授权真实日历 → 查冲突 → 确认创建 → 回读 → 改期 → 取消。缺账号记 blocked；不能用 isolated 替代真实结果。
5. A/B → 指定 B → 排除 A → 换成果版本 → 刷新 → 继续。不可混入其他对话或已排除资料。
6. 导出失败 → 恢复 → 重试 → 服务重启 → 老文件下载。不能重复写入或丢失原件。

## 记录

使用 config/mentor-case.example.json 记录 expectedOutcome（先记录）、actualOutcome、artifacts、toolActions、blockingIssues、criticalErrors 和 humanReviewRequired。运行 node scripts/record-acceptance.mjs 记录文件哈希和不可覆盖的评审回执。真实素材及答案留在 data/，不提交仓库。

独立业务验收重点：一次表达是否完成全部要求；交付是否主动出现；修改是否落在正确版本；错误是否明确；用户需要额外补充几次。人工审定前 Precision/Recall 记 N/A；自动回归通过数只能说明程序测试结果。
