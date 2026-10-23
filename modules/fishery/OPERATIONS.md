# 资讯采集、审核与政策证据操作

## 最新资讯主链路（2026-10-23）

MARA、福建省局动态、福建通知公告及日本水产厅新闻发布使用最新列表发现全部文章身份，不按标题或正文关键词提前淘汰。完整正文和必需附件核验后，通过 `upsertMaterial` 进入原站 articles 的 URL 去重、修订和时序规则；fishery 文书/观察仅保存可审核证据。正文关键词只是管理员线索，相关性仍须原版宽召回预筛。源页面、正文或必需附件变更使旧审核失效；HTTP失败不推断撤回。

新闻发现每轮回最新列表，不沿 index_N 翻进旧档案。新 URL 只在列表最近30天的有界发现范围内选择，缺日期时最多检查30个列表身份；列表日期不充当文章发布日期。每源5篇中给已有 URL 的正文修订检查单独预留额度，旧待采队列和翻页位置保存在 history 暂停，不占最新额度。原文日期缺失或在首次发现时旧于48小时的新闻候选仍显示历史，不补作首页新消息。48小时只决定新闻时序，不是法规失效期，也不再一概禁止有业务依据的历史材料进入审核。NPFC仍按当前措施目录的新增、修订和状态证据核验，保留既有每6小时、每轮1份上限；不按文件年份否定有效性。IOTC继续停用。

所有新新闻候选任务强制复用原版预筛和双评分，随后证据生成、隔离核查、最终人工审定。保留当前素材审核门禁；采集入库不等于审核、发布或可展示。实际启用范围由既有 fishery.flow.dispatch 和各来源归档设置决定；部署新适配器不会自动启用来源。管理员信源页分别显示已收录、已适配、已启用、当前配置正常周期已验证，并读取真实频率与下次计划。旧任务、回执和合格内容不自动重评分。新的规则不能借新identity覆盖旧任务，冲突须明确对账。

终审后发布复用同一个核心article身份，正文不对读者公开；通过原 `publication/` 读取层统一输出。首页候补仅取非历史的已审资讯，没有合格新消息显示空状态；全部资料页仍能阅读获准历史内容。分类/标签在发布时投影，专题是下游入口。已接入的受控处理器只消费当前已审结构化事实，复用原站事件归组、精选与成刊；无合格输入时不成刊、不收费。外部推送没有开启。

## 有界业务审核与日本水产厅接入

历史政策、开放申报和法规修订可以在现有素材详情提名业务审核。必须先通过当前版本素材审核，引用当前完整归档中的连续原文，填写业务理由和最长30天的处理期；处理期不是政策有效期。全站最多20个有效提名，绑定观察版本、来源版本、正文哈希和素材审核记录；撤审、改文、到期或撤销立即失效。提名不改变真实日期、backfill、评分门槛或发布权限，仍走既有预筛、双评分、事实抽取、核查与最终决定。既有回执继续幂等复用，没有重复扣费或全旧库批量评分。

日本水产厅入口固定为 `https://www.jfa.maff.go.jp/j/press/`，同一受控控制器每小时最多5篇；正常调度要显式启用。正文公布日按日本日历读取，只有日期时内部排序用日本时区日初，公开精度仍为日，不伪造发布时间。官方页面和最多6件必需 PDF 分别归档并逐页核验；超过6件保存完整附件清单及指纹，标附件待人工核验，明确附件全文未取得，不进入模型或发布，也不作为网络故障让整个来源连续失败。其它缺件、真实下载或解析失败仍阻断。robots 当前官方不可用响应按已核验字节指纹限定，变化即停止；不把该响应视作转载许可。摘要/译文用途须另核对官方使用条款，第三方内容单独处理，全文输出保持关闭。

## 选材阶段与费用恢复

复用原 `runSelectionPrefilter/runSelectionScores` 并注入受控调用器，不执行整套 `processArticle`。顺序为 prefilter、score-1、score-2、generation、review、最终审定。每个评分有独立 subject、attemptTag 和 stage_requests；返回后逐步事务保存结果、completeReceipt 与下一阶段，评分二与 outcome 原子落库。恢复只复用已收或已完成回执；pending/unknown 保留费用预留并阻断，failed 不自动重发，明确 regenerate 仅增加目标阶段尝试，最多三次。

预筛 BLOCK/UNKNOWN、无评分门槛、内容拒绝和部分评分分别记录，不能作为 PASS。双评分低于现有门槛时停止生成并保留待核状态；门槛仍未经渔业标注校准，不修改原 selected/qualified，不替代素材审批、逐字段事实证据核查或最终决定。历史和未知发布日期仍按原时效投影显示，收录时间不当作发布日期。

完整正文超过60000字符或最终请求体超过96000字节即停止，不截断后声称全文。传输层只接受512、1024、2048三档输出，仍固定官方模型/地址、禁用思考及工具。新完整任务按最多五次、每次0.40元最坏预留检查同一累计10元账本；可信usage结算后可释放差额，未知结果不释放。后续每次请求前重核来源、正文版本、来源分级和素材审批，已有队列retryLimit仍为0。

