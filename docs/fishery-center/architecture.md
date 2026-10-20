# 远洋渔业信源中心：最小实现设计

本文件主体保留实施提案；当前已实现的有限首期与真实验收结果另见[实施记录](implementation.md)。基线：上游 `5633b648b9ca6453caec5bcf70a76785a794286f`，核验日 2026-10-20。早期研究仅做文档；用户随后授权本地改造与验证，仍不部署、不改Easel或现有AI早报调度。

## 现有能力与改造边界

继续使用 Node 24 / TypeScript、Fastify、React Router SSR、PostgreSQL、pg-boss。保留采集、文章身份、评分、归组、publication 统一出口和已有后台。行业定义写 `industry/`，站点身份和条款写 `site/`，垂类新增能力写 `modules/fishery/`。先做单站单库，暂不引入多租户、向量数据库、消息中台或独立发布系统。

公开新闻仍经 `packages/backend/src/publication/` 输出；私有证据不能通过新模块绕开全文权限、撤回和 publication 范围。模块的 `http`、`agent`、`sourceKinds`、`queues`、`schedules`、`sourceHealth` 和 `on` 已有扩展点，先复用这些接口，确有缺口才提出小范围引擎改动。[模块接口](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/modules.ts)

模块按现行约定提供`module.ts`/`server.ts`及需要的Web入口，并登记到`site/modules/index.ts`、`server.ts`、`web.ts`；还要更新`site/package.json`依赖及Dockerfile模块包清单。`sourceKinds`当前主要接管后台启用/手动抓取，不能假定它自动新增一种后台采集类型；数据库来源kind有约束，首版用现有列表发现+模块附件观察，不先新造PDF来源类型。钩子内只登记事务内变更或任务，网络/PDF/OCR/模型调用移出事务。[模块约定](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/docs/architecture.md#模块)

## 新闻线与政策线

新闻线复用预筛、两次评分、结构化、归组和精选；双评分只是同一模型的独立判断，不是两条事实证据。保留原评分结构，以渔业样本校准重要性、噪声和门槛；不得直接照搬 AI 行业的 60/65/76。[评分配置](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/industry/selection.ts)

政策线由官方信源、文号/措施编号及适用范围触发，即使低热度、单一来源、历史日期也进入档案待审。不能依赖 14 天事件召回或 48 小时热榜存活；不把所有新闻召回窗口无限放大。政策身份关联使用组织+规范编号+对象，不用相似标题自动合并。[召回](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/events/recall.ts)

还要处理采集阶段的时间准入：`sources/collect.ts`首次导入默认约12个月，后续新身份按来源初始化时间及stale窗口判断；`sources/filters.ts`在配置`publishedAfter`时会排除没有可证明日期的条目。应对政策来源另做“当前措施目录基线+持续观测”，在这些新闻准入规则之前保存获准采集的文书身份和原件，不把2020原版或旧文未来生效丢在评分之前。不能仅增加提示词或扩大事件召回窗口。[采集准入](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/sources/collect.ts#L87) · [日期过滤](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/sources/filters.ts#L34)

普通来源间隔会被自适应调度调整；政策目录/低频科研产品采用模块自己的有记录计划任务，或经验证的固定上下界机制，不能只改一个interval便声称每日/每周持续生效。行业源示例文件变更也不等于数据库已换源，需明确停用演示源与导入新源的可审计步骤，不删除用户历史数据。

必须替换 `industry/prompts/rules-domain.md` 的 AI 专有语义，并同步 taxonomy、topics、sources、预筛、评分、结构化与归组示例。站点名、Logo、域名、隐私条款尚未定稿；研究范围已获授权自主规划，不再把鱼种选择作为阻断。

## 数据设计：少建表，保留证据

以下表名和字段为建议，实施时先检查当时 schema 与迁移序号；不重复创建文章、来源、分析、publication 或通用模型回执。

| 建议对象 | 最少数据与约束 |
|---|---|
| `fishery_documents` | `id, article_id?, source_id, issuer, instrument_number, document_kind, original_language, canonical_url`；文号缺失不得用标题伪造；一份文书可关联多个网页和附件 |
| `fishery_observations` | `document_id, observed_at, fetched_url, status, etag?, last_modified?, raw_sha256, normalized_sha256, previous_observation_id, parse_status`；追加观测链，不修改历史；304/失败仍留状态，正文去重不等于观测消失 |
| `fishery_evidence` | `observation_id, object_key, mime, bytes, sha256, page?, section?, quote?, bbox?, parser_version, language, rights_scope`；PDF/HTML原件与文本分离，表格保留单位、表头、脚注和页码 |
| `fishery_policy_versions` | `document_id, observation_id, status, adopted_on?, issued_on?, effective_from?, effective_until?, date_precision, timezone?, applicability, review_state, reviewer, reviewed_at`；状态与适用范围必须有证据锚 |
| `fishery_policy_relations` | `from_version, to_version, relation, target_ref, extent, evidence_id, review_state`；`target_ref`可指条款/附件，`extent=partial/full/unknown`；`amends/replaces/repeals/corrects/implements/objects_to/exempts` 不混用；不因译名相似断言修订或把附件替换解释为全文废止 |
| `fishery_exports` | 已批准素材包的 `id, revision, publication_id?, policy_version_id?, rights_version, content_hash, change_seq, withdrawn_at, withdrawal_reason`；对外版本和源观察版本分开 |
| `fishery_delivery_ledger` | 消费者/包ID/版本、导出时间、下游草稿/平台发布ID、复核状态和撤回处理结果；首版可由本机桥接器维护 SQLite/JSON，不强制中心再建表 |

`applicability` 首版使用受控 JSON：海域/公海或国家水域、组织、鱼种、船旗、渔法、船型、主体、活动（捕捞/转运/进港/进口/雇佣）、成员实施要求、异议与豁免。`unknown` 与“不适用”必须分开，不能把空数组解释为全球适用。空间数据先保留官方区域文本与地图出处；没有校核几何和规则前，不做自动电子围栏或许可判断。

政策档案保留策略独立于普通新闻TTL；`article_id`只作可空关联，不用级联删除把政策证据一起清掉。模块retention与备份必须覆盖原件及版本链；归档期限、许可撤回与隐私删除是不同规则，实施时明确冲突处理。仅增加表而不处理既有清理任务不算完成。

一份文书同时可以“已通过、未来生效”，某成员还可能存在异议或国内实施步骤。因此不要用一个互斥枚举代替所有法律状态。各事实字段保存 `value + evidence_ref + review_state`，显示层再形成经过审核的状态摘要。只有月份/日期的文本不补造精确时分；采集时间和网页更新时间不能充当生效时间。

真实日期样本：国内2025修改决定包含不同规章部分的不同施行日期，其中远洋规定相关修改属于2025-09-01施行的部分；网页日期又是2025-08-01，不能混用。WCPFC CMM 2024-04页面显示2028-01-01生效且当前尚未生效，不能按编号年份激活。两项原始链接及本轮核验边界见信源登记。

统计资料另存`data_period`、提交/发布/修订日、最近观测日及`newer_version_checked_at`。2026提交的2025年度报告与2025提交的2024年度报告不能只按“年度报告”去重；“较新”也不自动覆盖旧口径或证明可比。Pro比较表采用较旧NPFC/SPRFMO年报，本方案用实际取得的2026报告补充，仍保留原文冲突和历史出处。

### 必须处理的现有语义缺口

`content/materials.ts` 的 `seen` 查询会在历史任意版本已出现时返回 unchanged：A→B→A 不留下新修订。该设计适合抑制网页轮播，对政策回退不够。首版先由模块在材料去重之前保存独立的抓取观测与附件字节哈希，保留每次变化；如现有 hooks 无法覆盖去重前的输入，提出一个窄的、带测试的材料观测 hook，不能假装现成 `on` 已保证此时序。不要为了修复政策档案，直接取消全站历史版本去重。[确切分支](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/content/materials.ts#L318)

原文网页不变而附件被替换时，网页 content_hash 不能代表附件。按已许可官方附件逐个 GET、限尺寸/类型/重定向、计算字节哈希，解析新版本并保留旧件。禁止模型自动获取任意文中 URL；复用已有出站网络安全约束，阻止内网地址、凭据URL和非白名单协议。扫描 PDF/OCR 属于后续明确实现与隔离任务，目前没有已验证的专用解析链。[现有提取](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/content/extract.ts)

## 可信度、影响与原创价值

三项分开存：来源与证据可信度、对具体业务的影响、可发布的原创解释。官方单源不强制等第二家转载才入库；但必须核验正文、适用范围、修订链和单位。媒体爆料需要独立原始证据。中文译文是衍生字段，不能覆盖原文，跨语种同事件以文号/组织/日期/正文证据归并，低置信度待人工。

表格做约束校验：总计与分项、吨/千吨、数值/比例、统计期/发布日期、海域/全国口径；冲突保留原文并标记待核，不自行纠正后当官方值发布。本次 NPFC 年报已显示跨表数值口径需要复核，不能凭单个汇总表计算“是否超捕”。

原创选题可以回答“哪一项规则变了、涉及哪类主体、下一次需要核对什么”，配官方页码和时间线。AI×无人机×低空暂作有渔业实际应用证据的技术观察：海上巡检、港区物流、鱼群探测研究、监管与安全；不把未经证实的演示、算法效果或政策许可当商业落地。

## 政策提醒与审核

新增观测→解析/证据校验→适用性候选→人工行业审核→批准素材包→下游草稿。提醒类型包括新文、正文/附件变更、未来生效、临近失效、替代/废止、异议/实施状态更新。日期提醒是建议工作项，不能以“未发现更新”宣称规则仍有效。源失联/证据冲突时显示未知或暂停，不发确定性经营建议。

提醒通过既有队列和 schedule 机制生成中心内部待办，首版不新建用户日历/外部通知或第二份早报任务。已核准且日期精度足够的事项可设D-7/D-1复核提示，月份/条件生效不补造时刻。法务/经营结论需要具备背景的人工审核；系统不提供捕捞、航行、转运或进港许可。

## 安全、资源和成本

公开区只放审核过的摘要、出处与许可范围内材料；后台管理员入口、机器读素材接口、证据原件三种权限分开。`/api/admin` 的 Cookie/CSRF 不等于机器读接口认证。新接口若上线，使用独立、只读、可撤销凭据，限制路径/消费者/速率，TLS且不在URL传密钥；本轮不创建密钥。Easel只从本机主动拉取，不向互联网开放其聊天/上传端口。

私有素材/证据路由使用模块`http`入口并逐次鉴权，不放进默认公开API/MCP的`AgentAbility`。也不复用现有ingest写token；公开投影、机器读取和采集写入是不同权限。外部原文中的提示词或链接不能授予Easel工具权限，执行和发布授权在内容之外控制。

Compose 的 Web 默认绑定要在部署时复核并收敛；数据库和内部 API 不直接出公网。域名、DNS、证书、反向代理信任边界、主机剩余资源尚未实测。2核4GB是官方构建建议，不能写成已证明的运行最低配。[部署说明](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/docs/deploy.md)

成本先按采集量、模型各步调用数、输入/输出tokens、重试、嵌入、OCR页数、存储增长逐日记账。现有预算按尝试次数计数，不是人民币硬上限；没有预算行可能无限制。建议试点先关闭所有付费开关，以样本估算后再经用户批准设置提供商硬额度和本站上限。禁止直接以演示样本调用数推算渔业月费。[回执与预算](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/providers/receipts.ts)

可供后续审批的试点约束：先以30—50件离线样本建立各步骤token分布；模型预算建议10元/日、试点累计100元，二者都是待批准的费用上限建议而非市场报价或已设置硬闸。提供商支持硬额度时同时设置；不支持时不得承诺绝对不超额，采用保守token上限、单请求最大长度、预留并发/重试额度并提前停机。OCR、付费媒体和额外embedding默认关闭；主机/域名/存储费用单列，尚未报价。当前本任务实际批准支出为零。

金额账本须满足“已结算+在途预留+未知结果保留费用≤批准额度”；价格/币种/预算缺失时拒绝新的付费调用。超时不直接释放额度，重试、fallback与其他付费提取共用预算视图。达到费用上限仍保留不付费的元数据观察、获准原件留存、撤回同步和人工审核，不让预算熔断变成政策漏检或漏撤回。

证据原件置私有对象存储或受保护本地目录；备份需覆盖数据库、原件、解析版本和许可记录，实测离机恢复与哈希。默认数据库/上传备份、图片缓存和30/90天保留策略不能自动承诺长期政策档案。提出RPO24小时、RTO4小时仅为验收目标，未实测达成。

恢复后先关闭素材出口，复核原件哈希、最新许可/撤回和预算台账，再更新同步epoch并要求桥接器对账；不能恢复旧快照后让已撤回素材复活或付费任务重新获得整月额度。

MIT允许复用代码的条件与第三方抓取内容、商标、Logo的权利分别处理。保留 LICENSE/NOTICE，站点使用自有品牌；逐源确认采集、内部保存、摘要、翻译、图表、全文、向Easel转交和公开再发布权。机器接口鉴权不产生转载许可。
