# 原生资讯链 v2 实现交付记录

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


**最新状态（2026-10-24 06:17Z）：3a162cb5 已提交、推送并部署四服务；既有 JFA 经单次正式后台重评后自动进入全部，双分 22/22、未入精选，可读总数 13→14。原有自然调度随后已生成 Oct24 平静日报，标题“本期暂无入选资讯”，已判读 1、精选 0、条目 0，未新增模型调用。** 已证明真实重评到发布及无精选的自然平静日报；自然新到采集发布、有精选内容的日报、事件综述、周月报和 48 小时仍未验收。

实现位于 [implementation (local original; provenance)](../../provenance/source-manifest.json)，当前分支 `feat/fishery-native-flow-v2-20261024`，基线为 `a5a0f8c064d5c82a707af2f170582338bb8ff10e`，当前 HEAD 为 `3a162cb5f30e27a6385d0fb0c1b7227f059028a3`。初版 69 个文件已提交推送为 fa8；生产观测后追加仅三文件的显式 handover 修复 d92（parent=fa8），均正常推送至上述分支并经远端读取确认，工作树干净；未强推。随后由唯一部署执行者 native_ui_ops 完成 fa8 生产切换及 d92 单 JFA 增量迁移；2026-10-24 05:09:41Z 的安全汇总确认 API/web/native/archive 四服务已运行于 d92、旧 manual 保持停止。本 agent 本阶段仅维护文档；共享主目录和 task-4 集成目录未被用作写入目标。根 agent 只统筹和只读审核；代码实施、验证与审查由六位 `GPT-6.1-sol / high` subagent 完成。

**当前结论：已证明相关低分稿经原生分析自动进入全部，且原自然调度可生成有判读、无精选条目的平静日报；高分精选、事件热点、有精选内容的日报、周月报、自然新稿闭环和持续运行仍需正例。** 原 analysis 1 / receipt 46、历史 13 条、MARA 明确拒发、政策仅审、原 scope 和累计 ¥10 保持。累计仍 59 received、估算 ¥0.897700，pending/unknown=0。

## 本轮状态口径

