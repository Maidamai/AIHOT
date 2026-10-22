# 渔业素材首期本地模块

实现范围是管理员手工闭环：在已有 source 上登记许可与健康备注，登记文书身份，追加观察，人工审核，导出当前获准的摘要与链接 JSON / Markdown。另有三个固定来源的单次采集入口及区分真实请求/旧原件回放的隔离验收工具。原有新闻采集、队列、AI行业示例分类和公开出口继续使用原实现；渔业地区、活动维度只在本模块受控字段内。未新增匿名 API、机器凭据、常驻采集、模型/OCR调用或外部调度。

## 数据和审核语义

- `fishery_sources` 引用原有 `sources`，不重复创建信源实体；许可默认 `unknown`，所有用途默认关闭。许可为 `permitted` 需填写核验时间、证据链接和复核期限。健康列表显示原系统 `health / last_fetch_at / last_ok_at / last_error`，并通过现有 `sourceHealth` 扩展提示许可待办；不按一天无更新判死源。
- 文书保存来源、发布机关、源文号（未知为 `null`）、原文 URL、可选 article 关联。没有标题相似自动合并。相同来源同 URL 重复登记返回409；后续在原文书上追加观察。
- 每次手动观察都追加新 revision，即使哈希曾在历史出现；A→B→A 不吞掉第三次观察。原文哈希与每个附件的哈希分别保存，附件单独变化也改变观察内容哈希。`observed_at` 是服务端登记时刻，不充当发布或生效日期。
- **管理员API中的原文/附件 SHA-256 仍是声明值。** 新增离线来源工具可核对本地归档文件与HTTP收据中的hash，但不认证远端HTTP，也不自动采集或批准。 输出 `hashAssurance=admin_declared_not_fetched`。观察的 `content_hash` 和素材的 `contentHash` 则由系统对元数据计算：递归按对象键的字典序排序，数组保持顺序，JSON UTF-8后SHA-256。管理员API不保存原文、正文或译文；schema拒绝额外全文字段。离线工具的正文仅写入用户指定的本地待审目录。
- 发布、通过、生效起止各自保存 `{precision: unknown|year|month|day, value}`，未知不能补日，日不能补时间。`effectiveDateState` 只按显式 `dateComparisonReference` 的 UTC 日比较日期进度，`reached` 不能解释为当地法定生效时刻、当前仍适用或作业许可；当年/当月及更早的年/月精度仍返回 `unknown`。
- 审核追加记录绑定精确 observation revision 和 source revision。新观察、任何来源资料更新、最新审核驳回都会使旧批准失效。`applicabilityReviewed=false` 会原样输出，不伪称全部适用范围已核验。来源许可可未知但仍可登记内部待审元数据；此时导出始终关闭。
- 每次导出都重新检查当前许可、核验时间不在未来、复核期限、来源参与模式、文书撤回和最新审核。关联 article 时经共享 `publication/itemAvailability` 读取层仅允许 `public` 或 `summary-only`；已撤回、删除、未知或其他状态阻断。旧revision不能回读绕过当前限制。
- 只导人工摘要与来源/附件链接、哈希和日期元数据。即使来源登记了全文/翻译许可，输出 `fulltextExport=false / translationExport=false`；许可字段是用途登记，不是已实现对应导出服务。`allowedSummary` 与 `allowedPublication` 都须打开。外部附件链接不等于获准交付原件。
- JSON和Markdown分别以 UTF-8 字节限制为48KiB；超限返回409，不能宣称已成功交给Easel。正文和URL在Markdown输出中转义，来源内容不能授予工具权限。实际Easel模式/上传容量仍待端到端验收。
- 文书撤回为本期终态；观察、审核历史与所有手动变更/导出审计保留，不提供删除/恢复接口。article_id 刻意不级联，普通文章清理不删除档案；关联文章消失后导出关闭。来源FK阻止误删有档案的来源。尚未验证离机备份恢复或建立长期保留SLA。

## 管理员 API

所有路由位于 `/api/admin/fishery/`，复用既有 `adminHandler` 会话与 `no-store`；写操作要求当前 `x-csrf-token`。未登录401，CSRF缺失/过期403，字段错误400，不存在404，过期版本/权利/审核/容量冲突409。没有 `/api/fishery/v1/...` 端点；不提供公开AgentAbility、RSS或MCP证据出口。