新增迁移0100–0103只增加可空selection状态并扩展阶段约束，不回填旧任务。回滚前停止或审计隔离新版任务，不能让旧消费者接手未知阶段；不删任务、回执或累计账本。

## 业务指南单次隔离核查

若任务严格因发送前框架 `Budget for llm exhausted (day)` 失败，须先停止旧executor并核对没有该请求的任何receipt/attempt及累计账本未决费用。可单独执行 `node modules/fishery/scripts/review-business-guides.ts --resume-unsent --id <guide-id> --actor <operator> --reason <stop-and-reconciliation-reason>`。此模式只接受一个指南，模型开关可关闭；它在全局processing lease下锁原failed任务，校验原绑定和完整请求意图、无receipt/result、精确day预算错误及原累计金额容量，审计旧error、操作者理由和未发送证据后，只把原id改为queued。不会增加预留、修改账本、换identity、调用模型或自动审批。随后仍须另行显式 `--execute` 才可能发出首次请求。任何receipt（包括failed/unknown/received）、其他错误或绑定变化均拒绝；无receipt也不能借 `--resume-cache` 重发。

`node modules/fishery/scripts/review-business-guides.ts --id <guide-id>` 默认只读取完整归档、校验当前指南绑定并打印请求/输出包络及原累计预算，不创建任务、不调用模型。可重复 `--id`，每批必须明确给出1至8个唯一指南ID；8项只是单批安全边界，不是累计调用授权上限。旧4份指南各需至少1次核查，新6份候选各需至少1次；预检通过不代表AI或人工批准。

真实处理由操作者先停止既有手动consumer，核对未决任务、回执及同一累计账本，再仅为此oneshot进程启用既有模型配置和凭据：`node modules/fishery/scripts/review-business-guides.ts --execute --id <guide-id> --actor <operator>`。所有指定指南先完整预检，之后在既有全局processing lease内串行创建/复用任务并核查；不启动第二consumer、pg-boss调度或常驻API模型开关。SIGTERM/SIGINT或失锁后等待在途落账，不处理下一指南，不自动重试。最终人工批准仍须正常后台操作。

旧20次授权账本须独立执行明确升级：`node modules/fishery/scripts/review-business-guides.ts --upgrade-budget --actor <operator> --reason <audit-reason>`；该操作模型开关可以关闭，只保留原历史entry并升级为累计10元金额限制，不重置、不复制、不退款，也不与execute联动。旧账本若有pending/unknown/refused先核账，CLI拒绝升级。预算升级后另跑只读预检，再显式选择是否执行；部署回退不得回滚累计费用账本。

普通execute不会重试failed/running任务。已对账且确有received/completed原始响应时，单独用 `--resume-cache --id <guide-id> --actor <operator>` 在同一租约内仅恢复缓存；预检必须显示requiredCalls=0，不能借恢复产生新计费。输出只有安全绑定、审核状态、回执和预算指标，不输出完整正文、凭据或内部审核备注。API页面读取和本CLI默认预检均为零模型调用。

## 手动栏目采集

范围仅农业农村部渔业渔政管理局「工作动态」和福建省海洋与渔业局「省局动态」。前者旧「远洋渔业」专栏更新慢，后者需保留完整正文容器；样本链接只用于核对解析，不作为抓取列表。当前页之外的历史分页尚未采集。

在具有正常公网 DNS 的受控环境手动运行（Node ≥24.11，已安装本仓库依赖）：

```sh
node modules/fishery/scripts/collect-columns.ts --id manual-YYYYMMDD-HHMM --data-dir /private/data --columns moa,fujian --limit 2
```

每源最多检查12篇候选、最多收2条合格候选；参数上限5条。请求间隔1.2秒，单次20秒、正文6MiB、批次180秒预算，同源跳转且经过现有 SSRF 防护。当前两个 robots.txt 为404；如出现规则文件、拒绝或服务错误，停止该源等待人工检查。404不赋予内容转载许可。目录排他创建，失败后用新批次ID，不覆盖旧证据。未引入 worker、cron、COLLECT_ENABLED 修改或付费调用。

原始响应、HTTP收据、纯文本和 manifest 分开保存在 `<data-dir>/fishery-batches/<id>`。网络失败没有伪造 HTTP 状态，失败原因留在 manifest；404/空正文/非法编码/哈希不符不可当作已解析素材。优先使用正文 PubDate，不从链接或列表日期推断发布日期；事件、生效日期及地域默认未知。关键词仅是候选线索，单独“履约”、养殖、近海及泛海洋新闻不构成远洋证据。

manifest在同一批次目录的唯一临时文件完整写入后原子替换；写入失败不会截断上一次完整记录，操作仍失败或保留running状态。批次列表逐项隔离缺失、截断或非法manifest，显示unreadable及原因，不计算成功/请求数量且不可导入；其他正常批次仍可读取。不会删除旧批次、修改坏证据或清理其他操作创建的临时文件，恢复时保留原目录并用新批次ID重新运行。

API 与采集脚本须使用同一私有 data-dir。管理员在 `/admin/fishery/collect` 查看批次并通过正常会话/CSRF 导入；匿名无权读取。导入先重算原始字节/正文哈希，再写审计记录。新来源关闭自动采集、全文和所有使用许可，材料默认待审。相同最新证据仅更新时间不追加版本；正文、原件、解析器或结构变化追加观察，旧审核失效，A→B→A仍记录新版本。撤回材料不自动恢复。部分导入失败后可重试，已成功的相同证据不重复入库。失败/不相关项保留在批次页，不冒充待审正文。

