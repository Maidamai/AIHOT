# 手动官方栏目采集与 AI 准备

范围仅农业农村部渔业渔政管理局「工作动态」和福建省海洋与渔业局「省局动态」。前者旧「远洋渔业」专栏更新慢，后者需保留完整正文容器；样本链接只用于核对解析，不作为抓取列表。当前页之外的历史分页尚未采集。

在具有正常公网 DNS 的受控环境手动运行（Node ≥24.11，已安装本仓库依赖）：

```sh
node modules/fishery/scripts/collect-columns.ts --id manual-YYYYMMDD-HHMM --data-dir /private/data --columns moa,fujian --limit 2
```

每源最多检查12篇候选、最多收2条合格候选；参数上限5条。请求间隔1.2秒，单次20秒、正文6MiB、批次180秒预算，同源跳转且经过现有 SSRF 防护。当前两个 robots.txt 为404；如出现规则文件、拒绝或服务错误，停止该源等待人工检查。404不赋予内容转载许可。目录排他创建，失败后用新批次ID，不覆盖旧证据。未引入 worker、cron、COLLECT_ENABLED 修改或付费调用。

原始响应、HTTP收据、纯文本和 manifest 分开保存在 `<data-dir>/fishery-batches/<id>`。网络失败没有伪造 HTTP 状态，失败原因留在 manifest；404/空正文/非法编码/哈希不符不可当作已解析素材。优先使用正文 PubDate，不从链接或列表日期推断发布日期；事件、生效日期及地域默认未知。关键词仅是候选线索，单独“履约”、养殖、近海及泛海洋新闻不构成远洋证据。

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

行业登录预览位于 `/fishery` 与 `/fishery/:documentId`，后台导航有“行业阅读预览”入口。Web只经adminGet转发正常访问者Cookie读取上述管理员API，不读取Cookie值、不自建会话、不扩大既有登录return白名单。未登录照既有登录流程回后台，再从预览入口进入。没有修改站点根URL、正式品牌或条款。

共享Web仅新增可选root.shell插口（modules.ts/root.tsx）；管理员chrome优先，匹配/fishery边界的正常页与错误页均使用模块导航，不显示旧AI分类、搜索、TabBar或“回到精选”。普通站点保持原导航与RSS链接。预览HTML、.data和错误响应均private/no-store/noindex，未知子路径也在同一正常鉴权边界内。历史日期及发布日期未知按原值展示，不把采集或核查时间改称新闻日期。

UI浏览器验收使用显式合成API，不能当真实流水线验收。生产构建后可单独执行 `node --test --test-timeout=120000 modules/fishery/web/tests/reader.browser.ts`（配置已安装的PLAYWRIGHT_BROWSERS_PATH，不下载）。覆盖HTML/.data/404/503私有响应、正常登录重定向、默认站导航/RSS保持，以及320/393/1024列表、引证详情、错误与空态截图。测试不加入默认后端DB测试的浏览器依赖。
