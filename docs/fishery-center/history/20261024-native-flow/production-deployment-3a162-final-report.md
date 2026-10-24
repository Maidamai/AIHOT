# 远洋渔业资讯生产交付结果（2026-10-24）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


当前生产为 **3a162cb5f30e27a6385d0fb0c1b7227f059028a3**，四服务运行且原鉴权、私有预览、来源许可、原四模型信源及累计¥10上限保持。真实JFA文章经正常管理员控件单次重评，已完成生产预筛、双评分、结构化、摘要写作与公开投影；网页/API/RSS/MCP一致可读。评分22/22，未精选，没有形成事件或综述。既有自然刊期任务已生成0入选的安静日报，日报网页/API/RSS一致可读；没有主动compose。

## 版本和部署事实

- 正常提交/推送同一分支 `Maidamai/AIHOT:feat/fishery-native-flow-v2-20261024`：fa8原生链实现 → d92有界system-superseded接管修复 → 3a单文件预筛澄清；无force，旧分支不动，实施仓库clean。
- 当前3a仅改 `industry/prompts/prefilter.md`，没有改数值门槛/增加二次审核/白名单。2/2仅既有假模型定向验证，独立审查通过；真实结果以本报告回执47—51为准。
- 发布目录 `[private-server-or-temporary-path]`；镜像 `fishery-pilot-app:native-3a162cb5`，imageId `sha256:64d3522e244d9775b918695792a695169778d4aa8da385c9ba4c83c31df2381d`，API/web/native/archive实际AIHOT_RELEASE均为完整3a SHA，旧manual停止。
- 865个镜像文件逐hash核对，完整70改动路径与committed bytes一致；前端85个复用文件逐hash相同。预筛Markdown由backend运行期读取，不在前端依赖图，未重复web build或全量测试。
- 新预筛版本 `prefilter@f1dd56b576`，systemHash `2d3353d0dd0c0670de5f851d0fd31301e52f34ce2c7a1cab70bb96993c785576`；专项配置 `868fbe5dd400e28b8978065bc48bbff465241b6071a79c51f4ede3f488192c7c` 保持，未重新派发旧政策。
- 最新停消费者私有备份：`[private-release-or-backup-location]`（0700）；DB dump SHA `075f631a58ba5fc72447688878f4050608967d33bdb5e62f800217b1e7403c21`，data tar SHA `a7f8939c06f242fe8aadc83706245ff36067c3968d95a7bf3151da53a963959f`。没有恢复旧生产库或覆盖自然新增数据。
- 本轮没有再跑schema、八源profile/recover、policy初始化、legacy退役、handover。原业务库虽然名为fishery_pilot_test，始终按生产库保护，测试runner从未运行在它上面。

## 单次正式重评与真实结果

对象为真实已采集JFA新闻（不是假服务样本，也不是本轮自然新到采集正例）：

- document `aa4e2e7a-67f0-4244-8552-c90f19854928`，article `jxr71d4jo1wbyzpbkrob4rwe6`。
- 原题“11月3日から7日は「いいさかなの日」”，日本水产厅原链接 `https://www.jfa.maff.go.jp/j/press/kakou/261023.html`。
- 原日期2026-10-23（JST日精度），内部UTC2026-10-22T15:00:00Z；发现于10-23T14:51:32.146Z，backfill=false。正文hash db524330…ba796c与原第1版保持，未改日期、来源或输入。
- 通过既有已登录Chrome正常“重新评估”与必要确认各一次，应用自己处理会话/CSRF/idempotency；没有读取cookie/password/CSRF值，没有evaluate/fetch或内部函数/SQL绕鉴权。
- 审计1184：actor `admin:1`，requestId `mvlzl1zy-a5kp30xg`，jobId `5ebce0f6-66ad-4ed1-bef2-bc47db14b328`，在已验3a运行后发起。没有重按、额外dispatch或重评分。

