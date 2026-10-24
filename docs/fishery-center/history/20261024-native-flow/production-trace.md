# “发布 0”生产证据与流程停点审查

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


审查日期：2026-10-24 UTC。仅阅读本地代码快照、已有审查产物；未连接生产、未运行生产命令、未访问数据库、未调用模型、未修改仓库。本文唯一新增文件为本报告。

**结论：保存证据证明的是“本轮归档新增 1 条、模型请求新增 0、发布新增 0；当前读取有 13 条历史内容、近期时间线 0”。没有证据支持“所有素材均被模型拒绝”或“整套自动生产者未启动”。** 实际同时存在待素材批准、历史候选范围、筛选未过、旧失败待处理、终审未授权等不同停点。MPA 与指定政策文档分别停在付费审核之前和人工终审之前。

## 证据边界与时间

代码快照根目录：

- `C = [private-local-path]`：父任务已核定部署版本 `a5a0f8c064d5c82a707af2f170582338bb8ff10e`。
- `U = [private-local-path]`：父任务已核定上游 `b3998dc6fc138eb9659f33f55eb38c1c716f0d57`。
- `E = [private-local-path]`：历史生产证据目录。

已读两份 `AGENTS.md`、`README.md` 及相关模块代码。下文 `C/…:行号`、`U/…:行号` 为上述快照的精确文件位置。

| 产物 | 证据实际时间（UTC） | 作用 |
| --- | --- | --- |
| `E/production-snapshot-resumed.safe.json` | 2026-10-23 23:29:50.950 | 部署前 `605ac218` 基线 |
| `E/business-integration-evidence/production-first-cycle.safe.json` | 23:34:42.984 | 三个新源首个真实定时周期 |
| `E/rollout/containers-final.safe.json` | 23:36:11.836 | 实际容器命令、安全阀及 release |
| `E/rollout/state-final.json` | 23:37:02.727 | 最终只读业务状态快照 |
| `E/rollout/projection-final.json` | 23:37:07.229 | 最终实际读层计数、来源运行投影 |
| `E/rollout/closeout.safe.json` | 23:38:30.961 | 收尾确认；不是新的完整业务快照 |
| `E/review-fix-evidence/after/policy-current-readonly.json` | 16:20:27.337 | 政策文档旧规则审核/绑定证据 |
| `E/review-fix-evidence/after/policy-formal-review.json` | 15:35:45.043 | 正式审核结果、阶段回执与队列任务 |

`E/rollout/final-read.safe.json` 汇总上述部署后读取。父任务提到“截至 23:46”的口径，本次未独立获得该时刻的新查询，**本文不把 23:46 标成验证时间**。未来 `nextAt` 也不等于已经执行。

## 1. “0”的分母必须拆开

| 指标 | 保存证据中的值 | 正确解释 |
| --- | --- | --- |
| 新三源第一轮列表 | ITF 4；FAO 3；MPA 50 | 发现条目数，尚非完整正文、已审核稿或可发布稿 |
| MPA 50 条中的通知范围 | 排除 23，保留 27；检查窗口 22、历史待补采 5 | 其中本轮只获取 1 篇，另 21 篇窗口候选待后续轮次 |
| 新三源首轮完整入库 | ITF 0、FAO 0、MPA 1 | ITF 4 与 FAO 3 全入历史待补采；不能当审核拒绝 |
| 本轮模型/发布增量 | 0 / 0 | 是这一轮的增量，不是全站累计为零 |
| 全库文档/观察/素材审核记录 | 102 / 111 / 33 | 不同表和粒度；33 是审核记录数，不是 33 篇已审核稿 |
| 安全文档明细投影 | 98 行 | 查询排除 attribution/issuer 以 `ISOLATED TEST` 开头的行；仍包含历史、pilot 和隔离来源，不是 98 条近期新闻 |
| 98 行的最新素材决定 | 75 无决定、22 当前版本 approved、1 rejected | 75 未审不能改称拒绝 |
| 98 行的最新流程 | 60 无流程、29 queued、5 qualified、2 needs_human_review、1 rejected、1 failed | 所有 29 条 queued 的最新素材决定均为空；任务表占位不等于已派发付费队列 |
| 全流程任务表 | 43 次任务 | 含旧尝试：queued 29、qualified 5、needs_human_review 2、failed 3、needs_evidence 1、rejected 3；不能拿 43 当独立候选数 |
| 98 行中关联到核心 article | 44；其中 backfill=true 41、false 3 | 另 54 行未通过该查询关联到 article；不是所有文档都走新闻路径 |
| 物理 publications 表 | 16 行；其中 `NOT backfill` 0 | 不等于当前读层可见数量；过期/隔离/绑定门控会再过滤 |
| 当前读层 | 全部 13；timeline 0 | 交付说明为 4 篇参考文章＋9 份指南；不是 16 条可见内容 |
| 核心 analyses/facts/stories/reports | 全部 0 | 当前没有完成“已批准结构化新闻 → 核心分析投影 → 事件 → 成刊”的材料 |
| 当前 pg-boss 待运行/重试/执行任务 | `currentJobs=[]` | 指该查询时点的 created/retry/active 状态；不否定已有 cron 或进程内定时器 |

