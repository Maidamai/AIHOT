# 入口、时序、修订与正文证据链对照审查

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


审查对象：官方 `KKKKhazix/AIHOT@b3998dc6fc138eb9659f33f55eb38c1c716f0d57`（以下“原版”），以及已部署版本 `a5a0f8c064d5c82a707af2f170582338bb8ff10e`（以下“现版”）。证据来自本目录 `snapshots/upstream`、`snapshots/current` 的确切快照；未把工作目录 HEAD 当成现版。已读双方 AGENTS、README、`docs/sources.md`，并重新追踪代码。只读审查，没有请求信源、调用模型、写业务库、改仓库或运行测试。

下文 `U:`、`C:` 分别指两个快照内的相对路径；行号均为快照行号。结论区分“代码可以发生”与“本次取得运行证据”，本文不把静态分支当成生产事故。

## 先给主报告的结论

1. **现版确实把部分单篇正文/附件故障升级成栏目级失败，连续三轮后暂停该栏目。** 这不是所有附件问题都会触发：已识别的 Office 能力缺口、日本水产厅附件数量/特定脚注映射缺口另走 `needs_review`。普通网络故障、缺件和其他解析失败没有同样隔离。原版的详情补取/正文提取通常按文章降级并继续采集，连带影响小得多。
2. **同 URL 正常变化不会直接封锁整源。** 它追加观察版本、使该文旧审核过期，再修订同一个核心 article。会停源的是归档证明不一致、身份归属冲突等异常，或变更后正文/必需附件持续无法核验，从而进入第一项的失败累计。不能把两者混称“同 URL 变化就封源”。
3. **48 小时不只是原版的显示规则；7 天也不是统一的新旧消息截止线。** 原版发现阶段有“初始化时间减 48 小时”的固定准入下限，核心还以首次发现时的年龄生成 backfill；现版专用新闻入口另有最近 30 天列表发现范围，随后仍进入核心 48 小时时序。MPA 能完整入库却成为 backfill、不能作为普通新资讯自动处理，是这条链允许的结果，不表示采集失败。具体 MPA 当前实例应引用主报告的运行证据。
4. **登录页防护是尚未同步的上游修复，应写“补回上游修复”，不能写成“我们主动删掉防护”。** 当前共享抓取器缺少上游已经补上的列表登录链接过滤与登录重定向识别。

## 1. 入口和调度：保留原引擎，新增独立证据入口

| 环节 | 原版实际行为 | 现版实际行为、动机与代价 |
|---|---|---|
| RSS / web_list / JSON | `U:packages/backend/src/sources/collect.ts:281–325` 分派 RSS、网页、JSON、X；MP、external 不进入这个通用分支。RSS 在 `rss.ts:144–167` 使用验证器；JSON 在 `json-list.ts:141–195` 按配置映射字段。 | 共享入口基本保留；RSS 解析拆出 `C:packages/backend/src/sources/rss.ts:168–174` 的 `parseRss`，供 `C:modules/fishery/backend/business-capture.ts:19–26` 从已归档的 MPA RSS 字节发现。ITF、FAO 复用网页列表解析（`business-sources.ts:69–80`）。专用归档不等于直接调用原 `fetchRss`，不能假定仍享有原入口的 ETag/304 增量能力。好处是列表证据可重建；代价是另维护一套获取/调度状态。 |
| 社交与外部输入 | X 的水位、分页积压、失败保留已取得页面在 `U:packages/backend/src/sources/x.ts:114–203`；分片重叠窗口在 `collect.ts:390–395`。MP 有独立同步路径（`sources/mp.ts:40–123`）。HTTP external ingest 逐批最多 50 条、规范 URL、upsert 后排处理（`ingest/items.ts:28–71`）。 | X、MP 仍保留原代码；鱼业证据入口不是 external HTTP ingest，而是归档→`importCapturedMaterial`→新闻才 `storeCapturedNews`→核心 upsert（`C:modules/fishery/backend/import-batch.ts:24–58`）。专用 source 的核心采集开关要求关闭（`store.ts:139–140`、`archive-worker.ts:34`），避免两个采集器争用一个源。 |
| 常规调度 | `U:apps/worker/src/schedules.ts:24,51–62` 受 `COLLECT_ENABLED` 控制；`collect.ts:482–493` 取到期且启用的非 external 源；`504–523` 依据过去 7 天非 backfill 产出调节间隔。 | 共享调度仍在；专用归档控制器独立运行，要求全局模型与通用采集关闭（`C:modules/fishery/backend/archive-worker.ts:193–213`）。一般每小时最多 5 篇，NPFC 每 6 小时 1 份，ITF/FAO/MPA 每轮 1 篇（`27–30`），实际是否启用仍由配置决定。按源隔离控制器，单源停用不等于全站停采。 |
| 最新与历史分工 | 原版以初次导入界限、水位和已存身份管理后续抓取；已知身份仍允许修订。 | `C:modules/fishery/backend/column-batches.ts:357–375` 每轮从最新列表选最近 30 天；缺列表日期最多纳入 30 个身份；新 URL 优先，已有 URL 保留修订复查额度，单篇预算轮换两者。`column-progress.ts:84–95,236–242` 新闻回最新页，NPFC 则继续当前措施目录的覆盖循环。`C:docs/fishery-center/news-flow-correction.md:3–13`、`modules/fishery/OPERATIONS.md:5–9` 明确解释：纠正旧队列一路翻历史而挤占最新消息的问题。代价是 30 天外新发现的旧消息被主动推迟；NPFC 政策材料不能套新闻年龄判断。 |