| 方法 | 路径（在前缀后） | 用途 |
|---|---|---|
| GET | `sources` | 已登记源、当前许可和原有健康字段 |
| PUT | `sources/:sourceId` | 登记/更新许可；新建 `expectedRevision=0`，更新传当前revision |
| GET / POST | `documents` | 最近100份文书 / 登记文书 |
| GET | `documents/:id` | 文书、全部观察与审核历史（管理员可看未审核元数据） |
| POST | `documents/:id/observations` | 追加观察；`expectedRevision` 须等于当前版本（首条0） |
| POST | `documents/:id/reviews` | `revision, sourceRevision, decision, applicabilityReviewed, note` |
| POST | `documents/:id/export` | `revision, format: json|markdown`；下载并记录导出hash/权利版本审计 |
| POST | `documents/:id/withdraw` | `expectedRevision, reason`；即时阻断后续导出 |

先在既有后台登记 source，保持试点 `enabled=false` 避免自动采集，再登记模块许可。生产来源的真实许可不能照抄测试fixture。登录后可通过现有 `GET /api/admin/me` 获取当前CSRF，使用正常会话调用上述API。本期没有新后台页面，操作界面留后续；请求schema以 `contracts.ts` 为准，最小请求样例见 `tests/fixtures.ts`。

## 离线回放

使用Node24，先按仓库约定迁移一个**独立本地**`*_test`或`*_ci`库。脚本拒绝其他库名和远端主机，创建禁用的合成external源，不访问示例URL、不调用模型、不生成凭据。不要在完整测试正在复制模板库时同时运行demo。

```bash
DATABASE_URL=postgres://aihot_test@127.0.0.1:55437/fishery_mvp_test \
  AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials \
  node modules/fishery/scripts/demo.ts --output /tmp/fishery-demo
```

输出 `fishery-fixture.json`、`fishery-fixture.md`，均标记合成fixture与管理员声明哈希。端口和测试账号仅是本任务临时隔离实例示例，不是部署配置。

## 后续边界

素材工作台已提供现有后台内的列表、证据详情、带版本/原因的审核与受控导出，见[操作说明与访问边界](../../docs/fishery-center/material-workbench.md)。仍未实现：去重前在线抓取hook、通用HTTP失败/304持久化观察、常驻增量附件采集、生产环境PDF解析与OCR、政策关系/条款证据、完整法律适用性审核、校准后的渔业新闻taxonomy/提示词、生产源批量入库、机器只读认证、固定清单snapshot/changes/tombstone、Easel拉取及下游处置台账、传播后撤回、真实样本准确率/性能/成本、生产部署和生产恢复演练。手工导出不能保证下游已经保存的包自动撤销；使用前须重核，`revalidateBy`只规定最迟复核期限，不保证此前权利不变。

安装：在 `site/modules/index.ts` 与 `server.ts` 注册，`site/package.json` 依赖模块包，Dockerfile包含模块包清单；无Web部分，无需在web清单登记空模块。迁移每个文件一条在线语句，新增表非破坏性；移除清单可关闭模块路由与健康扩展，保留档案数据，不改历史迁移。请勿删除许可/审核记录来“恢复”导出。


## 官方原件离线适配（素材格式0.2）

`scripts/prepare-official.ts`读取已有HTTP收据及响应文件，不自行联网、不加载.env、不查询数据库、不调用模型、不建立调度、不批准或发布。输出capture.json；只有正文可验证时另写body.txt。readyForReview=true仅表示原文可送人工复核，不表示已审核或已获转载许可。第三方HTML/PDF不提交仓库，测试只用最小合成结构。

晋江从.article_time按+08:00读取真实时间，保留sourceCapture.publicationLiteral/publishedAt；仅meta日期时保留day精度。无日期不从URL或事件日期补齐；不从出发港推断企业归属。日期冲突时关闭可用材料输出。

IOTC保留Pending、异议截止、可见通过年份；不把隐藏的1月1日当精确通过日期。PDF和页面的文号、Pending及截止日须一致。捕捞限额条款年份单独记入policyContext.provisionYears，不搬到抓取当年。未核发布日期及effectiveFrom保持unknown，异议截止不是生效日；未映射状态保留unknown和警告。