素材列表全量搜索/筛选后每页25条。当前实现为后端加载所有素材元数据再分页，适合小批试点；大规模积累前需改成数据库分页/统计。来源面板明确仅显示本页记录，批次页才是每轮发现/请求/失败的记录。未把18示范源、研究目录或测试副本计作真实采集器。

## AI 状态与后续接线

`backend/ai-draft.ts` 提供版本绑定请求、严格结构和连续原文引句/段落/PDF页码校验，现已接入下面的显式持久任务及正常管理员界面。打开页面不触发模型；所有真实请求经chatJson/receipts和固定累计费用账本。引句存在不等于语义支持，仍须隔离第二遍证据核查及人工事实决定。内部合格不替换原文观察、来源权利或素材人工审核，不产生公开发布。

## DeepSeek 试跑历史与核验范围

`scripts/trial-deepseek.ts` 仍只允许固定独立试验库，不启动应用、worker或恢复任务。生产单任务处理另见下文run-flow.ts；迁移必须保留原累计账本并冻结原试验入口，不能同时使用两份额度。凭据只由部署配置注入，不经聊天、仓库或日志，不读取或打印密钥。

2026-10-20曾核验 `deepseek-flash` 对应 DeepSeek-V4.1-Flash-1017，地址 `https://api.deepseek.com`；别名可能滚动，不声称永久固定。每次响应的原始model值由最终transport写入ledger.responseModel（缺失则null），与配置别名、历史verifiedAt分别保存。定价与参数参考既有[价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)及[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)核验记录；usage按高峰未缓存价估算，不把估算当供应商账单。输入token上界是工程预留，不是供应商tokenizer证明或账户硬限额。

初期4次/1.60元、更早12000bytes wire限制已经由下文新授权及96k包络限制替代；历史每条预留金额仍保留。最初3次中两条因数组/不完整日期结构失败，一条仅结构与锚点通过。该唯一结构合格稿的issuer把政策《通知》联合发文单位误当网页发布机构，整条事实不能视作质量正例。后续BBNJ生成4及核查5也保留原响应；5暴露了核查路径/任务契约问题，4还有治理范围误作实际作业海域及不完整句锚，均不被伪称质量正例。

严格数组与日期组成规则不作运行时容错；原始坏响应不修改，fixture只保存连续公开引文、原段/偏移和完整原件hash，不复制完整私有归档、凭据或内部审核信息。测试中的显式反事实修正版只隔离验证契约，不是实际模型成功。当前费用、次数和received/pending/unknown以同一固定账本报告为准，不在文档重置。

## 显式 AI 质量试验（累计授权 deepseek-fishery-20261020）

本轮上限为累计20次（包括原3次），每次在最终fetch前持久预留0.40元，保守总预留最多8元，小于累计10元授权。历史每条预留金额逐条求和，更新授权不清空、不退回、不重新定价；pending/refused/unknown阻断后续请求。生产和试验必须使用同一授权账本，禁止另建第二套额度。此CLI仍只允许既有隔离trial库；主库集成不得复制出一份独立额度。

已有账本由操作者显式执行 `trial-deepseek.ts --upgrade-authorization` 更新原键的上限，零模型请求。新一轮必须指定 `--capture-dir <已有公开采集目录> --batch-id <批次> --archive-id <目标归档ID> --attempt <显式生成尝试ID> --stage generation|review|both`。多个目标可重复archive-id。不会默认重跑整批。

生成成功后可用同attempt及 `--stage review` 复用生成。审核失败后，只在已核对旧回执/扣费状态后，显式增加 `--review-attempt <新审核尝试ID>`，复用生成只重试审核；已有失败生成必须明确给新attempt。已有回执不会自动重试，成功stage持久复用。两阶段分别使用fishery_draft与fishery_quality_review目的和回执，任一真实请求都经过同一最终wire校验与预留。本文不是运行授权扩张，不启动worker/recovery/fallback。

生成v3把机构事实放在organizations的page_publisher/policy_issuer/event_participant中；旧混合issuer拒绝。网页发布机构须有原文显式发布标签，不能由政策《通知》署名替代。每条引用连续匹配原段/PDF页；数值单位必须原样出现，不能自动换算，日期必须同引句有完整组成。独立审核只收到公开正文及生成候选，不收到人审备注、用户信息或生成者自评。必须逐字段覆盖，任何unknown/contradiction/缺字段都退待补证；supported仅进入needs_human_review，始终approved=false/published=false。独立调用不代表独立信源确认或法律适用性审核。长文不能在wire上限下静默截断成全文；超限拒绝，保留原件供人工处理。

## 持久后台链和单任务处理（内部）

新增0095迁移只有一条建表语句，保存任务、证据快照、分阶段尝试和回执引用。现有采集脚本先执行受控发现/归档；`POST /api/admin/fishery/batches/:id/flows {identity}` 重新校验并导入归档，然后幂等创建每文书任务，不发送模型请求。普通文书可用 `POST documents/:id/flows {identity}`。所有接口仍需正常管理员会话及写操作CSRF；没有匿名或公开投影。