## 2. 首次导入、原始日期和 backfill：分别看准入、处理、显示

| 规则 | 精确作用及证据 |
|---|---|
| 原版首次导入 | `U:packages/backend/src/sources/collect.ts:94–99,335–336,362–369`：默认回溯 12×30 天、最多 30 条，标 `first-import`；成功后写 `initializedAt`。这直接限制发现入库，不仅是显示。 |
| 原版后续 48h 准入 | 同文件 `94–99`：非 X 新身份的下限是 **`cursor.initializedAt − 48h`**，不是每轮 `now − 48h`；已知身份绕过该下限继续接收修订，未定日期可先通过。详情补出日期后再判一次（`350–357`）；配置的 `publishedAfter` 另由 `sources/filters.ts:35–40` 严格限制。 |
| 核心 48h 时序 | 两版 `packages/backend/src/content/materials.ts:70–98` 相同：原始发布日期、首次发现时间共同决定 backfill；日期未知归历史，过度未来日期视为未知。`150–160` 的 `isHistorical` 还看是否超过 48h，故近期首次导入虽带 `first-import` 标记，并不等于所有历史判断都与旧新闻相同。`publication/publish.ts:399–402` 又阻止任何 backfill 的精选推送，不能把所有消费者简化成同一条件。 |
| 原版 7d | `U:packages/backend/src/sources/mp.ts:13–18,47–58` 的 7 天用于微信账号**首次检查**，最多取 8 条新内容；不是所有来源每轮过滤线。`sources/collect.ts:504–523` 是调频统计窗口，`sources/health.ts:104–117` 是健康观察窗口，也不能解释成显示/有效性规则。 |
| 现版原始日期 | `C:modules/fishery/backend/official-columns.ts:130–146` 读文章元信息，不拿列表、URL 或抓取日补发布日期；`fujian-notices.ts:79–87`、`jfa-press.ts:93–97` 保留日精度或未知。NPFC 的政策日期不够证据就未知（`npfc-columns.ts:56–74`）。收录、发布、事件/生效日期不能互换。 |
| 现版新闻入核心 | `C:modules/fishery/backend/store.ts:262–268` 将证据中的真实发布日期和 `doc.created_at` 作为首次发现时间送入原版 upsert；没有因为今天采到就写今天，也没有统一强塞 `first-import`。日精度的内部排序按来源时区；展示仍保留原精度。因此，最近 30 天发现范围中超过 48 小时的 MPA 公告，可能完整归档并建核心 article，却得到 backfill。 |
| 现版后续处理 | `C:modules/fishery/backend/automatic-flows.ts:68–75` 普通自动入口明确要求 `!core.backfill`、正文 ok、创建时间在范围内；历史/未知日期材料须另有有效业务提名。`OPERATIONS.md:15` 说明提名不改真实日期或 backfill。所以现版 48h 对普通自动处理有实际作用，不能仅说“显示旧”。 |
| 现版 7d 标签 | `C:modules/fishery/backend/flow.ts:181–199` 是任务视图年龄标签；不替代核心 backfill，不是政策失效期。 |