IOTC当前CMM也可进入现有栏目批次：`node modules/fishery/scripts/collect-columns.ts --id <新批次> --data-dir <私有目录> --columns iotc --limit 1 --iotc-select 26/03`。`--iotc-select`接受当前首页实际发现的文号或完整URL，可逗号分隔；省略时依当前列表顺序选取，不固定旧决议。当前首页并不代表全部历史CMM。只从标题列发现身份、从可见年份取年份，状态列的Supersedes链接不作为新候选；Superseded条目不进入当前候选。列表和落地页文号、年份、状态必须一致，Active不自动转为已生效或法律适用。

批次先保存并核验已检查的robots原始字节指纹，变化即停，所有IOTC请求之间至少等待10秒；随后保存当前列表、落地页和同源PDF的原始响应与回执。PDF须完整逐页提取，缺失、解析失败或超限均明确失败。批次导入会重新验证robots/列表身份、重读原PDF并重新解析，同时核对落地页/PDF/列表证据及正文哈希；不信任manifest里的可编辑标题或提取结果。正文仍进入同一管理员批次导入和待审核链路，转载权、法律适用性和发布均待人工核定。

sourceCapture单列原件hash、获取状态/时间/URL、解析器、页数和正文hash。macOS使用系统Swift/PDFKit；Linux使用已安装的Poppler `pdfinfo`/`pdftotext`，专用试验镜像从Debian发行版安装并记录两者版本。缺解析器或不支持的平台为unverified，不静默安装或转OCR/付费服务。全部解析只读同一份私有字节快照：10MiB原件、200页、共享60秒、每次及累计文本4MiB上限；空白/扫描、加密、诊断、损坏和超限不会放行。获取失败、缺失/未核正文、字段冲突、PDF获取/解析不全会被附加导出门槛拒绝，人工批准也不能替代该门槛。原权利、当前版本审核、撤回、publication检查仍先执行。服务器隔离试验的边界与启停见[server-pilot.md](../../docs/fishery-center/server-pilot.md)。

policyContext/sourceCapture为可选JSON元数据，旧手工观察兼容，无数据库迁移；私有素材导出版本为fishery-material/0.2，无新增公开出口。

```bash
node modules/fishery/scripts/prepare-official.ts --source jinjiang \
  --receipt /path/jinjiang-request.json --html /path/jinjiang.html --output /tmp/fishery-review/jinjiang
node modules/fishery/scripts/prepare-official.ts --source iotc \
  --receipt /path/iotc-request.json --html /path/iotc.html \
  --pdf-receipt /path/iotc-pdf-request.json --pdf /path/iotc.pdf --output /tmp/fishery-review/iotc
```

收据至少含requestedUrl/finalUrl/status/finishedAt/sha256。它们是已归档记录，不能伪造为新请求。--source fuzhou可重放获取失败，不能用搜索缓存补正文。工具不会调用observe/review/export API；人工摘要、用途许可与业务审核仍走既有管理员流程。[本轮验证记录](../../docs/fishery-center/source-adapter-validation.md)。

## 本机隔离验收

`scripts/capture-official.ts`仅对固定来源发单次受SSRF保护的GET，保存实际响应或网络失败；IOTC页面/附件之间遵守10秒间隔，不自动写库或审核。当前本机保留地址解析触发防护，在线正文未取得；没有关闭防护或换传输绕过。

`scripts/pilot-evidence.ts`仅允许`AIHOT_ENVIRONMENT=test`、本机或隔离Compose服务`fishery-db`的`*_test`库，以及loopback HTTP API。`--archives`校验旧原件hash并离线解析，`--live-captures`读取同次显式采集生成的收据；两者互斥，不把旧归档标为实时采集。通过核心素材入口把成功正文和原始字节存入隔离库私有档案，模块API仍只接收元数据。真实许可保持unknown、主记录不审核。只有显式`--exercise-test-review`才对测试克隆使用合成许可和测试审核，验证导出、同URL字节替换、解析器版本、权利版本和撤回门槛；没有模型评分。

test环境的JSON/Markdown导出都携带“隔离测试审核，不代表人工业务批准或真实转载授权”标记，标记参与内容hash。失败原件即使测试批准仍不能导出。实际环境、命令和验收范围见[本机隔离试部署记录](../../docs/fishery-center/local-pilot.md)。

## 业务指南审核执行身份