依据：`E/rollout/state-final.json:5`、`:817`、`:2898` 起的文档数组；`E/rollout/projection-final.json:2–24`；`E/DELIVERY.md:17–45`。文档筛选及各计数 SQL 见 **仅作为源码阅读**的 `E/production-snapshot.mjs:13–25,45–48,64–81`。上述 98 行分布是本次对已保存 JSON 的离线统计，没有新查库。

三个 `backfill=false` 材料直接解释了近期新闻路径的不同停点（这也不是“最近 24 小时全部应发布稿”的分母）：

| 文档 / 核心文章 / 最新任务 | 源与原日期 | 最新停点 |
| --- | --- | --- |
| 文档 `aa4e2e7a-67f0-4244-8552-c90f19854928`；文章 `jxr71d4jo1wbyzpbkrob4rwe6`；任务 `c3b0c9c6-ff9e-4ca4-a72c-f7ad79d8b79d` | JFA「11月3日から7日は『いいさかなの日』」；10-23 | 素材未批准，流程 queued/prefilter；不是预筛已拒绝。入库 10-23 14:51:32.146Z |
| 文档 `5c4a718f-bb43-475a-b765-246725c0607f`；文章 `z3ij8hfnfm4o0da8r99uug83u`；任务 `7151c72d-ea97-4369-9b22-0235697108ae` | MARA「1—9月水产品产量5389.68万吨」；10-22 | 素材 approved；流程 rejected/score-2，`SCORED`、`attentionCandidate=false`。可确认这是筛选未过；该快照未给出具体双分数，不编造分值。入库 10-23 07:09:04.755Z |
| 文档 `23c399e6-1535-4b52-9c00-6c7e6ab238f0`；文章 `f1k6qnhetnoku3zr5rb9w1f13`；任务 `0872b248-d87f-4b0c-9b91-9ab31342ab5b` | 福建省局动态「国际友城与海洋经济合作研讨会在福州举办」；10-19 | 素材 approved；旧流程 failed/generation。历史错误为发生状态证据校验误拒，receipt 9；本轮修了“举办”识别，但未重跑/终审旧任务，不能说已恢复发布。入库 10-20 23:15:40.575Z |

证据定位：`E/rollout/state-final.json:2988,4038,5538`；旧失败细节为 `E/review-fix-evidence/after/historical-error-evidence.json`（其自身时间 **13:33:03Z**）；离线修复回放为 `after/offline-replay-result.json`（**16:54:04Z**）。

## 2. MPA：完整入库，但尚未进入模型审核

