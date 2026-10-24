**预筛、评分、写作、审核、发布与公开读取：原版与当前版只读对照**

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


采用父任务已核定的两个固定快照：原版 `KKKKhazix/AIHOT@b3998dc6fc138eb9659f33f55eb38c1c716f0d57`（下称 U），当前部署/远程 feature/本地 integration 对应 `a5a0f8c064d5c82a707af2f170582338bb8ff10e`（下称 C）。没有把工作主目录 HEAD 当现版。已读两边 AGENTS、README、selection 文档，并重新追源码；变更理由文档仅作为历史解释，不作为实现成立的证明。

结论是：原版没有逐篇强制人工终审；当前版增加了素材审核、带引文的生成、第二遍证据核查和最终决定。现在终审以后的队列已能接到原版发布、事件归组和精选，不能再笼统描述为“后半段完全断链”。但审核按钮的承诺与发布副作用相反、结构化标签被覆盖、旧待审结果因全局规则升级失效、公开读取反复执行全站管理员对账，均有明确源码证据。指定政策通过价值与证据核查，不是拒绝；也没有发布授权。

本轮只读源码及明确允许的既有安全证据文件，没有运行服务、测试、模型、数据库语句或生产操作；唯一写入是本报告。源码结论与既有运行证据分别标明，未把合成测试当运营正例。

**两条实际调用链**

