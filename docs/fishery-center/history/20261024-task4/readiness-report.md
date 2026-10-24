# 远洋资讯集成准备收据

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


本轮分支为 `integration/fishery-20261024`，工作区 `[private-local-path]`。准备阶段只读生产，未更改应用源码、生产数据、调度、审核决定、配置、凭据或安全设置，未执行模型调用。没有新代码提交、push 或部署；分支仍在基线 `605ac218a44a724bbcbd2c616706b331191c4ca5`。父会话提供三份成果后继续在同一会话集成。

已读仓库 `AGENTS.md`、`README.md`、部署/渔业模块相关文档及实际接口实现。本 checkout 无 `.agents/skills`；已读取 `[private-local-path]`，其中没有本轮渔业运行状态，因此当前状态以生产实测和此次用户授权为准。较早文档中“福建公告未启用”、旧20次额度等历史叙述不能代替当前配置。

## 已完成的实际核查

核查于 2026-10-23 16:16–16:22 UTC 左右执行；精确时间在各 JSON 收据中。

| 项目 | 实测结果 | 证据 |
|---|---|---|
| 共享主目录 | `feat/fishery-materials-mvp`，干净，HEAD 为 605ac218；未 checkout/reset | `git-state.safe.json` |
| GitHub | origin 确认为 `Maidamai/AIHOT`；`git ls-remote origin refs/heads/feat/fishery-materials-mvp` 返回完整基线 SHA | `git-state.safe.json`；本轮命令收据 |
| 线上版本 | API、web、唯一 manual processor、archive worker 均为 `original-605ac21`；AIHOT_RELEASE 为完整基线 SHA；同一镜像 ID | `containers.safe.json` |
| 实际源码 | 生产12个关键文件 SHA-256 与隔离基线全部一致，涵盖归档、JFA、流程、核查、预算、发布读门禁及站点模型/门槛 | `baseline-file-hashes.safe.json`、`production-file-hashes.safe.txt`、`readiness-checks.safe.json` |
| 费用 | 53条 received，估算 ¥0.699208，未决 ¥0，累计上限 ¥10，maxRequests=null；首尾账本哈希一致 | `production-snapshot-final.safe.json`、`readiness-checks.safe.json` |
| 公开读层内容 | `loadPool` 实际可见13条；首页 timeline cards=0。数据库原始 publications=16，不能把表行数当读者可见数量 | `publication-read-check-final.safe.json` |
| 运行队列 | 读取时 pgboss created/retry/active 作业为空。持久 flow 有29个 queued占位，不等于29个已排队收费作业；禁止直接批量重排 | `production-snapshot-final.safe.json` |
| 原站后半程 | analyses/facts/stories/reports均0，nonhistorical publications=0；无合格近期输入，不制造空刊 | `production-snapshot-final.safe.json` |
| HTTPS/鉴权 | 正常证书验证成功；匿名首页、全部、RSS 302，登录页200，管理员API与v1 API 401；保留现有私有预览边界 | `http-read-check.safe.json` |
| 回滚资源 | 当前605ac21镜像保留；已有 `[private-release-or-backup-location]`，含部署记录、配置、数据库/归档备份。仅检查存在，没有恢复演练或新备份 | `rollback-inventory.safe.json` |

生产根目录仍是 `[private-server-or-temporary-path]`。API/web分别只绑定127.0.0.1:39872/39871。API模型与通用采集均关闭，专用processor模型阀为既有true，archive的模型阀false且 `WORKER_PROFILE=fishery-archive`；外部推送没有开启。没有启动完整worker。当前配置模型别名是 `deepseek-flash`；本轮没有新请求验证供应商别名背后的模型版本，不把别名当永久版本保证。

## 现有来源与候选

| 来源 | 真实正常节奏 | 最近成功（UTC，快照） | 近期待采 / 历史暂存 / 修订检查 | 当前边界 |
|---|---|---|---|---|
| MARA工作动态 | 1小时、每轮最多5篇 | 15:40:44 | 0 / 15 / 5 | 正常周期已验证 |
| 福建省局动态 | 1小时、每轮最多5篇 | 16:15:34 | 0 / 67 / 5 | 正常周期已验证 |
| 福建通知公告 | 1小时、每轮最多5篇 | 16:17:38 | 0 / 72 / 1 | 正常周期已验证 |
| 日本水产厅新闻 | 1小时、每轮最多5篇 | 15:53:34 | 2 / 154 / 0 | 正常周期已验证，待采不代表合格新闻 |
| NPFC措施 | 6小时、每轮最多1份 | 12:14:44 | 目录待核13份 | 保留原法规周期，未纳入自动新闻派发来源 |

