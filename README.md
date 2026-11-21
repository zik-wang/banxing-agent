# 伴行 · 办公 AI 助理

上传文件，用日常语言交办任务，在同一段对话里修改并下载成果。伴行 V8 用工具读取文件、计算表格和导出文档，保留文件版本及来源，方便使用者核对。

**[进入 V8 源码](https://github.com/zik-wang/banxing-agent/tree/codex/c-end-quality-20261104)** · **[查看真实案例与验证记录](https://github.com/zik-wang/banxing-agent/blob/f17165bc2dd1d9c4ef3481de24e850a98efb22d3/docs/progress/worker-01-latest.md)**

## 一个实际案例

用户上传采购公告和更正公告，问“比较这两份公告，告诉我改了什么，给我一份 Word”。首稿把联系方式的角色写错，追改时还出现取回旧稿的问题。修复后，最终下载的 Word 对照列出两项日期变化和五组技术变化，把材料中无法确认的事项单列。该案例经过多轮修改，末页排版仍有改进空间。

## 使用与开发

- [V8 网页使用说明](https://github.com/zik-wang/banxing-agent/blob/f17165bc2dd1d9c4ef3481de24e850a98efb22d3/docs/v8-web.txt)
- [办公工具实现](https://github.com/zik-wang/banxing-agent/tree/codex/c-end-quality-20261104/v8-tools) · [网页实现](https://github.com/zik-wang/banxing-agent/tree/codex/c-end-quality-20261104/v8-web)
- [专项报告及其他交付](https://github.com/zik-wang/banxing-agent/blob/codex/afk-progress-board-20261104/docs/progress/README.md)

下载 V8 源码：

```sh
git clone --branch codex/c-end-quality-20261104 --single-branch https://github.com/zik-wang/banxing-agent.git
```

## 历史版本

[V7 试用说明](v7/MENTOR-START-HERE.md) · [V7 原发布快照](https://github.com/zik-wang/banxing-agent/tree/v7-mentor-handoff-20261023)

从默认分支下载 V7 后，进入 `v7` 目录运行 `START-WINDOWS.cmd`。
