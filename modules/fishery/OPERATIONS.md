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