五源均当前配置下 `normalCycleVerified=true`、失败计数0、无暂停；基于真实job_runs、source状态与同revision核实。pg-boss的每分钟tick仅检查是否到期，不是每分钟采集。所有核心source.enabled=false，采集由专用归档控制器负责，不能据此误报“五源关闭”。`fishery.flow.dispatch` 当前包含MARA、福建动态、福建公告、JFA四源。IOTC没有活动归档配置或调度；未新增来源。

当前97份非测试文档中，74份尚无素材决定，22份有素材approved记录，1份rejected；是否当前合格仍须观察/来源版本和读门禁验证。新近候选的具体状态：

- JFA `aa4e2e7a-67f0-4244-8552-c90f19854928`，2026-10-23“11月3日から7日は「いいさかなの日」”：完整正文已归档，素材未审核，prefilter任务 `14eceb9c-e041-4448-aa55-2694c6178d6f` 为queued占位；没有排入活动付费队列。不仅凭日期或标题判断应当发布。
- MARA `5c4a718f-bb43-475a-b765-246725c0607f`，2026-10-22“1—9月水产品产量5389.68万吨”：素材已审，现有任务在score-2后rejected，attentionCandidate=false；保留原结论，不重评分凑数量。
- 福建 `23c399e6-1535-4b52-9c00-6c7e6ab238f0`，2026-10-19研讨会：旧generation任务failed。虽然首次发现时backfill=false，但现在不能当作新近报道，也不能无对账重发。
- 限定政策 `5f67141e-47ee-4521-bd66-7e842936c02f`：原日期2026-09-30、backfill=true；任务 `017e75a5-ae30-4036-a12a-6c4fb4758b5a` 为needs_human_review/human。预筛PASS，双分72/72（当前门槛60、calibrated=false），核查12/12 supported，human_decision=null，approved=false，published=false，发布绑定为空。仅正式审核的专项范围保持。

## 集成时需要守住的接口

| 层 | 当前文件/配置 | 三份成果的验收约束 |
|---|---|---|
| 来源发现与证据 | `official-columns.ts`、`column-batches.ts`、`column-progress.ts`、`column-db-progress.ts`、各适配器 | 原URL/原日期/哈希/完整正文与附件证据保持；最新发现、修订检查、历史补采分离；禁止先按关键词淘汰 |
| 来源登记与实际启用 | 核心 `sources`、`fishery_sources`，`fishery.archive.<column>`，`archive-worker.ts` | 登记、适配、启用、当前配置正常周期验证是不同状态；扩展来源需要完整接通控制器白名单、状态展示、调度与停用/回滚 |
| 统一主调度 | `WORKER_PROFILE=fishery-archive`，`consume-flows.ts`，`manual-processing.ts` | 仅非付费来源计划；手动/自动flow、publication、news等队列共用单处理租约和串行执行；不启动全量worker |
| 审核提名与付费边界 | `processing-eligibility.ts`、`automatic-flows.ts`、`authorization.ts`、`flow.ts` | 素材当前版本先获准；历史业务审核提名不得改变backfill或发布时间；receipt/attempt/配置快照不能被新identity覆盖 |
| 解释与最终决定 | `selection.ts`、`ai-draft.ts`、`ai-review.ts`、后台 `web/flow.tsx` | 预筛/双分/生成/结构化/核查各自有结果和回执；评分通过不等于事实、适用性或发布批准；没有用户标注不能宣称门槛已校准 |
| 读者页面与出口 | `publication-bridge.ts`接核心 `packages/backend/src/publication/`，`/all`、详情、主题、RSS/v1/Agent/MCP | 所有出口对当前审批/撤回/版本一致；首页只有获准近期输入，历史继续保留日期与类别；前端HTTP读取，页面不调用模型 |
| JMA生命周期 | 等待独立分支交付 | 校验产品身份、发布时间/有效期、订正、撤销、到期与乱序；缺失或HTTP失败不能自行推断解除；不能用新闻历史规则代替警报有效期 |