`GET documents/:id/flows`、`GET flows/:id` 查看阶段、失败原因、回执、快照hash和失效原因；`POST flows/:id/run` 仅排既有pg-boss的fishery.flow队列（自动重试0）。`POST flows/:id/retry` 支持恢复同次回执及显式新计费尝试（参数见文末），保留成功生成；unknown或在途费用仍阻断发送。进程中断留下running，系统不会自动抢占/重发；人工对账后仅存在可复用received/completed回执才可显式恢复。

生产默认不启用模型总开关。验收建议直接用单任务CLI，不启动常驻worker，也不启动任何调度：

```bash
# 使用既有部署注入的key/env；不在命令行写key，不加载未知env文件。
# 数据库必须已有从隔离试验原样转移的唯一活跃累计授权账本，不能initialize新额度。
MODEL_CALLS_ENABLED=true node modules/fishery/scripts/run-flow.ts --id <queued-task-id> --run-once
```

只处理这一个任务，启动前检查生成+审核至少两次容量（已有生成则一次）；最终每个fetch仍原子持久预留。源、观察、权利版本和正文哈希每阶段前后核对，超长正文/请求超wire上限直接失败，不截断冒充全文。已有IOTC私有PDF正文可进入同链，按归档Page标记绑定所有页且核对attachmentPages；缺页拒绝。没有为现有未知来源创建新的抓取权限或付费服务。

`POST flows/:id/decision {decision:qualified|rejected,snapshotHash,note}` 只能在确定性门禁+隔离第二遍证据核查通过后操作。qualified仅内部受控预览，保留审核者和快照；不写公开文章、不放宽原许可，不等于法律适用性通过。每次读取再次核对当前版本及实际归档正文，来源/观察/权利变化或撤回立即关闭内部预览，保留历史追溯。可再次rejected撤销内部qualified。

当前局限：采集发现仍使用既有显式脚本、批次manifest；任务表从已核验归档/观察开始，不伪称持久化发现调度。eventStatus和validityStatus的当前约束见下方v4说明，effective日期不能解释为已核实有效；同模型第二遍不是独立信源确认。没有长文分块/上下文合并；超限退人工。国际列表新规发现扩展、完整真实当前稿件质量及服务器验收仍由后续阶段验证。

## 生成v4 / 证据核查v2与恢复语义修订

核查输入显式给出非空事实claims及稳定id（如summaryZh.0），动态schema仅接受这些id，每claim恰好一条核查，缺项、重复或额外路径均拒绝。unknown日期/状态、空机构等不是断言，不要求补证；真正请求的每条断言仍必须supported且有引用，not_found/ambiguous/contradicted任一都阻断。保留真实receipt5原始响应作契约错误反例，不静默修路径或删去不利核查。

生成增加eventStatus（planned / reported_occurred / unknown）与只允许unknown的validityStatus。日期过去不改变planned，文载施行日不证明独立核实现行有效。locations.policy_scope记录政策/治理范围；fishing_area必须有实际捕捞作业事实，不能把公海治理议题填为船队作业海域。符号、千分位、完整领域单位逐token核对，未知单位不剥离成裸数；这不是语义真假证明，仍需隔离核查和人工决定。

0096单语句迁移为每stage/attempt保存请求指纹；实际付费幂等由attemptTag区分（仅改变subject不能创建新调用）。`POST flows/:id/retry {note,mode:"resume"}` 默认保留attempt/tag，恢复已received/completed产物的业务落盘，不新增请求。若旧回执failed/pending/unknown则禁止盲恢复；pending/unknown也禁止新尝试，须先对账。中断running仅已有可复用received/completed回执才可恢复。成功响应持久化失败只允许resume，不允许付费重生成；代码/提示词/输入指纹变化会阻断同attempt恢复。

确认旧输出不可用并已对账后，`{note,mode:"regenerate",acknowledgeNewCharge:true}` 才增加attempt与attemptTag，明确可能新增计费；每stage仍最多3个显式付费尝试。恢复已有回执不占新调用容量；启动新生成仍需生成+核查两次容量。CLI试验attempt/review-attempt也已写入实际attemptTag。

人工qualified保持所有当前快照、确定性与AI核查门禁；rejected可以拒绝待补证/失败或已失效旧任务，保存原任务快照、理由和审核人，不要求坏稿先通过AI。running须先结束或对账，避免覆盖在途状态。此拒绝不修改来源或原素材审核记录。


最终wire现为96,000 UTF8bytes，仍限定官方固定端点、POST、两条纯文本消息、禁思考/工具/stream、最多2048输出tokens。每次0.40元、累计20次/10元上限不变；这只是保守工程token预留，不是供应商账户硬扣费限制。新生成前预估生成请求与最大核查请求包络；候选JSON转为消息字符串后的wire贡献上限8192bytes，核查预留两倍包络及4096bytes claims包装空间。任一完整输入预计超96k时整任务零调用退人工，不截断原文。最终真实fetch仍按实际完整请求再检查上限。