**判断：** 原版把快速订阅、标题/摘要也可处理作为常规路径；现版把“经核验的材料”与“可当新消息处理”拆开。这个拆分有依据，但如果产品想让某个旧日发布、当前仍有业务价值的 MPA 公告自动处理，正确讨论点是既有业务提名/处理范围，而不是改写发布日期，或把 backfill 当成获取故障。

次要一致性问题：`C:modules/fishery/backend/workbench.ts:17–23` 对所有仅有日期的材料统一用北京时间日初；`store.ts:264` 却对 JFA 用日本日初、ITF/FAO 用 UTC 日初。临近 48h 界线时，后台概览与核心可相差 1h/8h 而分类不同。这是静态可达边界，本次没有取得实际误分个案，不应盖过已有 MPA 运行事实。

## 3. 去重和同 URL 修订：正常修订以文章为边界

原版在限量和详情读取前按身份去重（`U:packages/backend/src/sources/collect.ts:71–83`）；核心 URL/推文等身份规则位于 `content/materials.ts:183–210`，同 JSON externalId 的 URL 改名可继续旧身份。不同来源不会随意覆盖已存正文（`282–287`），未取得正文也不会抹掉已有正文（`296–303`）。相同内容只更新表现信息；新内容调用 `reviseMaterial` 增版本并重置后续处理（`367–379`）。原版还抑制历史哈希重现，即 A→B→A 不再作为新修订（`314–319`），降低网页反复渲染引起的成本。

现版保留同一核心身份，增加可复核观察：

- `C:modules/fishery/backend/store.ts:154–225` 校验归档证明，以 source+canonical URL 找文书；相同证据不增版，不同证据追加观察。`119–128` 的证据身份排除抓取时间等易变字段；ITF/FAO/MPA 进一步采用正文、日期、链接、PDF 哈希组成的语义版本（`business-sources.ts:153–158`）。这里有明确真实回访证据注释：页面装饰变了而正文日期没变，不应废掉原审核。
- `store.ts:249–287` 把新正文回写同一 article；`276–282` 明确对已归档、来源绑定的 A→B→A 真修订重新修订，优先保证当前证据与文章一致。好处是可追溯；代价是与通用订阅的历史哈希抑制语义不同，需要维护这一特例。
- 正常改文使该文旧审核/任务过期；`automatic-flows.ts:72–76` 核验正文哈希、观察版本、来源版本与审核绑定。并非“源上的其他文章不能处理”。
- 会抛异常的情况是归档回执被同身份重放成不同证明（`store.ts:173–174`）、文书已撤回（`206`）、核心 article 被别的素材占用（`270–271`）等。`import-batch.ts:19–22` 对 ready / needs_review 的归档证明重建失败也抛出；`archive-worker.ts:119–127` 的导入异常随即将该栏目置为须人工对账的暂停。**这是完整性冲突的停机语义，不能归因于任何正常 URL 修订。**

## 4. 原版全文失败会降级；现版完整证据门禁更严格

原版并不要求每条先获得完整正文才进入后续处理：

- RSS 的真实全文字段/显式 `summaryIsBody`、JSON 同类配置可直接提供 body（`U:packages/backend/src/sources/rss.ts:196–209`；`json-list.ts:141–195`）。其余先存标题/摘要，正文独立补取。
- `U:packages/backend/src/content/extract.ts:420–444` 先直连、Readability，再按条件使用 Jina 兜底；预算耗尽或已知不可用页面返回 null。`459–494` 将没有可靠正文的文章标 `unconfirmed`，不捏造完整正文。
- `U:packages/backend/src/jobs/content.ts:208–237` 对抛异常的正文补取按篇重试，约 10 分钟后重试，达到三次后也标 unconfirmed 并继续 `queueProcessing`；`editorial/analyze.ts:95` 使用 `bodyText ?? excerpt`。MP 缺正文时保留标题/摘要（`sources/mp.ts:69–89`）。好处是采集和信息召回不中断；代价是分析可能仅基于摘要，不能等同已核验全文。