潜在冲突热点包括 `server.ts`、`archive-worker.ts`、`automatic-flows.ts`、`contracts.ts`、`materials.test.ts`、`materials.standalone.test.ts`、README/OPERATIONS/deploy说明。收到三个精确提交后先审差异和依赖，再决定合入顺序，保留各自行为与真实样本。不会提前以假定接口重写实现。

## 最小验收与部署顺序

1. 核对三个分支都基于指定基线，读取交付报告与完整差异，确认没有新凭据/安全权限变更、外部实付测试、IOTC接入或无依据门槛变化。先整合必要提交，不合并临时报告、私有归档、环境文件或密钥。
2. 使用可工作的 `[private-local-path]`。默认node为26.5；Homebrew node@24缺少simdjson动态库，本轮未修系统包。nvm Node24.15已真实执行version和两份快照脚本的syntax check。集成worktree暂未安装依赖；执行测试前准备本worktree的工作区依赖解析，不能让@aihot链接静默指向共享主目录。
3. 测试范围以实际改动为准：来源分支的真实公开样本前后对比与新/修订/历史分额、审核分支的解释与反例、JMA真实载荷的生命周期。再选既有 `materials.test.ts` 中“bounded business review”“automatic dispatch waits…”“selection persists…”“real pg-boss scheduled tick…”“private reader…”等受影响交叉用例；数据驱动变化必须保留原日期/版本与回执幂等反例。仅新迁移时运行迁移检查；模块类型检查使用 `tsc -p modules`；只有web/shared contract变化才增补相关web检查和构建。未在准备阶段跑完整测试。
4. 针对性测试必须使用独立_test/ci库、本地假服务和关闭付费/推送阀，使用仓库原tests/databases.ts隔离机制；本轮没有启动测试库。出现失败才扩大相应范围。页面合同变化再检查桌面/手机入口、空态、历史日期、待审核/失效状态和后台鉴权，不断言CSS细节。
5. 形成独立可回退提交并及时push。只从集成worktree产出构建材料，排除.env/.data。部署前再次核对生产release、账本、当前来源轮次、活动job、receipt和唯一处理器；正常停止并等待已发请求落账，不强杀或自动重试。
6. 新建该次回滚目录与数据库/私有归档备份，保留605ac21镜像和原配置。必要迁移按完整新文件名执行；四个进程部署同一SHA，沿用现有鉴权、端口、私有env和阀，不重配网络或授权。未批准的高影响文章不因部署同步而发布。
7. 部署后最小实际验收：版本与关键文件哈希、HTTPS/私有边界、已有13条与首页空态的预期变化、同账本费用、源状态、队列/租约、受限9-30政策未发布；新增来源/JMA必须取得真实正常周期与生命周期证据，不能手工短周期冒充。无新候选是允许结果，不能为验收人为增加数量。
8. 若回退，先排空新消费者并审计隔离旧版本不理解的新来源schedule、任务阶段和状态，再恢复旧镜像/配置；不得回滚累计账本、删回执或复活已撤回内容。现有备份只验证文件存在，尚未执行恢复演练。

## 交付与剩余事项

协调文件：`integration-agreement.md`。机器可读证据总览：`readiness-checks.safe.json`。完整当前生产快照：`production-snapshot-final.safe.json`；读层/周期快照：`publication-read-check-final.safe.json`。早期同名非final快照保留；其中早期timeline.count为空是采集脚本字段名问题，final已改为实际cards.length并读取为0，不是产品故障。

没有未解除的权限或连接阻塞。首次默认SSH身份被主机拒绝（publickey）；依据旧部署脚本改用既有souler.pem身份后全部只读核查成功，没有新建凭据。本轮未调用或修改Codex provider/session。

下一步依赖：父会话转交三个独立分支的精确SHA、报告、验证证据与迁移/启用说明。生产写入和付费处理尚未开始。若后续遇到真实不确定收费、在途作业、新权限或高影响发布范围不足，则仅暂停相关动作并给出精确状态，继续不受影响工作。