业务指南显示“编审整理／最终审核”。历史 `origin=human_editorial` 和 `human_decision` 字段名是既有工作流与来源分类，不证明真人编写或真人专家参与；原 actor、原因、来源证据与历史决定不回填或重写。旧决定未显式记录执行身份时显示“执行身份未知（未记录）”，即使账号或角色含 human 也不推断真人。

正常鉴权与 CSRF 管理员决定接口可提交 `executorKind=human|authorized_agent|unspecified`；省略为 unspecified。后台弹窗可主动声明“真人手动审核”或“授权代理审核”，默认未知。此项为审核执行者声明，不是身份认证或专家资质证明，不授予新权限。读者仅接收白名单执行身份类别，不接收审核账号、原因或其他身份信息。来源、内容、版本与当前 AI 回执哈希绑定及全部可读门槛保持原有规则。
### 受控轮次接入原信源账本

运营停用沿用原信源的 `participation_mode=isolated`，不删除来源、原件或费用历史。隔离源不能创建或继续模块加工、指南核查、归档导入和数据库采集轮次；普通阅读也排除该源。恢复必须由管理员明确操作，默认种子与归档同步不能覆盖隔离状态。

按使用者决定，`fishery-column-iotc` 已停止运营采集，`collect-columns.ts --columns iotc` 在任何网络请求或归档创建前拒绝。保留 IOTC 适配器与既有回执供离线核验，不影响农业农村部、福建或其他机构的来源。源停用后应通过正常内容管理把仅依赖该源的条目下架，使原站发布投影与缓存同步；不启动全站付费 worker 来完成此事。

### 现有生成链的自动派发

`fishery.flow.dispatch` 设置缺失时关闭。显式启用后仅接农业农村部这个已接通来源，按 `createdAfter` 和可选 `documentIds` 限定范围，不回溯全库。导入可以建立零调用的 `auto-` 任务占位；当前观察和信源版本的普通素材审核未通过时，不入付费队列。已有处理进程的维护循环每次最多检查5条，按证据、审核、配置与规则版本保存检查记录；前5条待审不会使第6条永久遗漏。导入落库到入队之间中断，下一次维护补派；入队与派发审计在同一事务，重放不重复入队。

```bash
node modules/fishery/scripts/automatic-flows.ts --status
node modules/fishery/scripts/automatic-flows.ts --enable --after 2026-10-21T07:13:00Z \
  --documents <本轮明确核验的文档UUID> --reason '明确授权的现有MARA证据化流水线试运行'
```

启用不写素材 `approved`，不写最终 `qualified`。队列仍是既有 `fishery.flow`、单消费者、`retryLimit:0`，使用既有阶段回执及累计10元金额闸门。自动任务在消费时、取得金额锁后和发送前重新核对配置、来源隔离、观察及素材审核版本。已收到结果复用；失败、pending/unknown、执行中断须走既有明确对账流程，维护不会自动付费重试。最终审批仍通过正常管理流程，事务派发已有 `fishery.publication` 后才进入原站阅读投影。

停止自动派发使用相同范围的 `--disable --after ... --documents ... --reason ...`；它不清空任务、收据、费用、采集游标或归档计划，已发出请求的结果仍正常结算。此功能没有恢复原版双评分、热点归组或日报，也不开放匿名访问。

`collect-columns.ts --incremental` 默认 `--storage file`，仅用于指定私有目录中的隔离归档验收。明确选择 `--storage db` 才读取既有 `fishery-column-moa/fujian/iotc` 的 `sources.cursor.fisheryColumnProgress`；缺失来源、数据库故障或游标/配置冲突立即停止，不回退文件游标，也不创建或启用来源。每轮仍有每源1–5文章、1–3列表页的上限，没有新增队列消费者或定时任务。

数据库模式在GET前将来源绑定意图写入本轮journal，再使用原 `fetch_runs.detail` 登记相同轮次/来源的幂等意图。GET期间不持数据库事务；结束时锁定来源和运行记录，核对配置、游标及来源绑定，复用原 `recordFetch` 更新健康、失败次数和退避。只有完整成功才合并当前整份来源游标中的模块命名空间；失败/部分完成保留整份成功游标和 `last_ok_at`，待完成证据仅留在运行detail和归档journal，下一轮可保守重复请求。归档候选不是新入库素材，`new_count` 始终为0。进程在数据库提交后中断时，原 `--resume --acknowledge-stopped --reason ...` 可对账，已结束的运行不会再次计数或覆盖较新进度。

