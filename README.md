# 伴行 V8

伴行是一款可以用日常语言交办工作的办公助理。上传材料，告诉它需要什么，再在同一段对话里修改和下载成果。比如，上传两份采购公告，说“比较这两份公告，告诉我改了什么，给我一份 Word”。

**[打开 V8 源码](v8/)** · **[查看真实案例与验证记录](v8/docs/progress/worker-01-latest.md)**

## 启动网页版

需要 Node.js 22.19 或以上版本、npm，以及可访问的模型服务。下载本仓库后，在仓库根目录执行：

```sh
cd v8
npm ci --ignore-scripts
```

把已配置的 V8 网页服务配置文件放在当前目录下的 `.local-runtime/v8-web-config.json`，然后运行：

```sh
node v8-web/server.mjs .local-runtime/v8-web-config.json
```

打开终端打印的本机网址。端口由配置决定，默认是 `http://127.0.0.1:8848/`。本机服务配置及凭据需自行提供。[网页版说明](v8/docs/v8-web.txt) · [模型切换说明](v8/docs/model-switch-and-contract-review.md)

## 试一个实际任务

上传同一项目的原公告和更正公告，请伴行生成变化对照表。下载 Word 后，可以继续说“把还没确定的单列出来，更新 Word”。在已记录的公开材料案例中，经过追改和修复，最终文档区分了两项日期变化、五组技术变化和待确认事项。验证记录保留了首稿的问题、修改过程和最终文件核对结果。[查看案例](v8/docs/progress/worker-01-latest.md)

## 项目入口

- [网页与对话](v8/v8-web/) · [文件处理与导出工具](v8/v8-tools/)
- [本页收录的 V8 原始提交](https://github.com/zik-wang/banxing-agent/tree/f17165bc2dd1d9c4ef3481de24e850a98efb22d3)
- [历史版本 V7](https://github.com/zik-wang/banxing-agent/tree/v7-mentor-handoff-20261023)