| 实际阶段 | 结果与回执 |
|---|---|
| 新预筛 | receipt47 completed，PASS：“含海洋环境变化致渔获鱼种时节变化及低利用鱼采购交易事实”；实际f1dd及systemHash与部署模板完全匹配 |
| 双评分 | receipt48、50 completed，22与22，最终22；门槛未改，selected=false |
| 结构化 | receipt49 completed |
| 中文摘要写作 | receipt51 completed，writer=summarize |
| 分析与投影 | 新analysis2，relevance=pass、无processing_error；publication public/eligible=true/selected=false |
| 归组 | grouping_status=complete、无grouping_error，但story_id/fact_id均null、没有digest、没有新group/digest付费回执；不冒称事件综述成功 |

实际可读标题：**日本水产厅将11月3日至7日定为“いいさかなの日”，2026年以“魅了ギョ WEEK”推进低·未利用鱼利用**。

旧analysis1与receipt46的BLOCK完整保留。旧BLOCK与新版PASS是两个版本的真实结果，未覆写历史，也没有手工PASS或提分。内容核查指出消费推广中确有资源与采购事实，因此澄清宽召回而没有提高新闻价值；22分未精选仍按原规则执行。

## 费用、数据和安全边界

本次单条重评新增 **5次**，账本entries **55—59**，按真实usage估算 **¥0.162376**；累计 **59 received、¥0.897700**，pending/unknown与未决预留均0。所有实际模型均deepseek-flash，maxTokens依次512/1024/1200/1024/2048，沿原模型回执与金额熔断，未新增模型或信源。

receipt.cost/currency本身为空，CNY是原账本按usage计入的估算金额，不声称已核销账单价。旧54个entries逐hash前缀保持，旧analysis1/receipt46完整hash不变。旧observer的newLedgerEntries从53切片，包含旧54；实际新增只按55—59计算。旧observer全体receipt版本比较false是因为仍包含旧46，新的47实际版本/hash准确，不是配置错误。

原13个可读article ID/来源/真实日期/binding逐项相同，只新增该JFA，可读数13→14，精选timeline仍0。指定政策 `5f67141e-47ee-4521-bd66-7e842936c02f` 仍review_only且不可读；MARA `5c4a718f-bb43-475a-b765-246725c0607f` 的实质授权拒发和已付费历史保持。

scope仍fujian、fujian-notices、jfa-press、moa，原起点2026-10-21T07:13:00Z，累计上限¥10。ITF/FAO/MPA归档启用不等于进入模型范围。站内/对外全文仍关闭，本条bodyMode=summary、syndicate=false；未开放全文或对外推送。

## 实际阅读出口（06:03:45Z）

| 出口 | 实际结果 |
|---|---|
| 网页 `/items/jxr…` | 200，private,no-store，同一目标可读 |
| API `mode=all&window=7d` | 200，含同一ID、中文标题、摘要、来源和真实日期 |
| API `mode=selected` | 200，不含目标；22分未精选的正确负例 |
| RSS `/feed/all.xml` | 200，含同一guid/标题/原日期/阅读链接 |
| MCP既有myhot_get_latest(all,7d) | 200/SSE，无RPC错误；target结构化对象与all API逐字段相同 |

仅使用既有观察脚本和非持久轻量只读HTTP/SQL，不新增生产文件/能力，不读凭据。外部匿名公网仍走原登录门禁，API/web仍只绑定127.0.0.1，PRIVATE_PREVIEW及原安全阀保持。独立Agent Markdown出口本次未再单独生产复验，不拿本地测试冒充。

## 已发生的自然刊期：安静日报，不是有稿日刊

既有自然compose **207** 于 **06:14:14.362—06:14:15.648Z** 实际运行并最终 **ok**，detail为 generated=[daily:2026-10-24]、failed=[]；数据库reports **id1** 已落地，生成于06:14:15.645Z，标题 **“本期暂无入选资讯”**。

实际generator为 judgedReports=1、selectedReports=0、events=0；内容条目/highlights/flashes均0，leadItemId=null、model=null。这是规则生成的 **0入选安静日报**，没有把22分JFA塞成精选内容，也没有日报额外模型费。周报和月报仍0，未宣称已有内容日报/周报/月报或事件综述。