现版入口将“原件归档”和“可用正文”绑定（`C:modules/fishery/backend/column-batches.ts:80–169`、`source-body.ts:10–23`）。但不能夸成统一抓全所有网页附件：MARA/福建动态主要验证配置正文容器和最小长度（`official-columns.ts:130–146`）；福建通知、JFA、NPFC、MPA 才有明确的必需附件模型。ITF/FAO 的文档链接被列为 reference，不要求下载才能称正文可用；MPA 正文内链接则作为必需附件（`business-sources.ts:119–134`）。

严格门禁有明确用途：现版要让审核意见、结构化事实与特定原文/页码绑定，不能以摘要替代完整证据；文档在 `OPERATIONS.md:5,15–17` 说明。它提高可复核性，但正文容器规则、附件格式容量与来源网页结构都会成为吞吐限制。应分别记录“正文未取得”“附件未取得”“原件已取得但解析能力不足”，不能笼统统称链接失效。

## 5. 附件错误何时拖停整源，何时只是待审核

**整栏暂停的完整可达链路：**

1. `C:modules/fishery/backend/column-batches.ts:388–452` 每篇默认 failed；附件 GET/解析异常保留为该篇错误；非已知待审例外且未得有效正文仍 failed。
2. 同文件 `456–465` 将该篇失败汇总成这一轮 `partial` 或 `failure`；`column-progress.ts:63–101` 虽计算成功身份、retryUrls 等下一状态，却把整轮记失败。
3. **数据库进度** `column-db-progress.ts:60–63` 只有整轮 success 才写新 cursor；partial/failure 只调用核心失败记账，原 cursor 保持不动。因此该轮成功身份没有落入 source cursor，后续可能重复抓已成功的条目。归档批次和已导入文章仍在，不是内容全部丢失。文件进度模式 `column-progress.ts:255–256` 的行为不同，不能混作生产数据库游标。
4. 核心 `packages/backend/src/sources/collect.ts:256–277` 增 `fail_count`、后退重试时间；专用 `archive-worker.ts:64–81,88–103` 达三次即暂停，须明确对账恢复。暂停范围是该栏目。

现有测试已经把它写成预期：`C:modules/fishery/tests/materials.test.ts:1911–1922` 构造“一篇成功、一篇缺正文”连续三轮，断言 cursor 和 last_ok 不变、fail_count 增加，第三轮暂停。本次仅阅读测试，未执行。因而这是**高影响设计取舍/连带阻断风险**，而不是本次新复现的生产故障。

原版不同：`U:packages/backend/src/sources/collect.ts:164–218` 按条记录详情失败并轮转；`221–248` 对个别表现不一致记失败后继续；`337–370` 仍可完成一次正常采集。正文任务也按篇处理。原版源故障会退避、健康变差，但 `collect.ts:482–493` 不因 health=failing 永久停调度。现版选择有界失败、显式恢复可防止错误证据不断推进；问题是条目证据失败与源列表可用性共用计数，永久坏附件可能拖住同栏之后的好消息。

**已存在的能力缺口例外必须保留在结论中：**

| 场景 | 现版实际处理 |
|---|---|
| 福建通知 Office 附件 | `C:modules/fishery/backend/column-batches.ts:172–178` 只在页面身份、标题、HTTP 200、哈希均满足且 1–3 个附件属于认可 Office/已核验 PDF 的窄条件下置 needs_review；正文仍空。 |
| JFA 超过 6 个附件，或特定脚注映射缺口 | `C:modules/fishery/backend/jfa-press.ts:103–109`：前者保存附件清单指纹且不假装已下载全部；后者要求原件 HTTP、身份、哈希都核验成功，且恰为认可的 PDF 映射错误。`OPERATIONS.md:17` 记录真实观察依据。 |
| 其他缺件、404、超时、未知解析失败 | 不自动归入上面例外，候选通常仍 failed，从而可能触发整栏失败累计。`column-batches.ts:449,456,465` 把 needs_review 当获取完成而不是 failure，故不能写“任何附件解析不完整都会停源”。 |