| 项目 | 本轮准确状态 |
| --- | --- |
| 本地实现 | 初版 fa8 的 69 文件匹配原验证清单；d92 只改 native-permit、既有材料测试和部署说明三文件，21 项定向验证及独立审查通过；3a162cb5 仅追加行业预筛文件，相对 a5 累计 70 路径；新定向 2/2 通过，专项指纹不变，当前工作树干净。 |
| 已提交 commit SHA | 最新 [`3a162cb5f30e27a6385d0fb0c1b7227f059028a3`](https://github.com/Maidamai/AIHOT/commit/3a162cb5f30e27a6385d0fb0c1b7227f059028a3)，parent=d92；此前 d92→fa8→精确 a5。 |
| 已推送 commit SHA | `3a162cb5f30e27a6385d0fb0c1b7227f059028a3`，分支 [`feat/fishery-native-flow-v2-20261024`](https://github.com/Maidamai/AIHOT/tree/feat/fishery-native-flow-v2-20261024)；正常推送后经 `git ls-remote` 独立确认。 |
| 生产部署 SHA | `3a162cb5f30e27a6385d0fb0c1b7227f059028a3`；05:44:24Z 确认四服务运行、旧 manual 停止，原保护检查通过。唯一执行者 native_ui_ops；见[最新升级汇总 (local original; provenance)](../../provenance/source-manifest.json)。 |
| 真实采集 | 最新 MPA 05:32 / JFA 05:33 轮列表均成功，正文分别 1 / 2 项失败，整轮 partial；fetch_runs ok/partial，job_runs 显示 failed。两源 failCount=0、未暂停且进度/下轮保留；04:31 福建两栏和 MPA success 仅为此前历史轮次，不能用它替代最新状态。 |
| 真实业务模型调用 | 本次显式重评新增 5 次，receipt 47–51 全 completed；新账本 entries 55–59。累计 59 received、估算 ¥0.897700，新增 ¥0.162376，pending/unknown=0，原 54 条前缀保留。旧 d92 的一次 BLOCK 与此次新 PASS 分开记录。 |
| 生产发布与刊期 | 全部 13→14，仅新增 JFA，score 22、未精选，详情可读。自然 compose 207 于 06:14 成功生成 daily:2026-10-24：judged=1、selected=0、entries=0、model=null；这是平静日报，不是含稿日刊。日报 API/网页/RSS 均 200 同日期标题；周月报和有精选内容日报尚未验收。 |

初版提交与远端确认记录见 [git-push.json (local original; provenance)](../../provenance/source-manifest.json)；d92 增量记录见 [supersede-fix-push.json (local original; provenance)](../../provenance/source-manifest.json)。既有 `integration/fishery-20261024`、`feat/fishery-materials-mvp` 和 `main` 分支均未移动。

指定政策仅审核、原累计 ¥10 预算、真实日期及既有鉴权边界均不变。本地/离线验证与生产证据分开列示；已部署并开始自然采集，不等同于已经证明真实候选经模型发布、成刊和持续运行的全部效果。

## 是否照原引擎效果恢复

**已有一条真实重评证明：低分相关稿自动进入全部，且未混作精选；高分精选正例尚无。** 3a162cb5 通过正常后台仅提交一次 JFA 重评，新预筛 PASS、双分 22/22，随后自动生成摘要并发布至全部，未进入精选或建立事件。此前 d92 的过度排除疑点已由新结果纠正，旧证据完整保留。该样本是既有文章显式重评，不代表自然新稿采集链、热点或 48 小时效果全部验收；随后自然调度已另行验证平静日报，有精选内容的日报仍未验收。

| 用户可见目标 | 已恢复/部署的机制 | 当前实际效果边界 |
| --- | --- | --- |
| 自动分析到发布 | 原 queueProcessing → runAnalysis → publishArticle → group/digest/hot/reports | 既有真实 JFA 经一次显式重评，随后自动预筛 PASS、双评分、结构、短摘要和发布，无新增普通审批关卡；尚非自然新采集闭环。 |
| 普通新闻去审批 | 普通新闻不再等待素材 approved 或逐篇 qualified；专项仍独立 | 指定政策已持久化 review_only 且不可读，旧决定和回执未改。 |
| 全部动态与精选分层 | 相关低分进全部，高分与归组/增量条件满足才进精选 | 新 JFA 双分 22/22，已进入全部且未入精选；原 13 条保留。尚无高分精选新正例。 |
| 单篇失败不冻结全源 | 列表成功与正文失败分记，partial 保留进度及 firstSeen | 最新 05:32 MPA / 05:33 JFA 列表成功，分别 1 / 2 项正文失败；fetch_runs ok/partial、job_runs failed，两源 failCount=0、未暂停并保留下一轮。此前 04:32 JFA partial 为历史证据；这些轮次仍不能替代 48 小时观察。 |
| 事件、热点与日报/周月报 | 使用原归组、独立来源热度、综述及按日历补刊函数 | hot.rank/snapshot 已运行；自然 compose 207 已生成零精选/零条目的平静日报，无新增模型。未取得事件热点/综述、有精选内容的日报或周月报正例；此前 compose 失败保留为历史。 |

## 当前生产证据

- [发布包 (local original; provenance)](../../provenance/source-manifest.json)、[实际迁移日志 (local original; provenance)](../../provenance/source-manifest.json)及[完成汇总 (local original; provenance)](../../provenance/source-manifest.json)确认 fa8 切换完成，原 13 条逐 ID/日期/binding 保持，权利字段与来源调度保留。
- [04:36:37Z 生产安全快照 (local original; provenance)](../../provenance/source-manifest.json)记录：全部可读 13、近期 timeline 0；指定政策 `review_only` 且不可读；原 ledger 53 条全 received，hash `441c1764b6ab4d19eb5f611764bd8560391f5e6b3e15504062369acca6733d12` 保持。沿用切换前估算 ¥0.699208、未决 0、累计上限 ¥10，没有重建额度。
- 同一快照中的新自然轮：福建动态 04:31:37Z、福建公告 04:31:39Z、MPA 04:31:39Z 为 success；JFA 04:32:25Z 为 partial，bodyFailures=2、fail_count=0、last_error=null，游标 revision=3、firstSeen=161；archive 未暂停，下一轮 05:32:28Z。MPA revision=3、firstSeen=27。没有为了展示新稿改写真实日期。
- [HTTP 脱敏诊断 (local original; provenance)](../../provenance/source-manifest.json)与完成汇总确认鉴权边界保留：实际域名页面/feed 跳登录、API 返回 401；源站回环首页 200 仍为 private/no-store，端口仅绑定 127.0.0.1。恢复读者结构不等于取消私有预览或匿名公开上线。
- 模型范围仍为原四源、原 `createdAfter=2026-10-21T07:13:00Z`；fa8 初次切换 handover execute=0。随后 d92 仅执行下节已核准的 JFA 单目标迁移，没有将 ITF/FAO/MPA 的归档权限扩为模型授权。以上初次快照保留其明确时间，不代表 d92 自然调用后的累计数。

### 首轮自然运行观察（04:38:13Z）

[只读自然观察快照 (local original; provenance)](../../provenance/source-manifest.json)记录：原四源且在配置起点之后的 38 个 core 记录中，36 个为 backfill，另有 JFA、MARA 各 1 个非 backfill；这不是新发现了 38 篇稿。部署后新发现文章数为 0，native 用途记录 0、当前 eligible 0；两次 content.sweep 都把两条非历史记录标为 restricted。两者虽都有 `human_decision.decision=rejected` 字段，[04:43:52Z 来源审计 (local original; provenance)](../../provenance/source-manifest.json)已区分：JFA 旧 task `14eceb9c-e041-4448-aa55-2694c6178d6f` 是 automatic-dispatch 的系统 supersede，audit 995、固定 note、空 draft/请求/评分结果；不是人工拒绝。MARA 文档 `5c4a718f-bb43-475a-b765-246725c0607f` / article `z3ij8hfnfm4o0da8r99uug83u` 的 task `7151c72d-ea97-4369-9b22-0235697108ae` 则由 `authorized-agent:news-flow-correction-20261023` 在 audit 512 明确拒绝发布，有 42/38 评分及已付费结果，继续保留。不能将两者统称“真人拒绝”或一起放行。

04:31:18Z 的 `reports.compose` 为 failed，错误为 `Error: reports: daily:2026-10-24 failed`；daily/weekly/monthly 均 0。[04:41:51Z 底层统计与字段快照 (local original; provenance)](../../provenance/source-manifest.json)及真实日志确认 `daily 2026-10-24: nothing judged in its window`；窗口为 2026-10-23T00:00Z 至 2026-10-24T00:00Z，scored 非 backfill 输入=0。未为验收重试 compose，不把失败概括成“只是尚未到期”。快照 nativeQueueRuns 为空、activeJobs=0，native/archive 心跳均为 fa8。账本仍为 53 received、估算 ¥0.699208、未决 0，原累计 ¥10 边界不变。日报底层原因与两条 rejected 的 actor/audit 归因均已核清。原 fa8 部署独立汇总见[生产部署报告](production-deployment-3a162-final-report.md)；d92 增量迁移与随后自然预筛已执行，最新结果见下节；此处 53 条及 eligible=0 仅为 fa8 的历史快照。

## JFA 迁移缺口的最小修复（d92）

fa8 把任何 rejected 字段都视为阻断，且显式 handover 原来只允许所有任务均 queued，因此历史未开始占位的系统 supersede 也无法迁移。这个缺口由实际生产证据暴露，不能仅归为没有候选。d92 **只扩展显式、有界 handover**：要求至少一个当前来源/观察 snapshot 绑定的 pristine queued；旧系统占位必须有精确 actor/internalOnly/固定 note/snapshotHash、同 task 的完整 auto_superseded 审计及原来源/观察证据，且没有任何请求、评分、结构结果、费用或 flow.decision 审计。dry-run 列两类任务和证明审计 ID；execute 保存原状态、决定与分类审计，不写 approved，不删审计。

日常 publication/processing 的 any-rejected 门没有放宽。MARA 的 authorized-agent 明确拒发、所有已付费结果、撤回、专项提名、既有绑定、在途工作、指定政策仅审和原累计 ¥10 授权继续阻断。该修复已由 native_ui_ops 完成副本预演和单目标生产迁移；迁移本身没有调用模型或增加费用，后续自然预筛另记。迁移成功不等于已出稿。

[增量验证记录 (local original; provenance)](../../provenance/source-manifest.json)、[独立 commit/source manifest (local original; provenance)](../../provenance/source-manifest.json)与[Node 24 定向日志 (local original; provenance)](../../provenance/source-manifest.json)：**21/21 通过**，模块类型及 diff 检查通过，独立审查通过并只读核对真实 JFA 所有 guard 匹配。覆盖精确系统形态可迁移、actor-only/internalOnly-only、缺/错审计、完整重算 hash 但来源证据不符、陈旧 queued、阶段请求/结构/付费、明确决定和仅审限制。用 53 条合成历史 ledger 验证接管零模型、费用与原日期不变；未重跑全量。此前 1255 全量及末次队列定向属于 fa8，不能算成 d92 的全量测试。 d92 阶段的 69 文件 source manifest SHA256 为 `a06d4d74e8e91d02aea9b0249b806ce435462f202c94e8f02fac757cefc7954a`，原 fa8 的 d872 清单保留作历史验证证据。

## d92 单目标迁移与真实预筛（05:09—05:13Z）

[生产 handover 汇总 (local original; provenance)](../../provenance/source-manifest.json)确认：只移除 JFA 两个经严格证明的零付费占位，flows 从 43 到 41；旧 audit 995 保留，新 handover audit 1155 保存两项原决定及 snapshotHash。当前采集身份、真实日期、原 13 条可读 ID/日期/binding、MARA 明确拒发及已付费状态、policy review_only、schema、原 scope 与八源进度均保持。副本和生产动作由唯一 owner 执行，无批量放行。

[d92 部署汇总 (local original; provenance)](../../provenance/source-manifest.json)及[真实业务结果 (local original; provenance)](../../provenance/source-manifest.json)确认四服务运行，native/archive 在 05:12 有新心跳，旧 manual 停止。JFA `aa4e2e7a-67f0-4244-8552-c90f19854928` 的自然 tick 于 05:07:58Z 完成 `prefilter_article`：标题为“11月3日から7日は「いいさかなの日」”，模型理由为“仅鱼食推广活动，未涉远洋渔业”，实际标签 BLOCK。receipt 46 completed，鱼业提示词 systemHash/promptVersion 均匹配；这里只报告真实结果，宽召回是否合适仍须单独评估，不能用一次 BLOCK 宣称筛选正确。

该条 processing_state=blocked、selected=false，score/scores/writer 均为空，未进入双评分、写作、发布或归组；详情不可读，无 publication/story。读取仍为 13、timeline=0，policy 不可读，日/周/月报仍无正例；`reports.compose` 的真实 no-judged-window 失败保留，不改写为空刊成功。原账本只新增这一次 received：54 条全 received、735324 micro CNY（估算 ¥0.735324），较此前增加 36116 micro CNY（¥0.036116），未决及 unknown=0，原 53 条 entry 前缀不变，累计 ¥10 上限和原 key 不变。

[archive 阀值比对 (local original; provenance)](../../provenance/source-manifest.json)另记录一次运维诊断断言修正：既有 `FEISHU_CONTENT_PUSH_ENABLED` 缺省按 `config.bool` 仍为 false，仅明确 true 才开启。严格要求字符串 false 的检查被纠正；未改环境、安全设置或产品代码，也没有因此另行重启。实际部署与观察详见[生产部署报告](production-deployment-3a162-final-report.md)。

## 宽召回澄清与部署（重评前阶段留档）

[正文事实核查 (local original; provenance)](../../provenance/source-manifest.json)确认旧 JFA 正文包含鱼种/捕捞时节变化、水产品采购和低利用鱼合作事实；独立审查认为旧 BLOCK 理由不足，存在过度排除疑点，不能称正确过滤。3a162cb5 仅修改 `industry/prompts/prefilter.md`：按既有范围内的具体产业事实判断，活动外壳不能代替全文判断，价值留给双评分，保留空泛广告 BLOCK、证据不足 UNKNOWN 和反注入/JSON 边界。没有新增题材、来源、数值门槛、白名单或第二模型关卡。

[离线版本证明 (local original; provenance)](../../provenance/source-manifest.json)确认新 `prefilter@f1dd56b576` / system `2d3353d0dd0c0670de5f851d0fd31301e52f34ce2c7a1cab70bb96993c785576`，专项 `fisheryConfigurationVersion=868fbe5dd400e28b8978065bc48bbff465241b6071a79c51f4ede3f488192c7c` 前后不变。既有重评恢复与重复命令幂等的本地假模型定向 **2/2 通过**，独立审查 PASS；没有重跑全量，也未用假模型证明真实选材改善。[新 commit/source 清单 (local original; provenance)](../../provenance/source-manifest.json)相对 a5 为 **70 路径**（原 d92 的 69 路径加预筛文件），tree manifest SHA256 `4f5ebd7187aac653552926d315fe3436be17f628f08507025815d9e141201761`；此前 69 文件档案保留，不混称同一树。提交推送记录见[prefilter-fix-push.safe.json (local original; provenance)](../../provenance/source-manifest.json)。

[05:44:24Z 生产升级汇总 (local original; provenance)](../../provenance/source-manifest.json)确认四服务运行于 3a162cb5，新提示词与专项指纹符合上述值；旧 54 条 received、估算 ¥0.735324、未决/unknown=0，原 13 条、旧 analysis 1 / receipt 46、MARA 决定、policy 不可读、scope/预算/鉴权保持。目标仍 blocked、无 rerun 审计，部署后新增真实模型调用为 0。d92 的旧 BLOCK 不能归为新提示词结果。

重评前曾在 Mac locked / automatic unlock failed 时停在刷新阶段，未点击任何提交；该次确定未执行。随后用户手动解锁，唯一 owner 继续原授权并只提交一次，实际完成见下节。此项锁屏已解除，不是当前阻塞；没有绕过凭据或鉴权。重评前独立报告保留其时态：[before-rerun 报告](production-deployment-3a162-before-rerun-report.md)。

## 正式后台单次重评与自动发布（当前结果）

用户解锁后，唯一 UI owner 在已有正式后台提交一次 analyze；[提交后安全快照 (local original; provenance)](../../provenance/source-manifest.json)记录 audit 1184、actor `admin:1`、requestId `mvlzl1zy-a5kp30xg`、job `5ebce0f6-66ad-4ed1-bef2-bc47db14b328`。源码、推送与四服务仍为 3a162cb5，没有为此次结果再改代码或部署。

[真实业务结果 (local original; provenance)](../../provenance/source-manifest.json)记录 analysis 2：新 `prefilter@f1dd56b576` 为 PASS，receipt 47 的 systemHash 精确匹配新提示词；独立双分 22/22，structure receipt 49，summarize receipt 51，47–51 全 completed。自动 publication 为 public、eligible=true、selected=false、score=22，detail found；全部可读从 13 到 14，只新增该 JFA。grouping complete，但无 story/fact/digest，不把低分全部稿称为精选或事件热点正例。

旧 analysis 1 / receipt 46 保留旧 BLOCK，新结果另行 INSERT；原 13 条、真实发布日期/发现时间、旧 54 条账本前缀、MARA 明确拒发、政策 review_only、scope 和原累计 ¥10 均经独立审查核对保持。本次增加 entries **55–59** 共 5 次、162376 micro CNY（估算 ¥0.162376），累计 **59 received、897700 micro CNY（估算 ¥0.897700）**，pending/unknown=0。observer 的旧 `promptProof=false` 取的是旧 receipt 46，不代表新版不匹配，应核新 receipt 47；其 `newLedgerEntries` 从旧切片边界带出的 54 也不是本次新增。

这是对真实既有 JFA 的一次显式重新评估，随后自动分析到发布；没有普通新闻逐篇批准，也没有直接写 PASS、改日期或清费用。它仍不是自然新到采集→发布正例。06:03 日/周/月报仍无记录；最新 compose 190 在重评前的 05:44 failed，当时尚未观测重评后的自然成刊；随后 compose 207 已成功生成平静日报，见下节。此前 no-judged 失败留历史时间，不改写旧结果。

[06:01:19Z 运行快照 (local original; provenance)](../../provenance/source-manifest.json)核清：JFA 05:33 轮为 partial、bodyFailures=2，MPA 05:32 轮为 partial、bodyFailures=1，列表均成功；fetch_runs 为 status=ok/outcome=partial，job_runs 将 partial 展示为 failed。不能称整源全失败，也不能称全部正文成功。两源 failCount=0、lastError=null、enabled=true、未暂停，进度及下一轮保留（JFA 06:33:50Z、MPA 06:32:38Z）；此次只读核对没有新抓取或重试。NPFC failCount=2、下轮 06:17 仍在，不能将八源概括为全正常。

[06:03:45Z 出口与刊期证据 (local original; provenance)](../../provenance/source-manifest.json)确认：源站网页详情 200、private/no-store；API all 含目标、selected 不含；RSS all 使用同一 ID 与原发布时间；既有 MCP `myhot_get_latest(all,7d)` 返回 200/SSE、无 error，目标内容与 API 一致。这是回环只读核验，不意味着取消公网私有预览门禁；没有生产文件写入、来源抓取、模型调用、重试或 compose。

同一证据中 raw scored=1 不能直接替代正式输入统计，但源码语义现已核定：[releasedCondition](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/publication/scope.ts#L23)对未精选稿满足 NOT p.selected，不按 updatedAt 排除；[judgedReports](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/reports/edition.ts#L276)核对 listedCondition(end)、score、非 backfill 和 timeline 窗口，不看 analysis 创建时间。因此本 JFA 按当前状态可贡献 2026-10-24 日报的已评分数；periodReports 只取精选，故它不进入精选条目。[composeDaily](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/reports/compose.ts#L96)在 entries=0、judgedReports>0 时允许安静日报，不将它当作没有判读。上述规则随后已由自然 compose 207 的平静日报验证。06:03 的 reports=[] 和 compose 190 失败保留为此前快照；本次等待只观察原自然调度，没有手动触发任务、模型或扩围。

## 原自然调度生成平静日报（06:17Z 最终回读）

[自然成刊最终证据 (local original; provenance)](../../provenance/source-manifest.json)于 06:17:04Z 回读：原有 `reports.compose` run 207 在 06:14:14–15Z 自行运行成功，generated=`daily:2026-10-24`、failed=[]。report id 1 标题为“本期暂无入选资讯”，judgedReports=1、selectedReports=0、entryCount=0、model=null。这是**有判读、无精选条目的平静日报**，不是含稿日刊，也没有把低分 JFA 包装成精选条目。

`/api/v1/dailies/latest`、`/daily/2026-10-24` 和 `/feed/daily.xml` 均返回 200，日期与标题一致。刊期沿用原北京时间 10 月 23 日 08:00 至 10 月 24 日 08:00 窗口；没有手动 compose、改日期、改内容或新模型动作。账本仍为 59 received、估算 ¥0.897700、pending/unknown=0。只读收集曾因结果列表变量遮蔽模块而未输出，修正的只是观察脚本，不是重触发业务任务。

本次证明自然调度、已有判读下的平静日语义和日报三个出口能够落地。仍未验收含精选内容的日报、事件综述、周月报、自然新到采集→发布及 48 小时运行；所有历史失败与原保护记录保留。

## 可直接审查的补丁

[implementation.patch (local original; provenance)](../../provenance/source-manifest.json) 包含 63 个 tracked 文件改动和 6 个新增源码/迁移/脚本，共 69 个文件；不包含依赖、缓存和测试日志。tracked diff 为 1296 行新增、721 行删除，新增文件合计 475 行。完整文件清单与统计见 [implementation-patch-manifest.json (local original; provenance)](../../provenance/source-manifest.json)。

SHA256：`220852dc7fed6b9e9b1bdf1e6321e071fe8ac07d9de36b606ea4eefabf834f06`（另存 [校验文件 (local original; provenance)](../../provenance/source-manifest.json)）。已在独立、干净的精确 a5 副本执行 `git apply --check`，结果 PASS；该补丁在提交前导出并保留原 SHA256；fa8 提交的全部文件内容与原验证 manifest 核对一致，补丁本身未改；后续 d92 三文件修复以其独立增量及新 source manifest 为准。

d92 增量补丁：[jfa-supersede-handover.patch (local original; provenance)](../../provenance/source-manifest.json)，SHA256 `2bd0aad1b7b3f17a85e8a1ab9e5dfecfafefe7712e8d68afd101d03493bffdfc`；在干净 fa8 副本上 `git apply --check` 通过。原初版补丁和原验证清单继续保留，不与此三文件增量混称同一内容树。

## 实现结果

普通捕获新闻进入核心 `queueProcessing → analyzeArticle/runAnalysis → publishArticle → group/digest/hot/reports`。保留原预筛、独立双评分、结构化、详写/短摘要、原归组与成刊函数，普通新闻无需素材 approved 或逐篇 qualified；低分相关稿与精选继续由核心分层决定，不制造人工批准或保证高分。

`fishery.flow` 自动派发仅保留明确提名的专项审核。文档持久用途与当前证据、撤回、真实拒绝和来源限制贯穿处理、实际付费、发布与读取。指定 `5f67141e-47ee-4521-bd66-7e842936c02f` 即使重新采集或重放仍仅审核；初始化用途记录不会改其既有模型结果或决定。历史参考绑定保留原证据，不批量转为新原生稿。

费用沿用 `fishery.trial.deepseek-fishery-20261020` 原 ledger 与累计 ¥10 上限。原分析的评分/结构仍并行求值，实际网络发送串行，逐请求在原 ledger 行锁下预留；历史 pending/unknown/refused 均阻断后续发送。新增原生 receipt 标记原授权身份，通用恢复器不会自动释放该授权的 unknown；未托管原框架来源仍保留原恢复行为。固定模型、端点、96KB 输入请求容量及 2048 输出上限保持；截断响应即使 JSON 完整也留回执并拒绝落成文章。

安装 fishery 模块时，full/native/manual 三种处理执行者共享既有 processing lease。启用原生范围也先取得同租约，避免在途 full 与新范围竞争；native enabled 时 full 在注册消费者前拒绝启动。失租停止领取，正常退出先排空再释放。采集 archive 使用独立来源租约和独立进程。

原生范围由 `COLUMNS` 的新闻能力派生可配置项，再由一份 `fishery.native.processing` setting 显式限制来源和发现起点。默认不启用或扩围。专项队列只归属 dedicated native/manual；默认 full 不再注册或领取它们，生产者直接调用 `enqueueOn` 自行建队。普通来源 unknown 不被额外套用“私有素材导出”的人工版权证明门；unknown 不代表已获转载许可，明确限制仍阻断，全文与全文外发权限保持关闭。

## 主要文件

| 范围 | 文件 |
| --- | --- |
| 原生范围、账本输送、处理租约与受控 worker | [native-processing.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/native-processing.ts)、[authorization.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/authorization.ts)、[main.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/apps/worker/src/main.ts) |
| 核心最小插口与付费边界 | [modules.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/modules.ts)、[llm.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/providers/llm.ts)、[receipts.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/providers/receipts.ts)、[recover.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/operations/recover.ts) |
| 处理/消费许可、归组续处理 | [content.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/jobs/content.ts)、[events.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/jobs/events.ts)、[server.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/server.ts) |
| 用途与统一发布/读取 | [native-permit.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/native-permit.ts)、[publication-bridge.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/publication-bridge.ts)、[publish.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/publication/publish.ts)、[scope.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/packages/backend/src/publication/scope.ts) |
| 单语句 schema 与有界运维 | [0108 migration](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/migrations/0108_fishery_document_purposes.sql)、[fishery-native.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/scripts/fishery-native.ts)、[native-processing.yaml](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/deploy/native-processing.yaml) |
| 采集续行、首次发现、原文与修订 | [column-db-progress.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/column-db-progress.ts)、[column-progress.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/column-progress.ts)、[column-batches.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/column-batches.ts)、[store.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/store.ts)、[import-batch.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/import-batch.ts) |
| 读者页面、材料后台及部署说明 | [home.tsx](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/apps/web/app/routes/home.tsx)、[site.ts](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/site/site.ts)、[collect.tsx](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/web/collect.tsx)、[deploy.md](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/docs/deploy.md) |

退休的普通 fishery.news 生产/消费、复制成刊与热度维护已退出运行。`news-editorial.ts` 只保留已绑定历史结果所需的证据兼容投影。首页不再把全部池作为每日精选兜底；对应无消费者的 `history=exclude` 参数和 includeBackfill 扩展一起清理，原有历史阅读能力保留。

## 必要运行差异

- `fishery-native` 只运行有授权的核心内容、事件、刊物及专项续处理，不启动全 worker 的采集、通知、飞书、IndexNow 或其他外发。
- 为共享租约和 archive 进程分离，受控维护循环按原频率调用原函数，未直接启动整个 `ENGINE_SCHEDULES`；日报/周月报仍由 `composeDueReports` 按原日历和补刊语义决定。
- 当前来源为摘要模式，不注册 `content.translate`。`translate_body` 的模型边界受到同一授权保护，但这不代表定时全文翻译已启用或验收。embedding/Jina 等未受原累计模型授权覆盖的付费服务不随 profile 启用。
- 2048 是沿用的明确站点调用容量，原详写/周月报更大的输出请求被限制在该容量内；不截断输入以伪装可用。输出不足会留下可解释失败，不保证每篇都能生成。
- 原生未知费用不采用通用引擎的“超时后自动释放一次”，需核实原 ledger 与供应商结果再作显式恢复。

## 已有验证证据

最终验证汇总见 [summary.md](verification/summary.md) 与 [summary.json (local original; provenance)](../../provenance/source-manifest.json)，复现命令见 [reproduce.md](verification/reproduce.md)。环境见 [environment.md](verification/environment.md)：独立本地 PostgreSQL 17.6（端口 55445）、仅 `_test` 数据库、无业务库或 .env，模型使用本地假服务，外发关闭。依赖物化于实现副本，依赖与 lock 文件未改。

- 原生预算、处理所有权及真实处理链相关测试已取得 20/20 的阶段结果：[native-processing-tests-2.log (local original; provenance)](../../provenance/source-manifest.json)。包含 full 在途时禁止启用、失租、近额度并发、原 ledger、真实 analysis/group/digest/editions。完整串行全量与最后修复后的定向结果见下方及最终验证汇总。
- 完整原生链及公开出口阶段回放：[native-pipeline-outlets-final.log (local original; provenance)](../../provenance/source-manifest.json)。这是本地合成/假模型验证，不是生产实绩。
- CLI 实际验收在官方 Node 24.14.1 下 PASS：[native-cli-acceptance-node24.log (local original; provenance)](../../provenance/source-manifest.json)，可复核脚本 [native-cli-acceptance.mjs (local original; provenance)](../../provenance/source-manifest.json)。独立 `native_cli_acceptance_test` 中放入 **53 条合成**历史账本；dry-run 零改动；存在 active 专项时拒绝；执行仅取消一条 created 旧 news，保留一条 completed 历史及专项 jobs；ledger 前后 JSON 一致、外部模型请求 0。53 是测试构造，不是重新读取生产。
- 官方 Node 24 完整 typecheck 通过：[typecheck-node24-final.log (local original; provenance)](../../provenance/source-manifest.json)；web build 通过：[web-build-node24-final.log (local original; provenance)](../../provenance/source-manifest.json)；web 测试 **90/90**：[web-tests-node24-final.log (local original; provenance)](../../provenance/source-manifest.json)；本地 smoke 全部通过：[smoke-node24-final.log (local original; provenance)](../../provenance/source-manifest.json)。
- 官方 Node 24 最后串行全量 backend `npm test` **1255/1255 通过**，434.075 秒：[integration-backend-tests-final-stable.log (local original; provenance)](../../provenance/source-manifest.json)。这次全量发生在最后的专项队列 registry 最小修复之前。此前曾因并行 web build 替换产物造成 page-metadata 的 10 个 before 失败，稳定后该文件 10/10，通过后冻结构建并完整复跑；没有改业务代码迁就环境竞态。
- 最后增补的配置兼容、旧队列三状态 preflight、所有权与原生整链定向 **4/4**：[native-final-guards-node24.log (local original; provenance)](../../provenance/source-manifest.json)。

- 全量之后仅移除全局 `fishery.flow/publication` 队列 registry 及闲置 import，专用 native/manual 的建队和消费者保持。新增定向 **1/1**：[native-queue-ownership-node24.log (local original; provenance)](../../provenance/source-manifest.json)，实际证明 `enqueueOn` 可独立建队、generic 不领取、manual 与独立子进程 native 各自持租约消费，synthetic handlers 零费用。该变更后完整类型检查再次通过：[typecheck-final-tree-node24.log (local original; provenance)](../../provenance/source-manifest.json)；diff/hash 见 [final-tree.json (local original; provenance)](../../provenance/source-manifest.json)。
- **已完成有限 ITF/FAO/MPA 三源已存公开归档对照**：[回放报告](verification/archive-replay-report.md)、[逐样本数据 (local original; provenance)](../../provenance/source-manifest.json)。两轮共 6 个列表，a5/implementation 使用各自实现，b399 仅比较共有入口；共有 core 候选为 114 条观察（57 个独立 URL），行业过滤后为 68 条观察（34 个独立 URL），并非等量独立文章。6 份详情对应 3 篇文章，日期与正文无差异，UTC/洛杉矶时区结果一致。真实 MPA 原件上的合成附件 503 与 72 小时排队场景显示新版 partial/保留 firstSeen，MPA 始终为历史；这不是数据库持久化或真实故障恢复证明。该补验网络、DB、模型请求均为 0，源码前后不变。该离线补验不覆盖其他来源、其余候选详情、真实业务模型与发布、真实刊期及 48 小时运行；部署后的自然轮另列为生产证据，仍不能概括为全部来源或整条真实采集链已验证。

## 接管步骤（切换前计划留档）

以下保留当时的操作入口，不应据此重复执行。fa8 初次切换见[迁移日志 (local original; provenance)](../../provenance/source-manifest.json)与[完成汇总 (local original; provenance)](../../provenance/source-manifest.json)，该阶段 handover execute=0；随后 d92 已完成上述唯一 JFA 目标的显式迁移，见[增量完成日志 (local original; provenance)](../../provenance/source-manifest.json)。完整机制说明见仓库[部署说明](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/docs/deploy.md)。

1. 取得当前安全快照，核对来源、文档/核心身份、用途、任务、receipt、原 ledger 与当前可读绑定；停止旧处理器领取，在途排空并核实原费用。保留 archive 原来源授权和游标。
2. 在副本执行 schema migration 和 `node scripts/fishery-native.ts initialize-review-only` 预演；明确执行时加 `--execute`，只初始化指定政策的 review_only。
3. `node scripts/fishery-native.ts retire-legacy --actor=<operator> --reason=<reason>` 默认只读列旧队列、自动占位与专项范围；`--execute` 在同 processing lease 下仅取消未开始旧 fishery.news，不删除既有完成记录和回执。
4. `node scripts/fishery-native.ts handover --documents=<明确1..20个UUID> --actor=<operator> --reason=<reason>` 默认只读预检。必须有当前 pristine queued，且全部旧任务均属于 pristine queued 或有精确审计/来源证据证明的未开始系统 supersede；无付费和明确限制/专项提名才可用 `--execute` 接管。该命令不自动派发；后续按原生自然 tick 处理。
5. 配置 `configure --sources=fishery-column-moa,fishery-column-fujian,fishery-column-fujian-notices,fishery-column-jfa-press --created-after=<经确认ISO时间> --enabled=true --actor=<operator> --reason=<reason>`。启用需要旧 full/native/manual 已停止并释放同租约，不能暗中扩围或换预算 key。
6. native 启动会在同租约内检查旧 `fishery.news`；仍有 active/created/retry 时明确拒绝，指向退役流程，只有 completed 历史不会阻塞。随后在单独进程启动 `WORKER_PROFILE=fishery-native`，继续保持独立 archive、COLLECT=false 和外发阀关闭。模型阀是否启用单列核准；配置示例默认 false。`status` 和 `/api/admin/fishery/native-processing` 提供真实处理/归组状态、阻断原因及原费用投影。

## 仍需生产效果验收

本地阶段没有触碰生产；随后已完成 fa8、d92 和 3a162cb5 生产动作。当前既有 JFA 的正式显式重评已自动发布；原 13 条和旧 54 条账本前缀保持，新累计为 59 received、估算 ¥0.897700、无未决。自然平静日报已验证；尚需自然新采集稿从入库到发布、真实高分精选/事件热点、有精选内容的日报、周月报和持续运行正例；MARA 明确拒发和指定政策仅审继续保护。

d92 精确迁移、3a162cb5 部署及唯一 JFA 后台重评已完成。已观察到一次原调度平静日报；仍需自然新输入、至少 48 小时、后续日报边界及有精选内容/周月刊正例，不将已有文章重评说成自然新稿闭环，不强行补造刊期。原范围不扩，NPFC 专项、MPA 历史身份、MARA 拒发及政策仅审保持。故障、证据错配或费用不连续时保留全部增量，不能恢复旧库抹除费用。

## 审批记录与当前阻塞

曾有一次自动审批审查拒绝 intake 的代码修改与本地测试复合命令：目标为 `implementation/modules/fishery/backend/column-progress.ts` 的 firstSeen 缓存裁剪，随后连接隔离 `localhost:55445/native_intake_test` 执行 `source bridge|captured news reverts` 回归。审查沿用旧的“只读审查、不得实现新功能”约束，理由为命令包含源码写入。工具返回 `CreateProcess … Rejected`，整条命令确定未启动。

Later explicit project authorization permitted one retry of the local implementation and isolated checks; it completed, with no pending approval. Private delegation wording is not archived.


生产准备还发生过一次被拒的**诊断**动作：[model-routing-approval.safe.json (local original; provenance)](../../provenance/source-manifest.json)记录，一次性加载整个既有 `models.env` 只为检查路由，被自动审批拒绝；确定未执行，原动作未重试。随后采用审批建议的安全替代：仅选择非 secret 路由变量和凭据变量名是否存在的布尔值，不读取或注入 secret 值来做零请求解析。必要的正式服务凭据注入与部署是独立动作，已另行通过并完成；不能把诊断拒绝说成部署失败或当前未决拒绝。

重评后只读观察还曾请求上传新 observer 到生产 release 目录，自动审批以超出当时只读观察范围拒绝；动作确定未执行，未重试。随后使用生产已存在的 observer 完成核验，没有绕过该拒绝。该诊断拒绝已说明，当前不构成部署或重评阻塞；Mac 锁屏也已由用户手动解除。