同一文书、证据快照与当前生成/核查prompt+固定模型配置只复用一份任务；即使再次输入不同identity，也不新建同证据任务或再次收费。首次stage的attemptTag绑定证据/配置快照、stage和付费尝试编号，不含随机task id。只有明确regenerate增加编号。prompt配置版本也参与快照，配置变更后旧产物不能冒充新版本验收。

每文书仅最新created任务为权威任务。旧任务保留追溯；最新任务queued/pending/rejected时，不会回读旧qualified文章。内部预览、重跑及再批准均检查这一点；rejected仍可终结历史坏稿。

IOTC26/03完整6页正文（约19.6KiB，页面结构作为正文+页锚发送）在48k请求限制下被零调用预检挡住，因此将wire上限定向提高至96,000bytes。仍发送完整原文、不截断、不放松事实门禁；最多100,000输入tokens工程上界、2048输出tokens、每次0.40元预留与累计20次/10元授权均保持。使用已核验高峰价格估算每次最多约0.216384元，但这不是供应商扣费硬限或账单证明。

## 管理员手动队列处理进程

后台的 `POST flows/:id/run` 只排队。要让该按钮实际执行，使用专用入口 `node modules/fishery/scripts/consume-flows.ts`；只订阅 `fishery.flow`，每批1项、并发1项，并用保留的数据库session advisory锁拒绝第二实例。它不启动 `apps/worker`，不注册采集/通知/成刊/维护调度，不运行业务恢复扫描或回执释放重试。pg-boss自身的schedule和supervise也关闭，因此库中既有cron不会由这个进程触发；进程中断和过期任务仍须显式对账，不宣称自动恢复。

`deploy/manual-processing.yaml` 是叠加既有私有生产Compose的示例：明确指定既有镜像 `FISHERY_PROCESSOR_IMAGE`、同一生产数据库 `FISHERY_PROCESSOR_DATABASE_URL`、既有 `SITE_URL` 和私有env_file路径 `FISHERY_PRIVATE_ENV_FILE`，沿用data volume和网络；私有LLM env_file本身不承担DB配置。环境显式为production，credentials目录为不含秘密的不存在路径，仅使用既有env_file。env_file采用format:raw保留密钥字面值（Compose须支持raw格式），不读取/打印值，不生成新密钥，不初始化或复制授权账本。此片段仅打开processor的MODEL_CALLS_ENABLED，API继续关闭；无公网端口，采集、推送、IndexNow均关闭。部署前核对合并后的镜像、数据库、data路径及私有网络与现有服务一致，并先检查管理员已明确排入的任务；启动即可能消费这些既有手动任务，空队列启动零模型请求。

启动时先ensure唯一flow队列，再读取实际配置并要求retryLimit=0、expireInSeconds至少600秒；ensureQueue不会更新已有队列，不符合时进程拒绝启动，须操作者先核对配置。不会在启动时重置running、failed或pending/unknown回执。SIGTERM/SIGINT先停止取新任务并沿用stopBoss的470秒排空，再释放独占锁和DB；Compose留500秒stop grace。强杀后running仍保持原状，须按上文回执对账后显式恢复。

任务先原子认领，再检查模型开关、固定模型/端点授权和剩余容量。确定性阻断记录为failed，保留task id、stage、authorization phase和原因；模型/落盘失败同样以业务任务记录为准，并让对应pg-boss job失败，避免队列假成功。重复排队不能重新认领running或已完成任务，不能新增模型请求。成功生成和隔离核查只进入needs_human_review，仍需管理员决定，仍不发布。

生成产物的relevance为irrelevant/unknown或没有非空摘要时，保存草稿后直接needs_evidence并记FISHERY_ARTICLE_INELIGIBLE，跳过第二遍模型调用。人工qualified也再次检查relevant和非空摘要。此类草稿可人工拒绝，或对账后明确regenerate生成新尝试；普通resume只复用原生成回执，不能偷偷新增收费，也不永久否定来源。

## 生成v5 / 核查v3证据ID协议

原receipt6保持原响应，其eventStatus和上海会址引句截在会议名称，仍因缺锚失败；不得从摘要引证补尾、换引文或把它当成v5结果。v5只接受当前目录中的严格evidence ID数组（如`["p1s1"]`）；动态白名单拒绝对象/null、额外quote/page/offset、未知/重复ID及超过原有数组长度。程序先解析ID，再确定性展开为既有`{quote,paragraph,page}`领域结构，执行原有事实门禁与8192bytes展开上限。回执继续保留模型原始wire响应，最终产物另外保存catalog版本/hash、正文hash、观察revision、schema和prompt版本，不改写旧回执。

目录`fishery-spans-v1`绑定完整body/hash和观察revision；段号沿用非空原行。中文只按明确句末“。！？”保守分句；英文缩写、小数、编号及PDF行不按`.`粗拆，不跨段或页拼接。quote为UTF-16 offset所指的连续原文切片，保留空白与标点；超过1200字符的句段整任务零请求退人工，不截短。同段完全重复句段无法在既有quote/paragraph/page领域结构中保留唯一ID身份，也整任务退人工；跨段/跨页相同文本按各自位置保留。PDF必须有顺序完整的`--- Page N ---`标记，且逐页区间与已验证input.pages完全对应；重复内容不靠includes猜页。模型输入保留完整body一次，另给句段/段落/页的索引，不重复发送整份pages文本。