`--status --storage db --data-dir <private-dir>` 输出真实来源健康、退避和数据库游标；`--storage file` 明确显示隔离文件进度。既有管理员只读接口 `GET /api/admin/fishery/batches?storage=db` 返回同一数据库进度及 `sourceState`；省略参数读取数据库模式；离线验收须明确指定 `?storage=file`。目录中的不可变批次和journal是证据/恢复输入，不是数据库模式的第二份权威游标。运行仍不导入、审核、发布或调用模型。


## 原框架统一发布桥接

`backend/publication-bridge.ts` 的 `syncFisheryPublications(actor)` 仅把当前合格文章摘要和最终审核通过的业务指南关联到核心 `articles`、`editorial_overrides` 和 `publications`；使用正常素材身份与审计，不调用模型、不创建分析或回执、不伪造精选、归组完成、评分或历史公开发布时间。指南仍是资料参考，原有结构化字段与短证据锚通过原文章详情的模块部分呈现；私有证据全文不进入核心正文。

`fishery_publication_bindings` 保存稳定身份、审核投影哈希和核心素材修订号，不保存永久合格副本。每次原资料池、搜索、详情、时间线、数量、RSS、MCP 或同步读取，都重用现有文章与业务审核的当前资格计算；来源、观察、正文档案、规则、候选或最终审核失效即隐藏。未关联的模块来源文章也拒绝读取。未知日期保持空值和历史归档标记，已审核参考资料可进入资料池，不借采集时间冒充发布时间。

原模块的受保护素材与后台仍使用原来源可用性校验；该内部校验先于发布资格，避免递归调用统一发布门控。此桥接不把内部审核解释为公开转载许可。预览的鉴权与 HTTP `private, no-store` 仍由部署入口负责；不能直接据此开放匿名访问。离线测试使用明确合成的审核与模型桩，真实数据展示应区分已保存安全 DTO 回放与重新核验的当前生产状态。


正常文章最终合格和指南最终批准会在同一数据库事务中写入 `fishery.publication` 非付费任务；任务单例键包含具体最终决定哈希，新版本不会被仍活动的旧任务吞掉。既有 `consume-flows.ts` 同消费者、同处理租约执行它，每个任务只处理目标材料，并在原审批写锁下重核当前投影和决定；重复执行复用原文章身份，过期决定不覆盖新关联。暂时无法读取的当前批准会失败并留下可追踪任务，不把成功审批后的一次关联失败静默丢掉。

新队列仅有两次重试、五秒延迟、五分钟执行期限；既有消费者只对这个明确的非付费队列调用 pg-boss 维护以恢复过期任务，停止和租约丢失时清理维护定时器并停止取任务。不启用全局调度或监督，不恢复付费 `fishery.flow`，不启动采集或模型。重试耗尽保留失败状态；正常重新审核批准产生新的版本任务。原站 `editorial_overrides.visibility` 是独立控制列，关联任务不写它，后台正常撤下必须由正常可见性操作显式恢复。

### NPFC 逐措施原件接入

`collect-columns.ts --columns npfc --limit 1` 只从 `https://www.npfc.int/cmms-pdf` 的当前可见列表发现逐项措施，保存列表、措施页、唯一同源 PDF、HTTP 收据和完整逐页文本。所有请求至少间隔10秒，原件不超过10MiB、200页，正文解析复用现有 PDF 工具和上限。robots 采用2026-10-22实际核验指纹，变化即停，不绕过限制。当前仅这一列表页，不宣称完整历史措施库。

导入重新核验原始列表身份、措施页标题、PDF文号/年份与声明日期；冲突、附件缺失和解析失败不进入待审正文。URL可能沿用旧年份，身份以列表、页面及PDF一致的文号为准。版本文号、声明日期保存在 `sourceCapture.regulatoryListing`；其适用海区和当前生效状态明确为unknown，原文发布、通过及生效日期也不从URL、文号年份或收录时间补造。列表标为current不等于适用于某公司、船旗、鱼种或作业地点。

成功归档可经既有批次导入登记为未审核素材，转载权未知，不生成评分、摘要、审批或发布；普通读者不会因采集而看到新材料。NPFC后续明确的DB增量轮使用相同 `sources.cursor`、`fetch_runs`、独占来源租约和失败退避；同源正文变化使旧审核失效，失败不推进成功游标。源被隔离时禁止继续导入/采集。初版没有启用NPFC长期定时，农业农村部现有小时计划保持原样。

