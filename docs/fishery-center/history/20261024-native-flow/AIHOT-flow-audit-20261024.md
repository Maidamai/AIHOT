# AIHOT 原版与本站全流程对照审查

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


审查时间：2026-10-24 UTC。**只读审查；没有改仓库、生产、业务库或状态，没有调用业务模型，没有跑全量测试。**

## 结论

**原版是自动采集、分析、发布的资讯引擎；本站现版在常规自动资讯路径外面加了“先人工批准素材、再模型处理、再人工终审”的材料工作流。近期自动资讯生产仍没有真实成功闭环。** 原版的“相关内容进入全部动态”和“高价值内容进入精选”也被收紧成了“低于精选线就停止加工”。这两处产品行为变化，比单独检查信源更能解释为什么有原件、有任务、有费用，却没有近期文章。

不过，现版不是整段没有调度：自动派发、模型消费者、发布消费者、归组与成刊续处理都已存在。准确诊断应是：**输入很多仍停在素材审核；新增源未进入付费范围；部分已迟到成历史；少数已跑模型的分别被价值筛选、旧规则失败、人工决定或版本门控截住。** 不能把它们统称为“模型都拒了”，也不能把已有 13 条历史内容说成全站没有发布。

### 版本与证据边界

| 对象 | 本轮确认 |
| --- | --- |
| 官方关系 | GitHub API 当前返回 Maidamai/AIHOT 的 parent、source 均为 **KKKKhazix/AIHOT** |
| 最新上游 U | **b3998dc6fc138eb9659f33f55eb38c1c716f0d57**；与旧审查基线相同，这是本轮重新查询结果，并非沿用假定 |
| 本站 C | **a5a0f8c064d5c82a707af2f170582338bb8ff10e**；远程 feature、集成工作区与保存的实际部署记录一致 |
| 共享主目录 | HEAD 仍为 **605ac218…**，落后 13 个提交；本轮按 a5 的 Git 对象导出快照，没有 checkout/reset |
| 运行证据 | 完整生产快照截至 **10-23 23:37 UTC**，收尾记录 23:38；父任务提供的23:46口径没有被冒充为本轮新查询 |
| 原版生产数据 | 未取得原站数据库/实际配置。[上游 README:55](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/README.md#L55)明确不包含真实信源名单、运营数据；18 个示范源和截图不能证明实际产量 |

版本出处与精确查询时间见 [version-evidence.json (local original; provenance)](../../provenance/source-manifest.json)。下文 U/C 均链接固定快照，避免工作区版本漂移。已读 AGENTS、README、相关 docs；范围内未发现 .agents/skills 或 memory_summary。用户授权的并行审查使用 Astra/max，结论交叉核对。

## “发布 0”具体停在哪里

保存证据中的不同分母不能混用：

- 新三源首轮：**1 条完整 MPA 入库、0 次业务模型请求、0 条新发布**。
- 当前统一读层：**13 条历史内容，近期时间线 0**；物理 publication 表有16行，不等于16条当前可见稿。
- 98 行材料明细：**75 条未有素材决定；29 条 queued 流程全部未获当前素材批准**。这批含历史、试点及隔离材料，不是98条近期候选的拒稿率。
- 核心 analyses、facts、stories、reports 均为0：没有合格近期材料走到已审核心投影和事件成刊。
- 费用：累计 **53 次、估算 ¥0.699208、未决0、上限¥10**。没有预算耗尽的证据。

统计来源、筛选口径、任务/收据 ID 见 [production-trace.md](production-trace.md)，基于 task-4 已保存的 state-final、projection-final、首轮周期及容器安全快照离线复核。

### 真实消息一：MPA 10月22日港口通知

文档 **292f8e02-dcde-4bb6-9839-df372a1e142a**，核心 article **ak06yv2n1fkqsi2hka1r5q9iv**；[原通知](https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no-142-of-2026-power-shutdown-at-ica-crew-office-psa-pasir-panjang-terminalppt-4-crew-office)是 ICA 船员办公室停电安排。

实际已完成：

```
真实小时调度 → RSS 50条 → 排除非目标23条 → 保留27条
→ 本轮获取1篇页面及完整2页PDF → 同源/通知号/年份/正文核验
→ 文书+观察入库 → 同一核心新闻身份 → backfill=true
```

**真正停点有三层：**

1. **范围未接入。** 新 ITF/FAO/MPA 不在自动付费配置，且 [automatic-flows.ts:13](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/automatic-flows.ts#L13) 的允许枚举也没有它们；不是只差一个运行中的worker。
2. **进入历史。** 原日期仅 day 精度；[storeCapturedNews:262–268](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/store.ts#L262)按新加坡零点归一化为10-21 16:00Z，核心首次发现采用文档创建时刻10-23 23:34:17.904Z，差 **55.57小时**。沿用的 [decideTimeline:89–98](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/packages/backend/src/content/materials.ts#L89) 超48小时规则使其成为历史。这个零点不是原站已核验的真实发布时间；backfill_reason未被安全快照直接导出，原因由代码和保存的时间确定性重建。
3. **素材未审。** reviews=0、flows=0、publication=0。即使纳入范围，发模型前仍要求当前素材approved；历史还需要有界业务审核提名，当前提名范围亦不含MPA。

**它没有被模型评分或拒绝。** 后续路径本应是素材批准→预筛/双评分→生成/结构→证据核查→明确终审→发布/归组；这条没有执行这些阶段。把它改成近期、补造评分或直接发布，都不能算恢复原流程。48小时算法本身与上游相同，单纯“恢复原版”不会解除这个历史标记。

### 真实消息二：9月30日渔业支持政策

文档 **5f67141e-47ee-4521-bd66-7e842936c02f**；[政策原文](https://yyj.moa.gov.cn/gzdt/202609/t20260930_6488348.htm)。正式流程 **017e75a5-ae30-4036-a12a-6c4fb4758b5a** 已完成：

```
完整正文+素材approved → receipt40预筛PASS → receipt41/42双评分72/72
→ receipt43生成 → receipt44结构化 → receipt45核查12/12 supported
→ needs_human_review / stage=human → human_decision=null → 无发布绑定
```

T1门槛60，已通过；不是当下仍错用T2的76分门槛。它原日期9月30日、10月20日发现，本来就是历史参考，审核时间不会刷新原日期。

**停在两个具体边界：** 用户专项只授权审核、不自动发布；同时旧结果按v5.5生成，现版v5.6只兼容已经qualified的旧稿，此条待终审不会套用旧版兼容。[flowDetail:332–340](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L332)及 [decideFlow:571–578](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L571)要求当前快照，离线证据亦明确 requiresCurrentReviewForNewDecision=true。旧supported仍有效地描述那次审核结果，没有变成拒绝；却不能据旧页面stale=false直接终审，更不能自动重付一次来消除过期状态。

### 其余已跑或未跑的近期路径

- MARA“1—9月水产品产量…”：素材已批准，真实流程在双评分后 rejected、attentionCandidate=false；这是明确的价值筛选未过。纠偏文档记录实流42/38；最新安全投影只确认attentionCandidate=false。后来独立评估42/42是另一批收据，不能相互覆盖。
- JFA“いいさかなの日”：已有非backfill核心身份，但素材未批准、任务queued/prefilter，尚未被模型拒绝。
- 福建研讨会：旧任务停在 generation 的“举办”状态误拒；a5修了识别，但没有重跑旧任务，不能把代码修复当已发布。
- JFA两篇9月28日材料附件路径失败，连续3次导致整源暂停；NPFC CMM2025-06因脚注无法唯一映射而未导入，当前仅1次失败、6小时计划仍启用。JMA仅代码合入、未注册上线。这些是输入/解析问题，不是模型拒稿。

## 从入口到日报：双方实际行为

| 环节 | 原版 U 如何处理 | 本站 C 如何处理、为何改变及代价 |
| --- | --- | --- |
| 入口与调度 | RSS、web_list、json_list、X、公众号及推送，经核心collect/upsert/queueProcessing；full worker注册整条内容与事件链。[main:20–28](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/apps/worker/src/main.ts#L20)、[schedules:51–62](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/apps/worker/src/schedules.ts#L51) | 专用官方/业务适配器先归档原件、解析正文和附件，再桥接核心文章。独立archive与manual processor保障范围及累计预算；核心enabled=false是避免双重抓取。当前新三源已采集，不代表已纳入模型范围。 |
| 派发是否断线 | 正常采集后排处理任务；sweep补漏。[sweepUnprocessed:245](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/content.ts#L245) | **生产者和消费者都有。** 导入后派发，启动及每10秒也补查；消费flow/publication/news/republish-source。[import-batch:57](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/import-batch.ts#L57)、[consumer:48–87](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/manual-processing.ts#L48)。额外范围、素材approved、历史提名会挡在真正入队前，queued占位不是已运行。 |
| 首次/增量/日期 | collect.admission按初始化时间前48小时决定新旧档准入，已有身份仍可修订；公众号首次7天是真采集边界。核心decideTimeline另按首次发现判backfill。**不是仅显示规则。** [admission:94](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/sources/collect.ts#L94)、[decideTimeline:89](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/content/materials.ts#L89) | 新闻列回读最新列表，历史补采与增量分开；业务源检查窗口30天、每小时最多一篇，不代表30天内都算近期新闻。核心48小时未改；又叠加历史提名。好处是旧法规可留存，代价是归档范围、处理范围、近期展示口径多层分离。 |
| 同URL/去重/修订 | upsertMaterial保持URL/内容身份，变化增revision并重做投影/分析；不会因正常修订停源。[upsertIn:231](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/content/materials.ts#L231) | 复用同一核心身份，再绑定原件/正文/PDF/观察版本。正文或必要附件变化使旧审批失效；装饰性HTML变化只留获取证据。增强可追溯性，代价是重审成本。**正常同URL修订本身不暂停整源。** [storeCapturedNews:249](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/store.ts#L249) |
| 正文/附件失败 | 正文补取按条目重试，耗尽标unconfirmed，用已有excerpt继续判断；仅标题仍等待材料，错误正文不当全文。[registerExtractionJobs:204–235](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/content.ts#L204) | 法规/通知要求完整正文、必要附件、页码和脚注可证，超限不截断。保护义务、日期、例外不被丢失；但单篇附件失败会进入栏目partial/failure、累计源失败并暂停，JFA已发生。普通新闻与完整政策证据应区别处理，不能照搬原版摘要降级到法律义务断言，也不应把单篇坏附件长期扩大成全源停采。 |
| 相关性与双评分 | 只有BLOCK停止；UNKNOWN继续。两次独立评分决定精选，低分仍写短摘要进/all。[runAnalysis:476–513](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/editorial/analyze.ts#L476) | 复用评分函数、数字门槛；却要求prefilter必须PASS，UNKNOWN也停，低于精选线直接终止。[runFisherySelection:44–49](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/selection.ts#L44)。为完整证据/成本控制增加硬门，实质上改变召回与全部动态产品行为；行业门槛仍calibrated=false。 |
| 事实与人工审核 | 结构抽取、写作、命名等保护及归组判断，没有逐篇强制素材审核/人工终审；管理员可更正。[processRevision:144–153](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/content.ts#L144) | 增加原文锚点、数值/日期/机构规则、第二遍逐claim核查，并在前后各设人工门。第二遍不是原版双评分的重复：它核真假，评分核价值；素材审批与终审也不同，但所有普通新闻必须两次人工介入造成实际堆积。v5.5→v5.6还让已成功待审稿失效。 |
| 谁真正发布 | processRevision调用publishArticle；[publishArticleTx](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/publication/publish.ts#L235)写统一投影。先/all，够分且归组/信息增量确认后才selected；groupArticle成功后再publishArticle。 | decideFlow(qualified)排fishery.publication→syncFisheryPublications→publishArticleTx；真新闻投影analyses，再排fishery.news。[decideFlow:580–583](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/flow.ts#L580)、[bridge:165–171](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/publication-bridge.ts#L165)。读时继续核当前证据和审批，撤审即不可读；这是应保留的安全绑定。 |
| 归组/热点/日报 | 原groupArticle归组与增量去重，jobs/events随后排模型综述；48h独立参与方热度、24h半衰期。日报规则编排；周/月模型仅写总述。 | **归组核心文件与上游完全相同**，续处理已接；同一预算授权下调用。热点也复用原算法。暂不排模型事件综述，周/月writeOverview=false，避免新的未审文案。当前生产0 analyses/stories/reports证明没有真实近期正例，不证明代码缺消费者。[news-editorial:21–77,108–150](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-editorial.ts#L21) |

原版也不是可以不加判断地照搬：它的BLOCK结果不进列表，但默认public投影与hasItemPage仍可能保留原文标题/链接详情；文档所称“不出现在任何公开页面”比实际条件更强。它也没有全面事实核查。应恢复清楚的分层与自动主线，不能顺带取消本站未审素材隔离。详见审核附录的原版反例。

入口、游标、附件及失败传播的完整函数/行号见 [intake-review.md](intake-review.md)；审核与发布逐门对照见 [review-publish.md](review-publish.md)。

## 两个必须单独指出的问题

**1. “内部合格不会公开”与实际行为冲突。** [flow.tsx:97,103–106](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/web/flow.tsx#L97)按钮、说明和确认框都称只供内部；后端却保存internalOnly:true后立即排发布，响应仍给published:false。消费者真实存在，条件满足后会进入共享publication/读者投影和后续归组。素材approved、当前快照仍是硬门，全文也保持summary-only；但这些不抵消按钮的误导。当前站另有私有预览鉴权，本轮没有证明匿名公网泄露。**不能用这个按钮完成“仅审核、不发布”的专项任务。**

来源profile内的allowedSummary/allowedPublication也不能作为额外保险来推断：目前它们硬控手动素材导出，文章reader/publication链主要验证快照和qualified，没有直接检查这两个值。未知权利是管理/用途待办，不是MPA本次0 flow的直接代码原因。

**2. 日报空输入语义被外层短路。** 原[composeDaily:89–116](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/reports/compose.ts#L89)明确区分：

- 已有内容经过判断，但没有新要闻：出“平静日”空日报；
- 没有任何判断输入：报错、留下补刊/运行异常；
- 周/月只有应有日报齐全且原条目全空才跳过；缺期仍是失败。

本站 [composeApprovedReports:108–132](https://github.com/Maidamai/AIHOT/blob/a5a0f8c064d5c82a707af2f170582338bb8ff10e/modules/fishery/backend/news-editorial.ts#L108)先要求存在selected、非backfill行，没有便返回空；刊期也只从精选推导。这样原版的缺输入异常、仅有未精选补充事实、部分缺期区别不会触发。它没有制造假日报，但也弱化了诊断。详见 [downstream-review.md](downstream-review.md)。

## 精简优先方案

以下是审查建议，本轮没有实施或改变授权。

1. **先统一“审核决定”和“发布”的真实含义。** 普通发布操作用一个明确的“批准并发布”含义；专项仅审核保留到审查完成，不暗中排发布。删除误导的internalOnly/published:false承诺，或者让其真正不触发发布。同步清楚素材导出权与摘要读层的实际边界，避免靠字段名假定被保护。
2. **恢复原版的内容分层，减少普通新闻必经人工步骤。** BLOCK、真假不明、完整证据缺失应停；UNKNOWN应继续判断，低精选分与不可发布不是一件事。经可靠证据核查的普通资讯可走原/all→归组→精选主线，法规适用性、异常及用户特指任务才保留必要人工决定。行业定义及发布政策仍由用户决定；不为凑稿降低60/65/76，也不把旧政策当近期。
3. **把一次失败的影响留在对应文档，保留行业证据能力。** 必需PDF、通知号、脚注和版本撤审应保留；错误附件先隔离该条。来源级退避/暂停用于实际来源不可用或系统性故障，避免同两条附件让整个JFA长期无输入。新源必须明确交付采集范围、处理范围、审批责任和一条真实闭环，不能以首轮归档成功宣称资讯功能完成。
4. **收敛重复状态与无效重审。** 核心article/revision/analysis/publication作为主状态，文书/观察保留证据职责；避免维护“内部合格”第二套发布语义。规则升级先对已收回执做离线影响核查，受影响部分才重审，不让无关配置变化一律使待审成果失效。行业源启用与模型授权可以分离，但同一状态页要说清实际卡点。
5. **恢复原版刊期诊断并补回上游已有修复。** 保留当前审批过滤与无新增模型总述，恢复按刊期检查、平静日/缺输入/缺刊区分和逐期失败隔离。另有上游10月20日登录页过滤修复尚未同步，属于分叉落后，不是本站主动删掉；应补回，不能让登录/注册页充当正文。

此外，已付费结构化category/tags又被摘要关键词分类覆盖、每次公开读取遍历全站qualified材料并重建flowDetail，属于可删减复杂度；它们不是本轮“0稿”的已证直接原因，见审核附录。完整框架回滚也不合适：应保留原件/PDF证据、法规时效区别、当前版本撤审、统一公开读取、回执与金额预算；普通新闻不必承受整套政策文书流程。

**下一阶段最小验收不是再加几个源，而是一条用户认可且在窗口内的真实业务资讯：发现→完整材料→必要审核→原预筛/评分→事实核查→明确发布决定→/all→真实归组/精选→应到刊期。** 每个“未启动、待审、低分、失败、历史、未授权发布”都应有单独计数。MPA与政策这两条当前不能被当作这个近期成功正例。

## 交付与剩余不确定性

- 主报告：本文件；四份可选证据附录：[入口](intake-review.md)、[审核与发布](review-publish.md)、[实际运行与两条材料](production-trace.md)、[事件与成刊](downstream-review.md)。
- 版本与静态核对：[version-evidence.json (local original; provenance)](../../provenance/source-manifest.json)、[read-only-verification.json (local original; provenance)](../../provenance/source-manifest.json)。静态核对确认核心 materials.ts 和 group.ts 与上游相同，工作区未改变；MPA时间差由保存数据复算。
- 未查询23:38之后的生产状态，未重抓MPA后续21条，未重跑旧政策或福建失败任务，未测试新近合格新闻的实际端到端发布；这些仍是运行验收缺口。
- 审查本身没有剩余自动审批拒绝或结果不明操作；所有业务停点均保持原状态。