核查仍逐claim完整核对主体、限定、数值/单位、日期、角色、否定/条件及状态；supported须有非空ID子集且只能复用该claim原始绑定ID，不能从正文别处补锚。其他源ID只允许用于contradicted。空/漏/重/额外claim不通过；合法unknown不是断言。reported_occurred新增否定、取消、延期、条件和计划的保守拒绝门禁。`FISHERY_RULES_VERSION`纳入生成/核查promptVersion及任务配置指纹：schema、确定性校验规则或证据算法变化均须递增相应版本，旧qualified/回执不能按新规则静默继承。

离线合成ID案例可证明上海/召开解引用正确、年份仍unknown，不代表真实模型成功或统计质量。ID仅确保引用身份，不证明语义蕴含：复杂否定、跨句指代、机构角色和政策适用性仍依赖完整上下文核查及人工审核；保守分句会把PDF换行保留为独立证据行，因此跨行事实可能退待补证。supported仍只到needs_human_review，approved/published始终false。当前6页IOTC完整19,598bytes的零请求预检为生成约53kbytes、核查最大包络约72kbytes（规则文案更新会轻微变化），均低于96,000；100,000输入tokens、2048输出tokens、禁thinking/tools/redirect、每次0.40元及累计20次/10元不变。

内部候选及合格文章预览同时提供绑定观察版本的原文发布日期/精度、原始时刻/日期字面、原文与候选事件日期、采集时间，以及各自独立的任务建立/更新、生成结果入库和核查结果入库时间。后两者从当前任务及回执匹配的审计记录读取，缺失则未记录，不能用较晚的人审更新时间冒充。时效核对日按UTC显示：日精度才计算距今日数；年/月精度保留原精度，只有该周期最晚日期也已达到7日才标“7日及更早原文资料”。昨日仅标非当日原文；未知发布日期不以今天采集/生成为今天新闻。这个7日窗口仅是可见资料年龄说明，不改变权利、事实或法律适用性门禁。

v5.2规则将reported_occurred的否定范围跨过“正式/如期/按期”等修饰语，保守拦截并未正式召开、未如期召开、未能按期完成、尚未正式举行、never took place及not actually held等。混合同句事件、否定、推迟或条件也可退unknown；该门禁不是完备NLP。规则版本变化参与任务/回执配置指纹，receipt7/8只作为v5.1历史结果保留，不代表v5.2质量验收。trial CLI已存generation和review均核对当前promptVersion、schemaVersion及catalog/body/revision绑定；任何版本不符保留原尝试并阻断，不改旧记录、不自动新发请求。

### 主记录的来源归属字段

`fishery_documents.issuer` 保留既有文本及写入兼容，仅表示来源归属，不能用作网页发布机构或政策发文机关。主记录 API 同时返回 `sourceAttribution` 和 `legacyIssuerMeaning: "source_attribution_only"`，详情页以“来源归属”显示。固定栏目配置的机构仅填入该归属字段，不据此核验任何发布或发文角色。

素材 JSON 导出 `fishery-material/0.3` 在 `source` 中保留旧 `issuer`，并附上相同的明确归属字段与兼容语义。`source.pagePublisher: null`、`policy.issuers: null` 表示主记录未核验；正文提及机关、网页来源、栏目所属机构均不自动赋值。Markdown 分别标明刊载来源、来源归属及未知的发布/发文机关。AI 草稿中带证据的机构角色仍在草稿里单独审核，不自动回填主记录。

此变更不迁移或删除既有机构文本，不更改来源许可、审核或导出资格。

## 登录行业阅读投影

`GET /api/admin/fishery/reader`（可选category/page）及`/:documentId`复用正常管理员只读鉴权，无需GET伪加CSRF。唯一eligibleReaderItems集合同时决定列表、详情与非零分类计数：真实非测试、文书未撤回、最新权威任务、当前正文/观察/权利及prompt快照有效、关联article仍available、relevant且非空摘要、隔离核查及人工内部qualified。最新pending/rejected不会回退旧qualified。

DTO仅有经当前人工快照绑定的原观察标题、短摘要/原文短引、来源安全链接、原始日期精度、原文年龄与核对标签。没有完整私有正文、审核note/actor、prompt/receipt/key/cost。版权unknown仍可内部阅读，不放宽公开或全文导出；所有读取不生成任务或模型调用。分类是对实际可读资料的规则分组，只返回非零类，不显示不存在的来源/文章统计。合成DB门禁测试不算真实业务稿件验收。

阅读统一使用主站 `/all`、`/topics`、`/items/:articleId`。旧 `/fishery` 与专题入口完成正常鉴权后跳转；旧文章和指南链接须先由 `reader-target` 解析当前可读投影，撤审、失效或不存在时保留404，故障不伪装为空列表。旧独立阅读壳与样式已删除；主站和后台鉴权边界、部署的私有预览设置不变。上述旧管理员reader API仅保留证据投影与诊断用途，不再构成第二套读者内容集合。