福建通知公告的资金政策主要在附件，当前只完成页面和附件入口核验，尚未启用该新栏目；不能把公示、预算分配或已截止通知当作开放申报。JMA仍未启用，尚须验证载荷、订正/撤销和使用限制。

### 单 Moa 无付费归档 worker

原 worker 默认 `WORKER_PROFILE=full` 不变。明确选择模块声明的 `WORKER_PROFILE=fishery-archive` 时，入口在任何核心内容、翻译、事件、报告、通知、恢复和模块付费消费者之前分流；要求 `MODEL_CALLS_ENABLED=false`、`COLLECT_ENABLED=false`。该模式只注册 `fishery.archive.moa.tick` 与 `fishery.archive.moa`，使用原 pg-boss；启动前读取全部既有 schedules，遇其他名称保留原表并拒绝启动，不调用会清理其他 cron 的原 `registerSchedules`。全局 supervise 关闭，仅监督这两个非付费队列以释放过期 active tick，均 retryLimit=0。

操作员在原私有数据库/目录下显式设置（脚本不加载额外凭据）：

```bash
node modules/fishery/scripts/moa-archive.ts --enable --mode validation --run-id <unique-run-id> --interval-seconds 60
WORKER_PROFILE=fishery-archive MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node apps/worker/src/main.ts
node modules/fishery/scripts/moa-archive.ts --status
# 两轮完成后切正常间隔；旧短周期任务绑定旧 revision，不能继续GET。
node modules/fishery/scripts/moa-archive.ts --enable --mode hourly --run-id <new-unique-run-id>
node modules/fishery/scripts/moa-archive.ts --disable --mode hourly --run-id <current-run-id>
```

只有既有、`external/enabled=false` 的 `fishery-column-moa` 可运行；独立授权存原 settings 的 `fishery.archive.moa`，不启用核心信源采集。每分钟仅做一次 pg-boss 轻量 due tick，正常实际请求从上一轮完成后至少间隔3600秒，不会因小时 cron 边界秒差跳成两小时。每轮固定1个列表页、最多5篇正文（另有robots检查），pending 与分页/cycle游标复用原实现；未知分页不宣称全站遍历。失败尊重核心退避，连续3次失败暂停。状态直接复用原来源健康、job_runs 和既有管理员批次接口 `archiveStatus`，不新增运维页面。

短周期验证在 GET 前持久化同 runId 的最多2次 claim；重复相同配置返回同 revision/claim，历史 validation runId 不可重新授予预算。进程重启、重复投递与切回 hourly 都不能绕过上限。状态切换由正在运行的专用 worker 在下一次心跳更新它自己的 schedule data；旧 revision 作业一律无请求跳过。hourly 切换的 nextAt 不早于最近获取后1小时，不立即产生第三轮请求。

所有 DB `collectColumnRound`（包括原 CLI）与官方批次导入共用每源 PostgreSQL advisory 租约，使用专属 retained session；事务在该 session 内显式 BEGIN/COMMIT 并在写前/提交前核对 PID 与锁，权威游标、fetch_runs、素材观察提交不借共享池。连接丢失永久取消旧 owner、abort 在途HTTP；等待后、GET前后、归档和journal rename前均检查租约。新 owner 遇未决原轮次停止，不能自动偷锁或恢复未知请求；无关的付费流程租约/回执从不触碰。

正常完成的每个归档批次在同来源租约内调用既有 `importBatch`，只登记素材文书/观察和获取证据，默认待审；不建 core 待分析文章，不排 analyze/translate/report/paid flow，不审核、不发布。导入中断保留 current=importing，可显式对账复用相同原件与版本身份。停用保留 current/claim/证据且使旧作业失效；需继续原未决身份时先用相同 runId 重启原预算，再 `--resume --acknowledge-stopped --reason '<已证实原执行者停止的依据>'`。原 journal 存在就只按原身份 resume；不存在时仅在无 fetch_run 意图、无 child 归档且目录无证据的情况下，记录审计后从同一已授权 roundId 开始。未知意图/归档不能换新ID掩盖。running child 原件保持不变并明确保留，父轮以失败结束、不导入 running batch；对账同时准确结束该 roundId 的未结 job_runs。
