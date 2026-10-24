# 远洋资讯原生流程生产执行计划

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


**当前执行状态：部署迁移已完成，生产效果验收未完成。** 唯一执行者 native_ui_ops 已完成 fa8 生产切换、迁移及新处理器启动；2026-10-24 04:36:38Z 确认四服务 running、旧 manual stopped。见[生产完成汇总 (local original; provenance)](../../provenance/source-manifest.json)、[部署安全汇总 (local original; provenance)](../../provenance/source-manifest.json)和[当前交付记录](implementation-delivery.md)。首轮 `reports.compose` 实际失败，日/周/月报均 0；两条非历史记录 restricted，rejected 标记的真人/系统来源待 actor/audit 核清，见[自然观察快照 (local original; provenance)](../../provenance/source-manifest.json)。自动链已部署且有真实采集隔离证据，尚未达到真实新稿和出刊的正例验收；部署完成不代表整体效果验收完成。真实新稿/刊期正例和 48 小时观察仍待验收。

本文件以下保留切换前执行计划及当时快照，出现“待部署/前置/待 review”时应按历史理解，勿据此重复执行。root只统筹，native_review独立核对；既有授权不覆盖凭据、主机信任、权限或安全配置的擅自变更。

## 固定版本与只读前置

- 本次实际部署固定提交：`fa8eb3d26ba0da128c0686cd9738bb8213249b2f`，`Maidamai/AIHOT` 的 `feat/fishery-native-flow-v2-20261024`；parent为`a5a0f8c064d5c82a707af2f170582338bb8ff10e`。只从此提交导出源文件，不从旧feature默认HEAD或工作区漂移构建，不强推或改旧分支。
- 既有主机：`[private-ssh-target]`，项目根：`[private-server-or-temporary-path]`，Compose项目`fishery-pilot`。使用现有SSH身份，StrictHostKeyChecking=yes、UpdateHostKeys=no、无转发；不打开/打印私钥、环境文件或provider配置。
- 2026-10-24 03:54:09Z容器安全快照：API/web/manual/archive均为`fishery-pilot-app:integration-a5a0f8c`；API和web release均a5；DB容器与数据卷不替换。web PRIVATE_PREVIEW=true；API模型/通用采集false，manual模型true、archive模型false且fishery-archive；外发阀false。项目只绑定服务器回环39871/39872，保持现有域名、代理和鉴权。
- 队列：created/retry/active全部为空，running flow=0、pending/unknown receipt=0，旧fishery.news为空；此结果仅代表快照时点，停旧消费者后必须再次核对。
- 原累计账本：53次、estimated ¥0.699208、unsettled ¥0、上限¥10、53条received。使用同一账本，不初始化、不复制额度、不更换key或扩大请求容量。SQL canonical hash为`5c90c60a37700c9fa1b496edb6931e5ae45dfffd6c008ba3802c82537f46ba93`（与旧JS stringify hash算法不同，不混用）。
- 2026-10-24 04:00:24Z真实统一读层：all=13、timeline=0、指定policy不可读；13个article ID、source、原发布日期/发现时间及binding在`production-preflight/read-layer.safe.json`。物理publications=16不替代当前可读数。
- 指定政策`5f67141e-47ee-4521-bd66-7e842936c02f`仍needs_human_review/human、supported/complete_input，human decision=null、binding=0。原用途表尚不存在；0108后显式初始化review_only，不改原任务/评分/回执。
- MPA `292f8e02-dcde-4bb6-9839-df372a1e142a`仍真实2026-10-22日精度、backfill=true/stale-on-discovery，无审批/绑定；不转近期、不作为新链成功样本。

证据：`production-preflight/snapshot.safe.json`、`document-classification.safe.json`、`read-layer.safe.json`。读取层自身采用短期SELECT FOR SHARE保证证据一致，因此其正常读取未强制SQL READ ONLY；其余快照使用repeatable-read READ ONLY，无数据写入或任务调用。

## 精确范围与旧任务处理

新`fishery.native.processing`只沿用原已授权范围，不把归档enabled当模型扩围：

```text
sourceIds = fishery-column-fujian,fishery-column-fujian-notices,fishery-column-jfa-press,fishery-column-moa
createdAfter = 2026-10-21T07:13:00Z
```