UI浏览器验收使用显式合成API，不能当真实流水线验收。生产构建后可单独执行相关名称的 `modules/fishery/web/tests/reader.browser.ts`；不运行全量套件，不下载浏览器。覆盖旧入口鉴权、主站映射及失败响应，并保留后台审核行为测试。

v5.3使用`fishery-spans-v2`可读目录：每个ID紧邻完整quote，body仍保留完整上下文；只改变呈现，不改分段、页区间、连续字面匹配和claim原ID子集约束。PDF每句摘要可选最多4条证据，与既有schema一致；可行性、安全、例外等限定须完整支持，4条仍不足则换可完整支持的事实或退人工。机构value使用所引原文的精确字面。累计entry9/生产receipt1的原始错ID响应固定为失败fixture：标题不是机构、定义不是禁捕/释放义务，原响应始终拒绝，不补换ID。完整6页19,598bytes的实际离线预检生成约75.7k、最大核查包络94,233bytes，低于96,000但余量有限；任何后续文案变化都须重测，超限零调用退人工，不提高上限。旧v1/v5.2目录与产物仅保留追溯，不能作为当前版本结果复用；合成案例只验证绑定/阻断，不是模型语义质量证明。

阅读状态只声称“摘要已完成内部核对”；原观察标题明确标记“来源标题”，关键词分类仅用于资料整理，不将标题或分类暗示为AI已核验断言。当前观察/来源版本的最新素材审核若为rejected，flow内部预览与统一reader集合均关闭，人工qualified也被同一否决拦截；不要求素材先approved。历史观察的审核不代替当前版本，不新增表或拒绝恢复机制。失败/缺草稿/缺核查任务的内部合格按钮与后端门禁同步禁用。

v5.4仅对完整且有效的日历日（如`1 January 2028`与`2028年1月1日`）按同一精度匹配，必须在同一所选原锚里有完整日期；不跨锚拼年份，不把`20281`猜成2028。仅匹配日期的准确字符区间免除原数字token比较，其他正负值、数量和单位保持严格。服务器人工修订模式可每claim绑定最多12个原ID，生成模式仍明确最多4个；调用者只能按服务端provenance选择模式，客户端不得扩容。canonical、wire、第二遍原ID子集与8192bytes转义候选上限同步校验；人工模式不是自动批准，完整请求仍须低于96k。

### 人工修订候选（管理员内部）

失败/待补证任务详情可载入当前证据目录和原回执候选，保存为独立 `human_revision` 任务。GET/POST `/api/admin/fishery/flows/:id/revision` 均使用现有管理员授权，写请求仍需正常 CSRF。保存仅严格校验当前 ID wire、规范字段、日期/数值/机构角色、原文锚、快照及完整核查请求 96,000 UTF-8 字节上限，不发送模型请求、不入队；原任务与回执不变。新观察使用空模板，禁止自动迁移旧 ID。保存相同快照/规范候选 hash 会复用已有修订任务。

新任务仅允许 review 阶段；管理员须另外点“仅排队核查修订候选”才排队，核查失败不自动重试。付费核查 identity 绑定候选 hash，审核结果及人工内部合格也核对该 hash。模型提示只包含公开完整原文与候选，不包含修订者、原因、差异或内部审核记录。审计保存原任务/生成回执/原响应 hash、修订原因/人员/时间、前后候选及新 hash。人工合格仍受当前素材拒绝、撤回、来源版本及 reader 唯一当前任务门禁约束；未授予版权或公开权限。

人工修订核查后的失败/待补证/人工拒绝可再次修订：服务端沿已保存 provenance 验证原生成任务及其生成回执，另记直接父任务，差异以前一候选为起点。running 或 pending/unknown 回执必须先对账，不能借修订绕过。人工模式由服务端 origin 决定，每 claim 最多12个当前原始ID，生成模式仍最多4；8192转义候选字节/96000最终wire字节限制保持。

Linux PDF解析器`Poppler <info>/<text>/<html>; footnotes/v2`同时读取同一私有原件快照的布局文本与pdftohtml XML。只有较小字体、较高基线、水平紧邻的数字run和同页唯一页底脚注都能定位时才转换为`[n]`，普通整数字符串（包括20281）不猜拆。保留所有原布局空白、正文、脚注及其续行，仅给有结构证据的引用数字加方括号；缺失或歧义映射整次解析失败，不局部猜修。`PdfText.textEvidence`经adapter进入严格的`sourceCapture.pdfTextEvidence`，因此新manifest和观察JSON实际保存布局/结构/新正文SHA、字体/几何、完整脚注和转换前后offset映射。旧raw、body、receipt和观察不覆盖，须新归档/新正文SHA/新观察审核。

当前IOTC完整结构证明两处数字上标，含2028后的脚注1及安全附件的脚注2。六页新正文SHA为`895f837dcf65fb9bea811968430a5052a474ec06819e624a798cf920dc54bef8`，印度尼西亚paragraph 9的2030日期及设备paragraph 10例外全文保留。完整六句准备稿仅在新正文人工模式离线通过：候选转义8004bytes、实际核查请求88827bytes；仍非模型成功或人工批准。8192上限只余188bytes，任何编辑须重测。旧entry10/生产receipt2保留原错海域与未完整限定的响应，旧20281正文不能授权2028的日期翻译。