| 字段 | 核对结果 |
| --- | --- |
| 来源 | `fishery-column-mpa-port`，MPA 港口作业通知；来源 revision 1 |
| 标题 | PORT MARINE NOTICE NO. 142 OF 2026 — POWER SHUTDOWN AT ICA CREW OFFICE – PSA PASIR PANJANG TERMINAL(PPT) 4 CREW OFFICE |
| 原文 | `https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no-142-of-2026-power-shutdown-at-ica-crew-office-psa-pasir-panjang-terminalppt-4-crew-office` |
| 文档 / 核心文章 | `292f8e02-dcde-4bb6-9839-df372a1e142a` / `ak06yv2n1fkqsi2hka1r5q9iv` |
| 原日期 | `2026-10-22`，精度 **day**；不是已核验的具体发布时刻 |
| 获取 / 入库 | capturedAt `2026-10-23T23:34:14.279Z`；document.created_at/observed_at `23:34:17.904Z` |
| 本轮身份 | round `m-05f6b8b1-3e2f-4bb9-b0ed-4198031443c3`；batch `m-05f6b8b1-3e2f-4bb9-b0ed-4198031443c3-mpa-port-p0`；archive 尾部 `_fa849fac1d6f452c`；job_runs 103 |
| 实际定时作业 | `fishery.archive.mpa-port`：23:34:01.372Z 创建，23:34:06.362Z 开始，23:34:17.950Z completed，retry_count 0 |
| 原件 | 页面及同源 `…/api/media/5abff951-8e2d-48af-90ef-07e8ec1d24a8/pn142-26.pdf` HTTP 200；附件两页的文本区间均已保存 |
| 哈希 | 正文 `7d93ee455fa1d5ab7ac24a804bc083ff1c9dce2b5d5e2b1cd15bdc91a0b0f2e4`；PDF `050a21ba258ae3a6db97ca1e9b0c96a181903d409f800509734816772ada8cee` |
| 当前审核/付费/发布 | reviews 0、flows 0、publications 0；material decision 与 latest task 均 null；本轮 modelCalls 0；没有该文模型 receipt 的正面证据 |

依据：`E/business-integration-evidence/production-first-cycle.safe.json:197–254,451–470,550–587`；`E/rollout/state-final.json:2898`。

**backfill 的具体原因已经可由代码和时间重建，不是“business 一律历史”或“首次开源固定标记”。**

1. `C/modules/fishery/backend/business-capture.ts:34–41` 保留原日精度日期；没有设置固定 backfill。
2. `C/modules/fishery/backend/import-batch.ts:41–43` 对 ready 的新闻栏目调用 `storeCapturedNews`；`official-columns.ts:37–38` 只排除 NPFC/IOTC，所以 MPA 会走该新闻素材桥接。
3. `C/modules/fishery/backend/store.ts:262–268` 将该日按 `+08:00` 零点换成 `2026-10-21T16:00:00Z`；核心 `discoveredAt` 采用 document.created_at，未传显式 backfill。
4. `C/packages/backend/src/content/materials.ts:72,89–98,237–240` 规定首次发现比归一化原时间晚 **超过 48 小时**便为 `stale-on-discovery`。本条差 **55 小时 34 分 17.904 秒**，与保存的 backfill=true 一致。证据未直接导出该条 backfill_reason，原因系代码＋已保存时间的确定性重建；零点是日精度归一化，不应称原网站真实发布时间。
5. 原网页被列表首次看见的精确时刻未单独出现在这个安全投影中；该批起始为 23:34:06.474Z。上面的“首次发现”指核心实际采用的 document.created_at，不把获取时间和入库时间混写。

**这条至少受三道不同条件约束：**

- 自动范围：实际 `fishery.flow.dispatch.sourceIds` 只有 MARA、福建两栏目、JFA；MPA 不在范围。更进一步，当前 `automatic-flows.ts:13–14` 的允许枚举本身也不含新三源，不能只改一个已存在配置便声称接通。
- 普通新闻/历史范围：普通自动候选要求 `createdAfter` 之后且核心 `NOT backfill`；历史材料须当前有效的有界业务审核提名。MPA 已 backfill，而提名的支持源列表同样未含它（`automatic-flows.ts:67–75,87–100`；`processing-eligibility.ts:10–11,21–29`）。
- 素材批准：即使进入范围，发模型前仍要求当前观察 revision 与来源 revision 的素材 approved。MPA 的素材审核为零。

本轮导入返回 `automatic.enabled=true, rows=[]`，只说明全局派发配置开着、**这批没有进入该范围**；不是“MPA 自动审核已启动且评分失败”。没有素材终审、发布任务或绑定，后续文章/事件/成刊当然没有新输入。

## 3. 指定 9-30 政策：已通过模型链路，停在未授权的人工终审

