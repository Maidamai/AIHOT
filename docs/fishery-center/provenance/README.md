# 文档来源与脱敏约定

[source-manifest.json](source-manifest.json)逐项记录来源别名、原件 SHA256、落位路径、归档副本 SHA256、状态及未收录原因。`originalSha256` 是脱敏前原件字节；`repositoryFileSha256` 是当前归档副本字节，二者不冒称相等。清单本身不自含 hash；可由 Git 内容历史核对。

来源别名 `workspace-artifacts/YYYY-MM-DD/task-*` 指原本地任务产物，`repository-before-archive` 指本次整理前的既有仓库文档；本机私人临时绝对路径不入库。用户明确指定的固定开发目录保留在当前入口。所有原件仍保留，未删除、移动或覆盖。

正文处理仅用于归档可读性和安全：

- 页面首标历史快照，保留原日期/版本/失败和取代关系；当前部署事实只指向 current-status。
- 已存源码快照替换为精确 b399/a5/3a 的 GitHub blob 链接，不复制整个源码目录。
- 对已收文档使用仓库相对链接；未收原始证据的链接标为 local original，并指向清单，不伪装成已提交原件。
- 私人本机临时路径、非公开服务器 IP/SSH 目标、release/backup 位置脱敏；公开机构 URL、业务源码 SHA、必要相对仓库路径保留。
- 不收 `.env`、密钥、cookie/token/CSRF 值、私钥、完整业务库/账本、私密会话、Codex provider/session 配置、模型提示上下文、原件/PDF/截图/依赖缓存。

选择性证据摘要在 [production-acceptance-20261024.safe.json](../evidence/production-acceptance-20261024.safe.json)。它仅保留已验版本、计数、结果、范围与来源 hash；原始安全文件即便后缀为 safe 也不整包复制。历史计划、候选源或本地合成测试不自动升级为生产事实。