待审不等于已取得完整正文，更不等于允许模型：`import-batch.ts:24–53` 没有经核验正文时是 unavailable；仅可更新已存在文书的已确认依赖变化，新条目不会直接成为可审核正文。

## 6. 链接暂时失效，与已确认附件修订，是两个状态

福建通知 PDF 核验见 `C:modules/fishery/backend/fujian-notices.ts:48–89`；NPFC 的唯一附件、编号和页覆盖核验见 `npfc-columns.ts:26–74`；MPA 要求 1–3 份 PDF、原件哈希、页文本与首份公告编号/年份相符（`business-sources.ts:132–150`）。这些是明确的完整性条件，不是只检查链接可访问。

- **同附件 URL 暂时 404/超时：** 没有新正文或新字节证明，不能推断内容撤回；`C:modules/fishery/backend/store.ts:210–218,235–244`、`import-batch.ts:25–53` 记录 unavailable，不自动废掉旧证据。它仍可能影响这轮源健康，见上一节。
- **已核验落地页确认必需附件集合变了，或同 URL 返回已核验的新字节：** 即使新附件正文还没完成，`import-batch.ts:32–47` 可对已存在文书追加缺正文的新观察，使旧审核失效，等补证；`fujian-notices.ts:91–96` 给出这种差异判定。不是宣布法律上撤回，也不自动公开新内容。
- **新原件完整且正文核验成功：** 进入正常同 URL 修订，保持核心身份并刷新证据绑定。

这里已有合理的分层，应修正“链接打不开就正文变更”“附件变更就整源封锁”两类过度概括。更值得调整的是源健康和单篇重试的耦合，而非放松必需附件证明或把不可解析的内容当完整正文。

## 7. 应补回的上游登录页修复：归因已核对历史

原版 `U:packages/backend/src/content/extract.ts:32–65,425` 识别登录路径及从文章转去登录页的最终 URL；`U:packages/backend/src/sources/web-list.ts:49–57,161` 在列表阶段排除登录/注册链接。注释记录真实事故：登录表单通过正文长度门槛、导航变化制造大量假修订。现版 `C:packages/backend/src/content/extract.ts:384–404` 与 `sources/web-list.ts:47–56,150–165` 没有这两层；`lib/page-content.ts:9–19` 的错误页文本过滤不等价。

已读本地 Git 历史：现版这两个文件最后同步点是 `4947ad03309c64a4002bd073d690aee50c548063`（2026-10-18），从它到 `a5a0f8c` 两文件无改动。GitHub 只读 path-commits 查询确认，上游修复为 [690456b5](https://github.com/KKKKhazix/AIHOT/commit/690456b5f3765c74f0af73e44588c83acbb8183a)（2026-10-20 提交入库），还包括 register 尾斜杠误判修正 [a0d1e75b](https://github.com/KKKKhazix/AIHOT/commit/a0d1e75b00ede7e503ca948e71a468db964b2df2)。这支持“分叉之后未同步修复”，不支持“我们主动删除”。

建议主报告列为**补回上游修复**。专用来源的固定域名/正文容器降低部分暴露面，不能替共享引擎证明安全；本轮未证明现版已发生登录正文污染。

## 审查边界与后续优先级

优先解释已取得运行证据的 MPA 首次发现、原发布日期、backfill 和业务处理资格，勿以采集成功推导已进入普通自动链。其后核对“单篇故障→整栏三轮暂停”是否符合使用者希望的持续监测目标，再考虑保留成功进度、把源故障与单篇待补证分开；最后补回上游登录修复及统一日精度后台时序。以上均为审查建议，没有实施变更。