| 字段 | 核对结果 |
| --- | --- |
| 来源 | `fishery-column-moa`，农业农村部渔业渔政管理局工作动态；来源 revision 1 |
| 文档 | `5f67141e-47ee-4521-bd66-7e842936c02f` |
| 原文 | `https://yyj.moa.gov.cn/gzdt/202609/t20260930_6488348.htm` |
| 标题 | 实施渔业发展支持政策 加快渔业现代化建设——农业农村部渔业渔政管理局负责人就“十五五”渔业发展支持政策答记者问 |
| 原日期/时间 | `2026-09-30`；原时间文字 `2026-09-30 20:36:00`，对应 `2026-09-30T12:36:00Z` |
| 获取 / 初次入库 | `2026-10-20T16:28:08.735Z` / `2026-10-20T18:40:05.025Z` |
| 核心文章 / 时序 | `pepidwdtyqmpvp45xz69wzld6`；body_status=ok、backfill=true；不因 10-23 审核变为近期新闻 |
| 当前证据 | observation revision 1；body SHA-256 `0760eaeba1e9ce6b676ab5365ad7a92a2a04a52aea8d98848c96a6e546c5d15f`；最新素材 approved，审核 observation/source revision 均 1 |
| 正式流程 | `017e75a5-ae30-4036-a12a-6c4fb4758b5a`；identity `auto-e9a11e9c39a35a7d8bd3b9a3bb353fa45497b358f7354f4a`；10-23 15:34:33.139Z 创建 |
| 正式队列任务 | `e6029d1b-addc-42d0-8a5d-2bc6350156cf`，`fishery.flow`，15:34:33.815Z 开始，15:34:47.560Z completed，重试 0 |
| 预筛与评分 | receipt 40：PASS；41/42：72/72，均值 72，对应 T1 门槛 60，attentionCandidate=true；calibrated=false、factApproval=false |
| 生成与结构 | receipt 43：摘要生成；44：结构化事实 |
| 模型核查 | receipt 45：supported、complete_input，12/12 findings supported；15:34:47.535Z 完成；仍 `approved=false,published=false` |
| 最终停点 | status=needs_human_review、stage=human、human_decision=null；bindings 0、restricted publications=[] |

正式六个 receipt **40–45 均 completed**。`policy-formal-review.json` 还包含较早 `gold-…` 的 31–33（received），那是另一组历史预筛/评分收据，不能拿来替换正式任务，也不能仅因 received 就判为费用未决。全局余额状态来自独立累计账本。

依据：`E/review-fix-evidence/after/policy-formal-review.json` 的 rows/receipts/jobs；`after/policy-current-readonly.json`；最终仍停在同任务见 `E/rollout/state-final.json:5688,5838–5865`；最终得分回读见 `E/rollout/projection-final.json:268–284`。

这是**专项授权只审核、不自动发布**所要求的停点（`E/DELIVERY.md:45,74` 与父任务提供的可信范围一致），不是模型误拒或系统丢稿。对应代码：

- `C/modules/fishery/backend/flow.ts:507–512` 将独立核查结果写成 human 阶段；不会自动写 human_decision。
- `flow.ts:557–583` 只有明确 `decideFlow(qualified)` 且当前证据、素材批准、双评分、结构事实与候选绑定均合格，才写人工决定并在同事务排 `fishery.publication`。
- `publication-queue.ts:10–31` 绑定具体决定，消费时重核；`publication-bridge.ts:126–173` 才写 publication binding、核心分析投影并调用核心发布。
- `reader.ts:20–31` 只纳入当前 qualified、素材 approved、候选及人工决定绑定有效的条目；此文目前不满足。

**版本边界：** 15:35/16:20 产物中的 `stale=false` 是 v5.5 时代读取结果，不应原样宣称 a5a0f8c 下仍可直接批准。现版规则为 v5.6（`ai-draft.ts:11`）；`flow.ts:332–340` 仅为**已经 qualified**的旧 v5.5 文章保留只读兼容，此政策仍 needs_human_review。`decideFlow` 仍重算当前 snapshot（571–578），而 `automatic-flows.ts:108–110` 阻止规则变更后对已尝试/决定任务自动再收费。离线 `after/offline-replay-result.json` 也明确 `requiresCurrentReviewForNewDecision=true`。本审查没有重跑、批准或发布。

## 4. 生产者确实存在，但归档、模型范围、发布分别控制

