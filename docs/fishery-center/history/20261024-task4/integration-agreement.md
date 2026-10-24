# 本轮集成约定

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


状态：已完成三份交付集成，`a5a0f8c064d5c82a707af2f170582338bb8ff10e` 已推送并部署，三个新增业务源首个真实正常周期已通过。本文件是协调收据，不会自动被其他会话读取。最终结果与待办见同目录 `DELIVERY.md` 和 `delivery-status.json`。

1. 唯一集成与生产部署工作区：`[private-local-path]`，分支 `integration/fishery-20261024`。起点为 `605ac218a44a724bbcbd2c616706b331191c4ca5`。共享主目录 `[private-local-path]` 保持 `feat/fishery-materials-mvp`，禁止在该目录 checkout/reset、清理或覆盖其他修改。
2. 业务信源会话 `01a16986-c75e-7482-a543-9f77d130d02c`、内容审核校准会话 `01a16987-065e-77fd-bc46-fca2f41af01b`、JMA生命周期会话 `01a16987-488b-7196-a877-a0d2d8ce702d` 只交付各自隔离分支。父会话转交精确提交 SHA、工作区、交付报告、真实样本/针对性验证记录、依赖与迁移说明。集成者不抢先重写这三份实现，不依赖自动跨会话消息。
3. 仅本集成者可以在后续执行统一合入、push、生产部署和必要付费处理；每个合入保持可追溯提交，冲突结合三份最终差异解决。来源接入、审核模型和 JMA 生命周期须分别验收，不能以配置存在或 mock 通过替代真实正常周期。
4. 轻量针对性检查优先：先跑交付分支的新增/相关测试，再核对交叉边界；只有发现问题或受影响范围扩大才增加测试。不得默认全量测试。测试只连隔离 `_test`/`_ci` 数据库与本地假服务，付费/推送阀关闭；不把生产作为测试数据库。
5. 所有费用只使用既有 `deepseek-fishery-20261020` 累计账本，上限 ¥10、无调用次数上限，不能变成每日额度或复制账本。发送前核对任务、原回执、attempt、版本及唯一处理租约。pending/unknown 阻断，失败不能无依据重发；页读和预检不收费。
6. 保留真实日期、历史展示、当前证据版本、全文许可和鉴权。不得降标凑新闻数量、伪造时间或接入 IOTC。新凭据、网络安全或权限变更须独立确认；既有部署授权不扩大这些范围。
7. 指定政策文档 `5f67141e-47ee-4521-bd66-7e842936c02f` 本轮仅正式审核，禁止自动终审/发布或借批量同步发布。保留 2026-09-30 原日期和历史身份。其他高影响政策/安全内容也须落在明确的发布批准范围内。
8. 部署前保留旧镜像和配置，并新建当次数据库/私有归档备份；正常排空旧处理器，再核对未决费用及租约。API、web、archive、processor 使用同一提交。回退保留账本、原件、回执和新状态；旧程序不理解的新队列/阶段必须先隔离，不能用恢复旧数据库消除费用或审核记录。

准备阶段历史结果与最小验收矩阵见同目录 `readiness-report.md`。没有修改 Codex 会话、provider、生产安全设置或凭据。本轮生产写入已收尾；JMA 未上线，JFA 暂停与 NPFC PDF 脚注问题保留证据阻断。原 13 条历史内容保留，新素材 1、发布 0、新模型请求 0，累计估算仍为 ¥0.699208。