`fishery.flow.dispatch`原setting仍保留给现役专项，不整key删除。ITF/FAO/MPA只保留既有归档节奏，不加入首批模型范围；NPFC维持专项及6小时节奏；IOTC继续isolated，JMA不注册/启用。

**本次handover执行清单：空。**

- 28个MARA auto queued占位的原文日期在2020–2025，无verified-news核心article、无生效专项提名，保留为历史，不一把清空，不改purpose。
- 唯一期待检查的近期JFA document `aa4e2e7a-67f0-4244-8552-c90f19854928` / article `jxr71d4jo1wbyzpbkrob4rwe6`，有queued任务`c3b0c9c6-ff9e-4ca4-a72c-f7ad79d8b79d`，另有`14eceb9c-e041-4448-aa55-2694c6178d6f` rejected/prefilter及human_decision=rejected。草稿/核查/阶段请求/评分结果均空。最初按 rejected 字段误判为人工拒绝；04:43:52Z 精确审计已纠正：actor=automatic-dispatch/internalOnly=true，audit995 action=auto_superseded，明确是系统替代未开始占位，不是实质拒绝。现版 CLI 副本 dry-run 实际 denied，因此仍不运行--execute/不直SQL写purpose；兼容迁移边界交 root/core/reviewer 评估。详见 production-preparation/final/rejected-provenance.safe.json。
- 停旧manual后再次导出fishery.flow created/retry/active job→task/selection安全阶段元数据/nomination。如果不再为空，逐个证明现役专项或停止切换，不能让旧普通任务被native顺带消费。retire-legacy只处理旧news未开始任务，不替代flow分类。
- 现有许可不改：MARA/福建两栏unknown；JFA permitted、allowedSummary/Publication=true、fulltext=false，rightsCheckedAt=2026-10-23T14:49Z、reviewDueAt=2026-11-22T14:49Z且证据链接存在。不得为迁移批量改许可。

## 旁路准备与私有备份

在不改变现有服务或生产数据库的前提下，可先准备以下内容：

1. 本机只从fa8提交导出发布包到task5的release staging（不是另开git集成目录）。复制本次Node24已验证的web构建，逐文件保存源文件/构建hash与来源SHA；新包不得含.env、凭据、.data、node_modules、Codex会话。依赖/锁文件与a5一致，不新增依赖。
2. 服务器独立release目录：`[private-release-or-backup-location]<UTC唯一后缀>`，权限0700；镜像`fishery-pilot-app:native-fa8eb3d`。继承现有a5镜像的Node24/Linux依赖和PDF工具，覆盖精确提交源代码与最终web构建，移除旧web build后复制新build。构建使用`--pull=false --network=none`，不更改宿主软件/系统配置，不替换运行容器。核对镜像label/release/SHA及web构建hash。
3. 首份预演快照与最终切换快照分开。私有备份目录策略：`[private-release-or-backup-location]<UTC唯一后缀>`，0700；保留精确旧容器ID/镜像/命令/可见性安全投影、旧DEPLOYMENT、必要Compose文件副本与hash、生产DB custom-format dump、/data私有归档tar、逐文件hash与阶段记录。凭据留在原位置，不读取/打印/复制其值。备份不发布到公网或仓库。
4. 首份在线pg_dump只用于预演副本，不宣称与仍运行archive同时变化的/data构成最终停机恢复点。正式恢复点必须在停止取新工作、排空并复核后重新取得；不拿旧快照覆盖期间增量。
5. 独立副本DB使用`fishery_native_fa8_<UTC>_test`，归档恢复到独立私有卷；不映射端口、不启动worker、使用新镜像一次性CLI，MODEL/COLLECT/外发false、无model credentials注入。只跑本计划定向预演，不跑全量测试、不主动抓取、不真实调用模型。

## 副本预演关卡