| 层 | 实际证据与代码 |
| --- | --- |
| 核心 source.enabled | 最终所有核心 source enabled 计数 0。模块注册 external 源主动写 enabled=false（`store.ts:131–149`）；这不表示专用归档关闭 |
| 归档授权 | 八个 `fishery.archive.*` setting 原始 enabled=true；JFA 因 pausedReason 的实际运行投影 enabled=false，其余七个可按各自状态调度。`archive-worker.ts:34–42` 要求核心源 disabled，并计算有效 enabled |
| 实际采集启动 | 容器 `fishery-archive-worker` 执行 `apps/worker/src/main.ts`，`WORKER_PROFILE=fishery-archive`、COLLECT=false、MODEL=false（`E/rollout/containers-final.safe.json:123–149`）。`apps/worker/src/main.ts:18–32` 在 full 核心 worker 注册前分流 |
| 归档 cron | 保存的八个 `*.tick` 均每分钟触发，控制器再按 1 小时/NPFC 6 小时限流，不是每分钟抓正文。代码 `archive-worker.ts:29–34,193–213`；实际 setting/schedule 为 `E/rollout/state-final.json:588–816` |
| 导入后的生产者 | `import-batch.ts:57–58` 在 ready 入库后调用 `dispatchAutomaticDocuments(ids)`；采集自身返回 modelCalls=0，并不代表另一个已授权处理器永远不会接续 |
| 定期补查生产者 | `manual-processing.ts:80–87` 启动立即调用，并默认每 **10 秒**调用派发检查，还维护非付费发布任务、热度和合格刊物。它是进程内定时器，不在 `pgboss.schedule` 中 |
| 实际付费消费者 | `fishery-manual-processor` 执行 `modules/fishery/scripts/consume-flows.ts`，MODEL=true、COLLECT=false；见 `containers-final.safe.json:81–112`。该脚本 `:21–25` 的 `schedules:false` 仅关闭 pg-boss 全局 cron，不取消上面的 10 秒维护 |
| 消费队列 | `manual-processing.ts:48–78` 消费 `fishery.flow`、`fishery.publication`、`fishery.news`、核心 `publication.republish-source`；共享租约串行运行。flow/news 不自动付费重试；publication 为有界非付费重试 |
| 自动范围 | `fishery.flow.dispatch` enabled=true；revision `f19f461f-76f2-4eac-9330-1ffb09aee49c`；createdAfter=`2026-10-21T07:13:00Z`；scope 为 MARA、福建动态、福建公告、JFA；实际无 documentIds 限制。NPFC和新三源不在该 setting |
| 发请求前 | `automatic-flows.ts:58–79` 每次再检查来源范围、非历史或提名、正文哈希、非隔离、当前素材批准及 queued/running；`flow.ts:607–616` 再查模型阀与累计预算授权 |
| 终审与后续 | qualified 才排 publication；非 backfill、当前合格评分/事实及绑定才排 news（`news-editorial.ts:45–77`）；没有当前 selected 非历史条目就不成刊（`:107–128`） |

仓库自带 `C/modules/fishery/deploy/compose.yaml:1–18,38–73` 明确是 **test 隔离试验模板**，不能据它的默认开关推断生产已启用什么。生产实际 compose/override 路径与命令由上述 containers 安全证据确认；本次没有读取服务器私有配置。API 的 MODEL=false 也不能覆盖 manual processor 的 MODEL=true。

### 权限字段究竟在哪一层硬检查

**不能把 `rights=unknown` 笼统解释为这次 MPA 0 flow 或当前摘要读层不显示的直接代码门禁。**

- `source-availability.ts:6–18` 只读取核心 publications.visibility 和 sources.participation_mode，经 hasItemPage 判定关联文章可用；不检查 sources.enabled，也不直接检查 rights 开关。它是内部来源验证，刻意避免递归进入模块当前资格读取。
- `flow.ts:42–54` 将完整 source profile/hash/revision 绑定进审核快照，因此来源权限改动会使旧结果失效，但没有要求 allowedSummary/allowedPublication 必须为 true。
- `processing-eligibility.ts:21–29` 校验来源范围、非隔离、正文、素材批准和版本，不检查这些 rights 布尔字段。
- `reader.ts:20–31` 与 `publication-bridge.ts:24–47,98–118` 依赖 qualified/current binding，也不直接调用 canExportSummary。
- **直接权限硬门**在私有“手动素材导出”路径：`contracts.ts:173–175` 的 canExportSummary 要求 permitted、allowedSummary、allowedPublication 和有效核验期限；`backend/export.ts:22–28,51–68` 使用它阻止导出。

所以新三源 `unknown/summary=false/publication=false/fulltextExport=false` 是尚需确认的使用许可与公开授权待办，且会阻断这条手动导出路径；不能把它替代自动派发/素材批准/终审的实际停点。当前站仍是私有预览；13 条读层可见内容不能据此当作已经获得匿名公开转载授权。

## 5. 来源现状只解释输入覆盖，不替代整条流程审查

