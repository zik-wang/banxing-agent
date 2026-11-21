# 最终候选回执

候选已完成代码修复、358项回归通过及零模型网页取回/Word下载。已知源码说明和到期清单CLI核查通过；发布简报真实写稿仍超时，未交付，整体业务验收为partial，等待独立QA。

状态：READY_FOR_INDEPENDENT_QA；业务全量验收仍为partial。

候选：http://127.0.0.1:8964/

代码：e24bfce8d8821a565796b129d2a5898f2c05f75a

指纹：7cb9d1adb308cd0dd9efe7ecbbb53e84858d97ffbd31ece95b883c377873c007

实际自动回归：{'total': 364, 'passed': 358, 'failed': 0, 'skipped': 6}

网页验收：{
  "actualBrowserUsed": true,
  "uploadedFiles": 1,
  "pageErrors": [],
  "initialArtifactThenInterrupted": false,
  "sameArtifactIdsRetainedAfterResume": false,
  "wordDownloaded": false,
  "allDownloadedHashesMatch": false,
  "wordTaskStatus": "failed",
  "resumeTaskStatus": "failed",
  "scriptError": null,
  "url": "http://127.0.0.1:8964/#430820b7-0309-4c29-93c0-2ab7d5e4041e",
  "downloadEvents": 0,
  "workflowPassed": false
}

零模型网页恢复：{
  "workflowPassed": true,
  "downloads": 3,
  "actualQwenCalls": 0,
  "originalStatusesUnchanged": true,
  "artifactIdentityPreserved": true,
  "downloadReadbackPassed": true,
  "conversationURL": "http://127.0.0.1:8964/#2738b539-4e75-422d-b017-11d65458ed18",
  "evidence": "page15-local-recovery-v2/e2e-results.json"
}

完整成果与下载在V8-执行收敛与事实一致性-验收对照.html。根因、回归、真实调用、发布与回退分别见同目录文件。8884未替换，8874未操作，旧包/旧HTML/QA原始证据与1.5B路由保留。

剩余：- CLI case11 writing request timeout: no actual draft or export returned; requires controlled re-verification of writing stage.
- No independent human gold/reference or new real holdout evaluation.
- Explicit expiry parser covers limited labels/predicates; no zero-omission claim.
- Page case11 Word follow-up searched repeatedly after no draft existed, then stopped without delivery; needs deterministic missing-draft handling.
- Six legacy fixture-dependent tests skipped; see regression-results.md.
- The six CLI experiments used3bb0894; the final e24bfce candidate adds dispatch, visibility and recovery fixes. These later changes were locally/browser tested, not re-run as six cloud CLI experiments.
- Initial live page15 failed due fresh parallel tool results being compacted before first model exposure; fixed in be97520 and regression verified.
- be97520 live page15 wrote files but late cancellation hid delivery cards and resume regenerated an earlier XLSX; e24bfce fixes candidate recovery, demonstrated with actual local browser retrieval and injected real-file resume. No additional cloud retest after budget exhausted.
- Original failed page11 workflow and pre-fix page15 workflow remain failed; local recovery does not retroactively make them successful.

## 页面最终补充

真实Qwen页面先前发生中断后失卡，原结果仍为cancelled。最终e24bfce页面核对并取回原Excel与Word，后续Word索取复用同一文件；3次实际浏览器下载、0新模型调用，ID/SHA未变。下载Excel和Word均独立回读18组、核心字段一致。初次浏览器脚本未等待异步DOM刷新失败也保留，修正等待后v2通过。此前首次Excel旧续跑重生成问题已通过真实文件故障注入回归修复，未额外云端重跑。

本批CLI38次实际POST，页面预算入口另34次，其中32份已保存请求回执、2次在途取消缺最终回执；不把未知usage算0，金额unknown。

独立复验回执：D:\pro222\pccr-eye-gaze\qa-output\v8-convergence-remediation-20261103\fix-ready.json