1. 先用a5的统一读层在同副本确认13个有效历史ID/日期/source/binding与生产读取基线一致。
2. 新镜像执行正常迁移，仅新增0108 schema；不改历史迁移、不关闭migration检查、不进行隐式大回填。
3. `fishery-native.ts initialize-review-only`默认dry-run，然后在副本`--execute`；确认指定政策purpose=review_only，原task/评分/回执/决定不变且所有读层不可读。
4. `retire-legacy --actor ... --reason ...`默认dry-run，确认与快照一致；副本`--execute`只取消旧news created/retry，保留历史，不动现役专项scope。
5. 唯一JFA候选handover dry-run记录明确拒绝及拒绝后库状态不变。本次无handover execute目标。
6. 下表8源均需旧profile→新采集语义profile迁移；在副本运行并保存cursor前后、失败/历史/pending/firstSeen证据。无恢复需求的基本迁移保持原runId/claimed/nextAt/fail_count。需要recover的源必须首次迁移同时传旧hash与recover-round；先基本改hash后再recover会因before全等检查失败，禁止该顺序。
7. 新读层逐ID对照13条历史、真实日期及binding；policy仍不可读，MPA仍历史。账本53/¥0.699208及所有entry/hash原样不变。
8. scope先enabled=false记录精确四源/原起点。副本中允许model=false注册演练，但它会消费flow/publication并写任务/热度/刊物状态，不能称只读，也不能在未核队列的生产环境做演练。真实管线行为已有本地假服务测试；副本只核部署特定状态/迁移，不调用外部服务。

## 八源游标与恢复清单

下列值来自03:54快照；正式停止archive后若源状态前进，必须重读新hash/最新ended round并刷新清单，不能套旧before执行。

|column|expected旧profileHash|本批动作|原runId/claimed/nextAt（保留）|
|---|---|---|---|
|moa|f13f391c048fd673774f56ca59d1947af34ec10eb2210c75cde87a29157bf90c|基本profile迁移|mara-hourly-20261021 / 69 / 2026-10-24T04:52:47.599Z|
|fujian|28aa19f81d202c0c4fe292eb8085b74e1d3bc62dbbbdfbfcf682adf7851a9516|基本profile迁移|content-closure-20261023 / 16 / 04:26:41.164Z|
|fujian-notices|159700eb374aa31180f4dfdbd4182c3aa1096ab8014bc36a639ab1ac021d6327|基本profile迁移|content-closure-20261023 / 16 / 04:28:45.904Z|
|jfa-press|812e98c278fb3404bfa5e753e93175717dfa3c2901db4d455837f63269b1074c|副本证明后，同一次migration附recover-round `j-ae8f49f7-c333-41db-a498-540bdf119349`；证明不足则保留暂停并报告|actionable-jfa-20261023 / 5 / 原20:27:22.755Z（原10-23）|
|npfc|3ac797b356ae89d0b1ff2ffc295a7ce0e7c594a32584c7dc500393f6fa905ee4|仅基本profile迁移，保留fail_count=2及6小时槽，不凭正文失败盲清|npfc-six-hourly-20261023 / 4 / 06:17:04.126Z|
|itf-fisheries|1f779bcc62f553de98d696926a60dc200246d8a658d3f3a0fcd0522e8d400c55|基本profile迁移，模型不扩围|integrate-20261024-itf-fisheries / 5 / 04:37:39.062Z|
|fao-tuna|17b2c59ec1ec46964ba438a6b25b523a81c59f3b2a7df222a3734cb546b125f5|基本profile迁移，模型不扩围|integrate-20261024-fao-tuna / 5 / 04:37:40.277Z|
|mpa-port|1e76033a5ab8952cfe18ab8c7ee975a899ed5fa7540e7b742706aa1184894dd2|同JFA在副本核完整proof；通过则同次profile+recover `m-9d6be2af-5e3b-4d76-905e-a8705924333b`并同runId恢复既有归档，模型仍不扩围；失败则保留暂停/旧hash并报告|integrate-20261024-mpa-port / 4 / 04:06:46.942Z|

MPA方案关卡：既有hourly归档已授权，必须在副本验证确切ended round `m-9d6be2af-5e3b-4d76-905e-a8705924333b` 的before/sourceBinding和全部listing proof，通过才同次profile+recover及同runId disable/re-enable，保留claimed；这不授予MPA模型范围。proof失败则安全保持原暂停/旧hash，明确blocked reason，不直接清零fail_count/pausedReason。