| 来源 | 保存状态 | 对链路的具体影响 |
| --- | --- | --- |
| MARA / 福建动态 / 福建公告 | 小时归档，最后成功分别 22:47:47Z / 23:22:42Z / 23:24:44Z；失败 0 | 定时发现与回看正常，不代表发现的所有素材已经批准或值得发布 |
| JFA | 3 次连续失败，有历史 normalCycleVerified=true，但现已自动暂停 | 两个 `…/kenkyu/260928.html`、`260928_1.html` 因 `Unverified JFA attachment origin/path` 失败；不能用旧成功标记覆盖当前停采 |
| NPFC | 6 小时计划仍启用，最后一轮失败 1 次 | CMM 2025-06 的 PDF 脚注不能唯一同页映射：`Raised PDF reference lacks a unique same-page footnote; manual review required`，该条 parse failed、正文 hash=null、未导入；不是 AI 审核拒绝 |
| ITF / FAO / MPA | 已注册，三个首轮真实 pg-boss 周期成功；仅确认各一轮 | ITF/FAO 第一轮均历史待补采；MPA 1 条完整内部待审、21 条窗口候选留后续；三源不在自动付费审核范围 |
| JMA | 代码已合入，但未注册/启用/发布 | 交付记录 391 候选只取 10、缺 381，订正/解除/取消实证不足；不在这次生产 source/schedule 列表，不能称预警已上线 |
| IOTC | sources.participation_mode=isolated | 保持隔离；旧 qualified 任务不等于当前可见或允许继续处理 |

失败证据：`E/rollout/predeploy-inspection.safe.log:14–68`（23:31:04Z 读取前三个失败批次）；`E/rollout/npfc-failure.safe.json:39`（失败轮开始 18:15:32Z，PDF获取 18:16:04Z）；最终运行投影 `E/rollout/projection-final.json`。JMA 的覆盖数来自 `E/DELIVERY.md:69`，不是本次重抓或新查询。

## 6. 与上游的实际区别

上游正常 full worker 一次注册内容、采集、事件、发布及全局 schedule（`U/apps/worker/src/main.ts:20–28`）；正常采集入库后排核心 processing（`U/packages/backend/src/sources/collect.ts`、`U/packages/backend/src/jobs/content.ts:83–89,144–153`）。历史材料仍可低优先级分析，但不进入事件热度（`U/packages/backend/src/content/materials.ts:149–160`）。

当前生产改用两个职责分离的模块进程：归档 worker 完成有界发现/原件/入库；manual processor 在**来源范围＋素材人工批准＋历史提名＋当前证据绑定**条件下继续原预筛、双评分、写作与结构抽取，之后再要求人工终审，才桥接回核心发布/事件/成刊。当前 `MODEL_CALLS_ENABLED=true` 的专用进程及 10 秒生产者已存在，缺口不在“完全没有接续代码”。

48 小时首次发现规则与上游相同（两份 `content/materials.ts:72,89–98`），MPA 的 backfill 本身不能作为分叉引入的新问题。真正影响吞吐的是本地增加的素材审核、历史提名及终审关卡，以及哪些 source 被明确纳入自动范围。这里仅解释已实施的行为与停点，不替用户批准素材、重跑旧付费任务、扩大范围或改规则数字。

## 7. 费用、未知与可交付结论

23:29 部署前与 23:37 部署后账本相同：**53 次、估算 ¥0.699208、未决 ¥0、累计上限 ¥10、调用次数无单独上限**；账本 SHA-256 `441c1764b6ab4d19eb5f611764bd8560391f5e6b3e15504062369acca6733d12`。没有证据表明本轮卡在预算用尽。全库 45 条 receipts（31 completed、2 failed、12 received）与 53 条累计付费账本条目是不同口径，不作一一对应推算。

当前可以据证据给出的停点顺序：**已发现不等于正文已入库；正文入库不等于素材已批准；queued 不等于付费已派发；PASS/72/72/supported 不等于终审；qualified 和物理 publication 记录还须当前绑定读层过滤；历史资料不进入近期新闻/事件成刊。**

尚未独立获得：23:38 之后的生产状态、MPA 后续21条候选是否执行、未知许可的实际授权依据、指定政策当前版本新终审结果。没有任何操作被自动审批拒绝，没有 pending 或 uncertain 的生产写入；本任务从未发起这些动作。此报告是只读链路审查，未运行测试或执行修复。