覆盖窗口保持原 **北京时间10月23日08:00至10月24日08:00**（UTC10-23T00:00至10-24T00:00），生成时间如实记录为06:14Z。原版periodReports仅精选，因此JFA不进内容条目；judgedReports可计非精选的已评分稿，按listedCondition(end)、非backfill及timeline窗口计算，本条贡献已评分1。不能因投影更新晚于截止就直接排除。此前compose190在新分析前失败的记录保留，后续这一次为既有自然任务成功补齐，没有手工compose、改日期/visible_after或强造有稿刊期。

06:17:04Z回读分别证明：

- reports记录存在，日期2026-10-24、生成时间/窗口/0内容明确；
- compose207最终ok，没有failed项；
- 既有 `/api/v1/dailies/latest`、网页 `/daily/2026-10-24`、RSS `/feed/daily.xml` 均200且包含同日期/安静标题；
- 累计仍59 received、估算¥0.897700、未决/unknown0；全部59个entryHashes与重评后完全相同，analysis1+2/receipt46、唯一重评审计、read14、policy/MARA均保持。

该次只读收集最初因本地结果列表遮蔽HTTP模块而未输出，修正收集变量后返回完整证据；没有重跑compose、worker、重评或模型，也没有新增生产文件。

## 归档当前实况（06:01:19Z）

JFA最新05:33轮partial，正文获取/解析失败2、new0；MPA最新05:32轮partial，正文失败1、new0。两者列表成功、fetch_runs为ok/partial，但job_runs因未完整完成记录failed。当前两者fail_count=0、last_error=null、pausedReason=null、enabled=true/current=null，成功进度与失败重试项都保留；下一轮分别06:33:50和06:32:38。不能用先前04时的成功轮覆盖这些新partial，更不能宣称归档全绿。未主动抓取或重试。

停机时遇到的8个pg-boss内部send-it占位，经精确ID/dest/revision/payload/hash分类后原样保留，未删除/消费；新archive正常转发完成，原调度继续，没有伪造空queue。

## 执行限制与证据

Mac锁屏曾阻止正常UI，已在用户明确手动解锁后恢复一次；此前未执行重评。另有两次自动审批拒绝均已留档：早期完整凭据文件路由诊断、此次向生产目录新增观察脚本。两动作确定未执行，未重试/绕过；分别采用允许的非秘密路由核验，以及既有observer/非持久读取完成。没有因此改变安全设置。

主要安全证据：

- `production-preparation/prefilter-final/rerun-invariants-summary.safe.json`：审计、原54/analysis1/46/13保护及新增费用/出口一致性。
- `after-ui-submission.safe.json`、`business-after-ui.safe.json`：实际新分析/回执/公开投影/归组结果。
- `outlets-and-period.safe.json`：实际网页/API/RSS/MCP与重评后、成刊前字段。
- `natural-compose-final.safe.json`：自然compose207、0内容安静日报、三路实际读取和59账本/原对象连续性。
- `runtime-after-ui.safe.json`：59次真实账本、运行版本、最新JFA/MPA健康与partial。
- `deployment-before-rerun.safe.json`、`production-before.safe.json`、`runtime.safe.json`、`http-final.safe.json`：部署及重评前保护。
- `result-observer-upload-denial.safe.json`、`production-preparation/model-routing-approval.safe.json`：拒绝原记录与安全替代。
- 历史阶段不可覆盖：`production-deployment-d92-report.md`、`production-deployment-3a162-before-rerun-report.md`。

尚未完成的长期观察：自然新到采集正例、真正达到精选/形成事件与综述的样本、未来周/月刊期和48小时连续运行。当前这条是真实既存新闻的正式重评与全部动态发布正例，并验证了自然安静日报；不伪装成自然新到采集、高分精选、有稿日刊或周/月报正例。无需再等待未来整天或触发任何生产操作。