| 环节 | U：原版源码行为 | C：当前渔业链行为 |
| --- | --- | --- |
| 预筛 | `runAnalysis()` 只因 BLOCK 停止，UNKNOWN 继续；仅有标题且无可展示原帖才等待材料。[U analyze:477](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L477) | 复用 `runSelectionPrefilter()`，但 `runFisherySelection()` 只允许 PASS，UNKNOWN 也停止。[C selection:44](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/selection.ts#L44) |
| 双评分 | 同一评分标准两次独立请求，和达到两倍等级门槛才成为候选；显示均值向下取整。[U analyze:268](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L268)、[471](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L471) | 复用同一 `runSelectionScores()`；两张不同回执、原等级门槛，未另造评分算法。但不足门槛即停在 `needs_evidence`，不生成“全部动态”简稿。[C selection:35](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/selection.ts#L35)、[flow:456](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L456) |
| 结构化 | 与评分并行，抽分类、标签、主体及 scope/fact；写作等它完成。[U analyze:485](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L485) | 新闻在生成后复用 `runStructure()`，结果纳入第二遍核查，不是凭摘要伪造 fact。[C flow:484](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L484)、[news-structure:9](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-structure.ts#L9) |
| 写作 | 高分及近门槛走 `runUnderstand()`，其余走 `runSummarize()`；独立标题、摘要、推荐理由，配实体与措辞保护。[U analyze:333](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L333)、[416](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L416) | `prepareFisheryDraft()` 输出最多两句带证据摘要及日期、机构、地区、事件状态；第一句又被拿作标题，投影的推荐理由固定 null。[C ai-draft:61](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/ai-draft.ts#L61)、[reader:32](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/reader.ts#L32)、[news-editorial:29](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-editorial.ts#L29) |
| 人工关卡 | 没有必经人工终审。`processRevision()` 分析成功后直接调用 `publishArticle()`，再排归组任务。人工 override 是可选更正。[U content:136](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/content.ts#L136) | 当前素材 observation/source revision 先 approved，生成和核查后停 `needs_human_review`；`decideFlow(qualified)` 再排发布任务。[C flow:201](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L201)、[557](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L557) |
| 发布与精选 | `publishArticle()`/`publishArticleTx()` 写 publications。分数只产生 `selection_candidate`；grouping complete 且有增量才 selected。候选先能进全部动态。[U publish:222](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/publish.ts#L222)、[286](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/publish.ts#L286) | `fishery.publication` → `syncFisheryPublications()` → `projectNewsAnalysis()` → 原 `publishArticleTx()`；新新闻再排 `fishery.news` → 原 `groupArticle()`/`publishArticle()`。[C bridge:165](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-bridge.ts#L165)、[news-editorial:56](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-editorial.ts#L56) |
| 读取 | publication 中共享 SQL 条件区分列表、精选、机器代表条目；详情允许未撤回 editorial 记录，含未精选内容。[U scope:22](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/scope.ts#L22)、[rules:39](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/rules.ts#L39) | 保留原公开读取层，加 `currentPublicationCondition()` 模块门控；每次验证当前素材/审批/投影。当前实现为全站重算，成本见后文。[C scope:24](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/packages/backend/src/publication/scope.ts#L24)、[bridge:98](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-bridge.ts#L98) |

“发布”与“精选”必须分开报告：publications 存在、`visibility=public`、详情可读、进入 `/all`、`selected=true`、机器出口取得代表席位，分别还有各自条件。后台 status=`qualified` 也只是触发发布续处理，不等于所有后续步骤已经成功。

**1. P1：按钮说仅内部审核，实际却触发读者发布和后续处理。**

`modules/fishery/web/flow.tsx:97` 明说“内部合格不会公开文章或开放全文导出”，按钮是“记录内部合格”；确认框第106行还要求确认“理解仅供内部使用”。后端 `flow.ts:580–583` 保存 `internalOnly:true`，同时 `enqueuePublication()`，且返回 `published:false`。`flowDetail():349` 即使已有发布绑定也固定返回这两个值。[后台文字](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/web/flow.tsx#L97)、[决定副作用](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L580)、[详情固定状态](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L349)。

这不是“只放进一个没人消费的队列”：`publication-queue.ts:17–25` 调桥接，`manual-processing.ts:59–72` 实际注册 publication/news 两类消费者；桥接第167行写核心发布，第171行排事件归组。[publication queue](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-queue.ts#L17)、[消费者](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/manual-processing.ts#L59)。

历史原因可解释但不能消除冲突：早期内部资料审查后来接入主站 publication；`OPERATIONS.md:63、101` 仍说“不产生公开发布/不写公开文章”，同一文件第11行却写“终审后发布”。这是旧内部审核语义没有随桥接一起改全。[旧承诺](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/OPERATIONS.md#L101)、[新主链](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/OPERATIONS.md#L11)。

准确风险范围：这是审核操作与共享读者投影之间的语义冲突，**不是本轮证明了匿名公网泄露**。既有最终运行证据标记 `live-private-integration-business-normal-cycle-verified`；2026-10-23 23:36 UTC 的匿名检查中 `/`、`/all`、RSS 为302，`/api/v1/items` 为401。部署入口仍私有，源码里的 PRIVATE_PREVIEW 主要管理缓存，不能把它当另一个审批决定。[最终阶段 (local original; provenance)](../../provenance/source-manifest.json)、[匿名检查 (local original; provenance)](../../provenance/source-manifest.json)。

建议统一成一个真实、明确的“批准进入当前读者站点”决定及真实的排队/失败/已投影状态；如果产品仍需要“只审核不发布”，它必须与排发布任务的动作分开，不能靠 `internalOnly` 文案表示。没有必要再堆一个默认开关。指定政策只获审核授权，不能点现在的 qualified 来完成所谓“仅终审”。

**公开读取和来源许可的具体层级，避免误述门控。**

1. `decideFlow():570` 必须当前素材审核 approved；素材 review 绑定精确 observation/source revision（`store.ts:73–84`），不是空缺即默认通过。
2. `eligibleReaderItems():26–36` 要求最新任务 qualified、文书未撤回、来源 editorial、任务权威且不 stale、素材 approved、证据核查完成、人工决定与快照匹配，并排除合成测试记录。
3. `currentProjections():38–47` 对新闻还要求实际达标分数、原来源等级、正文 hash；生成发布绑定。
4. `fisheryPublicationCondition():98–118` 要求 material revision、projection hash、资格状态 token、标题/摘要/分类/URL/标签/分数一致，`body_mode='summary'` 且非 syndicate；结构化新闻还要 matching analysis，精选还要真实归组及信息增量。之后继续受原 listed/selected/seated 条件限制。
5. 来源 profile 的版本及 hash 被绑定，**不等于 profile 的许可值已获准**。文章 reader/bridge 路径没有调用 `canExportSummary()`；`allowedSummary/allowedPublication/rightStatus` 未被单独检查。`canExportSummary()` 位于 `contracts.ts:173–175`，由素材 `exportBlockers():22–24` 等导出路径检查。因此“来源许可 unknown 会自动阻止文章摘要投影”不成立；当前私有预览与对外导出有意采用了不同边界。对匿名开放前应把产品承诺和门控统一，不能只去掉外层登录。

上述层级入口：[素材审核](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/store.ts#L73)、[reader](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/reader.ts#L20)、[桥接门控](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-bridge.ts#L98)、[许可布尔判断](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/contracts.ts#L173)、[导出门控](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/export.ts#L13)。

**2. P2：已付费抽出的新闻分类、业务标签被另一套关键词规则覆盖。**

原版以 `normalizeAnalysis()` 的结构化 category/tags/subjects 为来源，`publishArticleTx()` 仅在明确人工 override 时替换。当前 `projectNewsAnalysis():37–40` 已把这些真实结果写到 analyses，但 `reader.ts:11–18、37` 又根据最多两句摘要做关键词先后匹配；`publication-bridge.ts:45` 把 tags 压成单个分类标签，第152–158行一律作为 editorial_overrides 写回。这并非管理员逐条确认的分类 override。[U normalize](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L513)、[U publish](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/publish.ts#L276)、[C analysis](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-editorial.ts#L34)、[C 覆盖](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-bridge.ts#L152)。

结果可以直接从代码推导：即便 runStructure 正确给出“补贴融资”“船员/外籍用工”等业务标签，公开 p.tags 最后仅剩“政策/安全/市场/研究/装备/运营/资料”之一。`topics.ts:91–105` 对没有 category 的业务专题用 `p.tags && topic.tags` 匹配，而 `industry/topics.json:16–21` 等正是这种标签专题。因此经此新闻桥接的文章无法凭结构化业务标签进入对应业务专题；分类还可能被高优先级词误分。历史指南另有自己的业务 topic tags，不可混作新闻链已正常。[topic 条件](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/packages/backend/src/publication/topics.ts#L90)、[业务专题定义](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/industry/topics.json#L16)。

理由证据：`OPERATIONS.md:165、173` 把关键词分类解释为旧“内部资料整理”，这是可以理解的早期妥协；没有找到其在新闻结构化已接回后仍应覆盖模型结果的独立需求或准确率证据。建议恢复原版“结构化输出拥有分类标签”的单一来源，删除新闻路径的重复关键词分类和伪人工 override；旧参考是否仍需规则分类可单独处理，不动用户已定分类定义。

**3. P2：全局规则升级使已经 supported 的待审政策失效，且与已 qualified 记录区别对待。**

`fisheryConfigurationVersion()` 把生成提示、核查提示、规则版本、模型、输出额度合成一个全局 fingerprint（`ai-review.ts:46–49`）；它进入 `snapshot():53`。`inputFor():65–67` 只要新旧快照 hash 不同就拒绝。`flowDetail():334` 只对 status=`qualified` 的 v5.5 记录使用旧规则只读验证；仍是 `needs_human_review` 的旧任务走 v5.6，直接 stale。`decideFlow():571–575` 同样不能终审它。[全局指纹](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/ai-review.ts#L46)、[snapshot](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L42)、[旧版分支](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L328)。

这不是假设。指定文书 `5f67141e-47ee-4521-bd66-7e842936c02f` 的任务 `017e75a5-ae30-4036-a12a-6c4fb4758b5a`，既有只读文件保存 status=`needs_human_review`、stage=`human`、旧 fingerprint=`3006dd…`，PASS、72/72、supported/complete_input、终审空、发布绑定0。升级后的离线回放明确记录新 fingerprint=`868fbe…`，`originalConfigurationPreserved=true`、`requiresCurrentReviewForNewDecision=true`；12个 claim 与12条核查绑定仍完整。最终 a5a0f8c 证据又记录 `restrictedPolicyUnchanged=true`。[政策只读状态 (local original; provenance)](../../provenance/source-manifest.json)、[升级后离线回放 (local original; provenance)](../../provenance/source-manifest.json)、[最终状态 (local original; provenance)](../../provenance/source-manifest.json)。

正确表述是“历史价值筛选和事实核查已通过；仍未获人工发布决定，且按当前规则快照不可直接继续终审”。不能写“已拒绝”，也不能仅说“再点一次批准即可”。规则升级覆盖相关性和事件谓词，防旧产物自动冒充新审核有合理收益；但一个与政策事实无关的谓词修复也改变全局 fingerprint，使无内容变化的待审成果整体失效，成本已经发生。

建议保留不可变产物、规则版本及来源 hash，但把“新任务运行配置”与“既有审核事实是否仍有效”区分。先用已收原文、草稿和回执做离线影响评估，再由明确的窄复核决定能否复用；不要为解除 stale 自动付费重跑全流程，也不要直接补成 qualified。本篇仍受用户“仅审核，不自动发布”的限制。

**4. P2：单条公开读取会遍历全站合格稿，并为每稿重复做全局回执对账。**

原版 `loadRow():42–47` 是按 article id 查询。当前详情先 `currentPublicationCondition()`，其 `fisheryPublicationCondition():99–100` 读取全部 bindings，并调用未限定目标的 `currentProjections()`。它取全部 eligibleReaderItems，后者逐稿调用 `flowDetail()`；`flowDetail():335` 读取并核对归档正文，第345行调用管理员 `reconciliationState()`。该函数第217–222行的 `starts_with(r.purpose,'fishery_') OR ...` 取的是全体渔业回执，包括 response；每份合格稿都再计算一次。[C detail:44](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/packages/backend/src/publication/detail.ts#L44)、[C reader:28](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/reader.ts#L28)、[C reconciliation](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L213)。

可证成本是 N份合格文章的串行正文/资格读取，加重复加载 R份全局回执，趋近 N×R 的回执传输与 hash 工作；指南也另有逐条重核。不是说原文或 response 被返回给匿名用户，而是读者 GET 在服务器内部执行了管理员恢复任务才需要的计算。10秒维护循环也会反复走 shared selected condition。没有压测，所以不报告具体延迟、吞吐或已发生故障。

收益是撤审和来源变化立即关闭读取，应保留；应删除的是公开读取对管理员对账 DTO 的依赖。建议用窄的、同一份当前资格判断支持按 article/批次读取，只核准入必需的版本和绑定；全局账本、任务恢复和完整 response 对账留在管理员诊断/执行阶段。不能简单缓存“永远可读”或删掉撤审门控。

**额外 review 是否重复，哪些可以恢复原版。**

| 改动 | 当前收益 | 成本与判断 | 建议 |
| --- | --- | --- | --- |
| 两次评分 | 对价值判断保留原算法，两张独立回执 | 这是原有设计，不应因为“两次”就当新增重复 | 保留；门槛尚未完成行业金标校准，不改数字求产量 |
| 带引文的摘要+第二遍 claim review | 核对生成文字的主体、条件、数值、日期；与“值不值得看”不是同一问题；有真实旧误判/误写证据支持加强事实核查 | 同模型第二遍不等于独立信源或真值。新合格新闻通常是预筛1+评分2+草稿1+结构1+核查1=6次基础调用，原版通常5次，另不计归组、可选措辞修复等 | 不能一刀切删第二遍；应集中核查最终读者会看到的文案和归组事实，去掉对简单资讯无用的表单字段 |
| 三次相关性判断 | prefilter、draft.relevance、review 的 relevance claim 反复检查行业关联 | 同材料同模型可能串联误拒；旧“必须出现远洋/公海等”的草稿口径曾与宽预筛冲突，当前v5.6已扩展经营证据，不能继续报告旧口径未修 | 相关性与价值以原预筛/评分为主；事实核查只阻断具体证据错误，不再复制一套选材标准。需真实样本检验，不凭推测宣称放宽会改善多少 |
| UNKNOWN 与低分立即停 | 少花后续写作/核查费用 | 与原版“UNKNOWN继续、未精选仍可进全部动态”不同；低价值不等于证据缺失，却共用 needs_evidence 状态 | 恢复原版分层语义最值得讨论：未精选、证据不足、待人工决定、执行失败分开呈现。是否保留低分全部动态属于产品取舍；不应靠降精选门槛解决 |
| 两个人工关卡 | 素材审核确认输入版本；终审核对生成结果，两者对象不同 | 新闻量增加后每条至少两处等待；自动派发仍等素材approved，不是程序停摆 | 合并界面或减少重复操作可考虑，但不能在本轮取消用户要求的审核。让每个等待状态指明需做什么、是否已真正排队 |
| 原版结构/归组/发布复用 | 避免伪造fact或强制selected，当前已接入 | 另存任务、观察、绑定仍有管理成本 | 保留原核心身份与分析/事件模型；删除重复分类、标题摘要投影和永远published:false的旧状态 |
| 事件综述未启动、周月报无模型总述 | 不在已审稿后偷偷生成未经审核的新段落，也保持当前费用边界 | 输出丰富度低于原版 | 当前约束下保留，不能为“像原版”直接启动完整 worker；需要新生成内容时另明确审核对象 |

理由来源与更新状态：[纠偏记录第10行](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/docs/fishery-center/news-flow-correction.md#L10) 明示 BLOCK/UNKNOWN、低分停；[第四轮第120行起](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/docs/fishery-center/news-flow-correction.md#L120) 解释为什么仅补原结构抽取并复用归组，而非跑整套 analyzeArticle；[质量审查第15–20行](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/docs/fishery-center/review-quality-2026-10-24.md#L15) 记录真实误判，但“当前相关性口径仍冲突”的判断属于修复前基线；当前 [ai-draft:63–65](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/ai-draft.ts#L63) 已修。文档不能忽略版本继续复述旧缺陷。

**任务、触发器和消费者的核对结果。**

- `createFlow():91–107` 只建持久 queued 任务；手动 `enqueueFlow():626–634` 才排 `fishery.flow`。自动模式通过 `dispatchAutomaticDocuments():81–136` 扫描、检查当前素材批准后排队。所以“任务表 queued”不能等同“队列有可消费 job”，没有批准时等待是设计关卡。
- 专用进程 `scripts/consume-flows.ts:19–25` 调 `registerManualFlowConsumer()`，后者第48–78行消费 flow、publication、news 与原 source republish；第80–87行定期派发、更新热度和成刊。这里没有发现“有生产者但忘记注册消费者”的静态断点。[进程入口](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/scripts/consume-flows.ts#L19)、[维护循环](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/manual-processing.ts#L80)。
- `runNewsEditorial():56–67` 复用原 groupArticle，后者本身在成功/失败后重新 publish；适配器末尾再 publish，属于一次非付费重复投影，可简化，但远不如上述全站读路径成本大，不应夸大为主要故障。原 groupArticle 没有人工终审，`group_review` 是模型合并复核。[U group:234](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/events/group.ts#L234)。
- 历史 backfill 内容不会被 `enqueueNews():75–76` 拉进近期事件链；政策作为历史参考未进入精选，不能据此推断归组断链。当前成刊 `composeApprovedReports():108–129` 用真实非历史selected条目和原日报/周月报入口；未启用事件digest模型、周月报 `writeOverview:false` 是明确取舍。
- 上线后既有安全证据仍为 analyses/facts/stories/reports=0、非历史发布=0、可读13条历史内容，说明真实近期“评分→核查→人工批准→事件→精选→成刊”正例尚未出现。代码连接和合成回归不能替代该运营验收；也不能倒推为每一条真实材料都遭拒。[a5a0f8c最终计数 (local original; provenance)](../../provenance/source-manifest.json)。

**原版也不能原样当作安全或正确性的标准。**

原版 `docs/selection.md:6` 写 BLOCK 不出现在任何公开页面，但实际 `processRevision()` 对 BLOCK 分析结果仍调用 publish；`publishArticleTx():282` 默认 visibility 为 public，`rules.hasItemPage():44–45` 只检查非 withdrawn 与 editorial，详情 `detail.ts:79–81` 不检查 relevance。结果是 BLOCK 不进列表，却可能仍有 noindex 原文链接/标题详情；这与“所有页面都不公开”不是一回事。此行为有源码注释支持，不能仅照文档描述原版，也不适合取消当前渔业的未审材料隔离。原版引用校验和实体名 guard 同样不是全面事实核查。应恢复它清楚的责任划分和核心数据链，不恢复比本站需求更宽的公开范围。

建议推进顺序：先修审核动作与读者投影的语义；再让新闻分类标签回到原结构化单一来源；接着拆除公开读取中的全局管理员对账；最后处理版本升级对待审成果的窄影响评估，并讨论 UNKNOWN/未精选/素材人审的产品分层。本轮没有实施、发布、重新审核或批准任何内容，指定政策继续保持仅审核边界。