JFA证据：latest fetch91/上述ended round为partial，before=current、sourceBinding存在；proposed health显示2条正文失败、3条修订复查，旧正文失败造成源fail3。但“列表可用”必须由不可变batch列表原件/HTTP/hash和副本verifyBatchListing证明，不能仅据文字outcome。`migrate-column-progress --column jfa-press --expected-profile-hash <表中旧hash> --recover-round <确切round> --reason <具体证据>`会在证明通过后修sources.fail_count/cursor；不会清archive setting pausedReason。若需恢复正常周期，再使用既有`moa-archive`的同runId先disable再re-enable语义，保留claimed/current，不换runId；要求current=null、fail_count<3且与已核结果一致。不得直SQL清pause或换runId重置预算。

## 真实切换顺序（副本与review通过后）

1. 正常停止旧manual和archive取新任务，给既有排空时间（至少覆盖470秒任务排空，不使用旧45秒强杀路径）。不停止DB、代理或其它项目；不改变既有来源/模型授权。
2. 再跑相同安全快照：无active/running、无pending/unknown/refused、archive current=null，flow/pub待领清单有明确分类；有任何新未决则停止切换并对账。重新取得最终DB+/data备份及13条读取基线，记录新时间/hash。
3. 生产一次性新镜像执行迁移0108及显式policy initialization；模型关闭，不启动任何worker。核对原policy/task/回执、ledger连续。执行已在副本证明的retire dry-run/必要execute；本批handover execute列表为空。
4. 逐源执行已复核的profile迁移/有证明的JFA与MPA recover；proof失败的源保持暂停。保留NPFC失败/槽。禁止修改rights、全文许可、旧人工拒绝、日期或历史文章身份。
5. 写新native scope enabled=false并核对四源/原起点；在所有处理执行者已停、lease释放后显式同范围enabled=true。不修改现役专项setting范围，不增加任何来源。
6. 用新镜像更新API/web，保持原production auth/private-preview/端口/代理与所有外发阀；正常通过现有Compose private overlay注入既有认证，不读取/打印secret。先验证版本、鉴权和13个读层ID，不把物理行数当可读。
7. 再次确认待领flow/publication为已核清单，启动单副本fishery-native（沿用既有模型配置与累计¥10账本）。不使用production model=false启动作只读演练；启动即可能处理正常新候选并产生已授权费用。full/manual不并行，保持同lease；当前全部旧近期候选受限导致model增量0是正确结果，不造成功稿。
8. 启动新archive同原授权/间隔，经过已证明的JFA恢复才恢复该源；ITF/FAO/MPA既有归档权限不转模型授权。新候选由自然周期进入，不主动额外抓取。新native采用单副本unless-stopped、515秒排空；重启仍受lease及pending/unknown累计预算保护，不自动重付未知请求。
9. 记录切换后release/image、scope、当前job、ledger/未决增量、policy不可读、13历史逐ID/日期对照、source listing/body失败分离与最近正常周期。保持摘要/原文链接、全文关闭、私有预览和外发false。不因本次部署自动公开站点。
10. 之后观察至少48小时和两个日报边界。真实候选/评分/事件/刊物没有发生前，明确报告“已部署与本地/副本验证”，不宣称生产全链正例；绝不把未经兼容迁移处理的JFA旧系统占位、旧政策或历史MPA变作近期成功样本。

## 停止与回退

发现用途误放行、证据/日期错配、重复计费或账本不连续时，先禁对应自动动作并正常停止新执行者，等待在途落账；保留所有增量。新用途表及未知阶段出现后，不用旧a5盲接新任务，不恢复旧数据库抹掉费用。保留可识别0108用途的新兼容镜像作为安全回退执行者；必要时只恢复API/web的兼容版本并保持处理停止。旧a5镜像/配置/备份保留供核验，但数据和费用不倒退。

切换前待 review 关卡（历史留档）：JFA副本 recover proof、MPA旧 hash 的明确安排、唯一 JFA handover 拒绝复现、13历史逐ID保持及最终停取快照一致。实际迁移已完成并保留原历史、账本与用途限制；当前没有未决部署拒绝。路由诊断整凭据加载曾被拒且未执行/未重试，安全替代和独立正式部署结果见[审批记录 (local original; provenance)](../../provenance/source-manifest.json)。JFA旧系统 supersede 已由d92的匹配审计有界迁移完成（不能误称真人拒绝）；自然新模型实际BLOCK且有内容质量疑点，详见production-deployment-report.md；余下验收是自然候选出稿、真实刊期及48小时观察，不能以空输入补造正例。