v5.5对reported_occurred补充保守的转述纠正、否认和歧义门禁：声称/据称、未经证实、并非如此、否认、是否或疑问句等即使含“召开/举行/took place”也不能确定为发生，保留unknown供完整上下文与人工核对。该词句范围门禁不宣称完备NLP；明确原文正向报道仍可通过。规则版本纳入生成/核查和配置指纹，旧规则产物保留追溯，不静默继承当前版本。


## 手动执行租约、心跳与中断核账

专用consumer、单任务run-flow和人工reconcile共用同一个全局session advisory lease。进程保留独占连接及backend PID，并持续核对实际持锁；断连、重连、PID变化或锁消失后，旧实例永久失效，不自动重新取锁继续。心跳日志仅记录实例ID、进程/PID、当前任务ID与状态/阶段、pending/unknown/refused数量，不记录密钥、完整正文或私密审核备注。无租约guard的生产授权调用直接拒绝。

每次请求在锁定原累计账本后、写入预留前核验租约，并在实际发送前再次核验。预留已提交但发送前失锁时保留pending，不自动退款或重发；已经发送的请求允许接收响应并持久结算。失锁先停止取新任务，等待在途响应和handler落账后才完成release及队列关闭，不用通用shutdown abort冒充排空。强杀、失锁、缺失心跳或未决费用均须人工核对任务、队列job、回执与同一累计账本；不得以重启、修改状态或清零账本消除未知结果。部署保持restart:no，不自动故障重启或补跑。

管理员reconcile只在当前证据/执行指纹、停止确认、租约互斥及未决费用检查均通过后记录中断结果；该操作零模型调用、不自动排队。已有生成落库时必须保留原生成及回执，区分尚未发出的审核阶段。后续恢复或可能新增计费的尝试仍由管理员显式选择，并再次核验当前版本、回执与剩余额度。原任务、归档、回执、审计及累计费用历史均保留，账本不清零。


## 人工核验公开官方归档导入

另有独立的管理员入口 `GET /api/admin/fishery/manual-sources` 与带正常会话/CSRF 的 `POST /api/admin/fishery/manual-sources/:id/import`。其读取 `<data-dir>/fishery-manual-archives/<id>/manifest.json`、`receipt.json`、`raw.bin` 和 `body.txt`，不主动访问网站、调用模型、批准素材或发布。该入口仅接受代码明确核定的四个官方原件URL，不属于三个栏目采集器，不能计作自动来源接通。

manifest 使用严格版本 `manual-official-source/1`：`id,url,name,attribution,title,publishedAt,publicationLiteral,rawSha256,bodySha256,parser`，HTML另需已核定的 `bodySelector`。parser 为 `manual-official-html/v1` 或 `manual-official-pdf/v1`。日期未知用null，PDF签署日不代替网页发布日期。receipt使用现有 `requestedUrl,finalUrl,status,finishedAt,sha256` 结构；只接收HTTP200，原件字节和回执/manifest哈希均需一致。所有读取拒绝目录或文件软链接、非法ID及超限文件。

HTML以明确正文容器提取全部文字、段落和表格，不截断；图片附件不OCR、不伪合并成人工正文。PDF通过现有extractPdf重新解析，要求完整连续页码和正文，缺失工具、空白页或结构解析失败会显示不可导入。服务器重新解析的正文必须逐字节等于body.txt，不能仅信任人工提供的body/hash。回执、哈希和手动核验不是网站签名；来源归属、正文意义、日期冲突、适用性和权利仍需普通人工审核。新来源自动采集、全文及各项使用许可关闭；导入仍经过既有source/document/observation链，不自动产生文章或流程任务。


## 阅读入口、字段状态与实际调度（2026-10-23）

信源列表和详情通过模块 `sourceRuntime` 读取受控调度的启停、健康、频率、心跳、成功及下次执行时刻；启用/健康过滤和统计使用同一实际状态。MARA正常模式60分钟、NPFC360分钟。外部受控来源保留核心enabled=false，禁止另改核心频率/配置或重复排核心采集队列；普通来源原操作保留。任务详情的归组失败恢复直接使用现有editorial/retry API，绑定投影和版本，区分同次恢复与新增付费尝试；不替代普通阶段恢复和对账。

指南兼容旧documented/unknown载荷，旧unknown显示未核实且不自动迁移。可显式记录unverified、extraction_failed、not_stated、not_applicable及原因。not_applicable须有原文证据；not_stated须经完整原文对照，可在完整覆盖时无引证支持该缺载断言。二者均是新增审核claim，改变内容后原AI结果与终审失效。只对出现新断言的请求追加规则并改变prompt hash，旧载荷的规则与审核绑定不变。时效提示按船员、补贴、合规等业务类型显示，日期比较不确认现行效力或业务资格。

受控串行processor复用原hot_rankings和story_heat_hourly：有当前已审近期事件输入时每5分钟排名、每小时采样，无候选不写空期刊或调用模型。热度参与证据同样读取当前审核门禁，撤审即停止贡献；停机后下次维护按持久化时间继续。日报/周报/月报沿用原已审内容编排边界，不新增综述模型或分发。暂缺符合条件的内容时页面明确显示暂无近期热点/已发布期刊。
