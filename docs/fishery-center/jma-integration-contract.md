# JMA 海上警报模块交付与集成契约

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


本分支基于 `605ac218a44a724bbcbd2c616706b331191c4ca5`，以合并提交 `b14a980` 完整保留旧分支 `e384bdbd5b11bc81570fd0ecb7f9bdc5ffdcd3c6` 的五个提交。实现提交为 `80501ba6a92b8df4ae17a3dcdfab1a17f44d719a`。分支 `feat/jma-marine-lifecycle-20261024`，目录 `[private-local-path]`。

交付范围是独立的原文参考解析、状态投影、离线回放及证据。本分支没有生产信源注册、数据库迁移、定时任务、API、网页、付费模型调用或部署。按照本轮集成约定，由 `integration/fishery-20261024` 的统一集成者合入、推送和部署；不写其工作目录。旧分支和共享主目录均未修改。

## 最小调用契约

代码均在 `modules/fishery/`。无需修改通用调度或页面即可合入；模块服务注册时由统一集成者引用这些函数。

| 文件 / 函数 | 输入与输出 | 必须保留的边界 |
|---|---|---|
| `backend/jma-cache.ts` / `cachedJmaGet` | 显式目录、URL、时钟、transport；返回原始字节及 download/cache/not_modified | 单写入者；成功电文 URL 永久去重；pending/损坏停止自动重试；长周期 Feed 至少一小时才重验证 |
| `backend/jma-sea-warning-state.ts` / `discoverJmaSeaWarnings` | 已解析 Atom → 候选 | 已知产品码的标题变化、新全般/地方海警版本进入待核查，不能被选择器静默过滤 |
| 同文件 / `inspectJmaSeaWarning` | 原始字节、官方 URL → observation | 返回 bytes/hash/id、metadata、warning 或 error；解析失败也必须持久化。URL+SHA-256 是证据身份 |
| 同文件 / `projectJmaSeaWarnings` | 全部 observations、持久化 discovered 台账、当前 Feed 原件与真实 checkedAt、显式 now 和两个复核期限 | 输出 latestKnown、discovered、unresolved、sourceBlockers；重新解析原件，不信任调用方改过的树。无网络、DB 或模型调用 |
| `backend/jma-sea-warning.ts` / `parseJmaSeaWarning` | 单份原件 → 经过范围校验的原文检查树 | 保留所有数值字符串、单位、条件、子海区、时间、原文空格；原始字节为最终原件，不用检查树重新生成“官方电文” |

`projectJmaSeaWarnings` 的 `discovered` 入参是上次已持久化的完整返回台账，首次明确启动时才为空。每个记录包含 URL、Atom 标题/updated、来源 Feed hash/updated、观察时刻。**先将返回 discovered 与原件索引原子保存，再开放任何读取。** 没有取得的 URL 即使从后续 Feed 消失，也仍在 unresolved；只在保存原件后才消除“未取得”状态。取得损坏、未知版本等内容则转为相应隔离状态，不能删除失败记录恢复旧报。进程重启必须读取同一台账和下载缓存；不能新建空目录伪装新一轮。

当前实现对可见全般/地方海警窗口保守检查：存在未取得候选时阻止整个海警快照的审核资格，无法从未取得的 XML 推断编辑官署。初始化补齐、停机缺口和人工处置要有明确证据；不按文件名猜官署，不因达到单轮下载上限而宣称窗口完成。遇到 Feed 解析失败，传 `feed:null` 并保留发现台账；不得继续展示上次健康快照为“当前”。请求中断、来源不可用、过期和资料缺口均不等于解除。

`maxFeedAgeMs` 和 `maxReviewAgeMs` 是调用方显式传入的内部复核期限，无生产默认值，不是官方有效期。Feed checkedAt 必须来自真实200/304检查记录；`acquisition=cache` 不能刷新为调用时刻。读取时重新计算时间状态，不把过去生成的 JSON 无限期当作当前状态。投影同时检查 Feed 的官方 updated，304不使停止更新的Feed永久新鲜。

## 生命周期及区域含义

- 信息组依官方 `Control.Title / EditorialOffice / Status / EventID`，按 `Control.DateTime` 排序。Serial、抓取顺序和 Atom.updated 不用于新旧判断。同刻不同内容为 conflict；同 URL 不同字节为完整性冲突。
- 新发报、訂正替换同组已知旧报；保留 supersedes 的 URL/hash。新报过期、解析失败或待核查都不会回退到旧报。不同官署、运行/训练状态、R08/H29及临时报分别保留，不当作多来源确认。
- `officialValidUntil` 是原电文失效时刻，达到边界即 expired。`localReviewUntil` 是本地复核期限；它不会改变官方期限。缺少官方截止的有效警报被拒绝。严格要求时间包含时区；保留原始 JST/UTC 字面值，不将 TargetDateTime 当作法律生效时刻。
- 地方 `海上警報解除` 是正文通知，须为已核代码 `00`，不可混入活动警报或预报 Property，可无官方截止。全般 `海上警報なし` 必须使用无代码、无几何的 `全般海上予報区`，正文不得含活动海警，仍须有截止。空 Kind 列表不能解释为解除。
- 当前支持海警版本的手册只声明 `発表/訂正`。遇到 InfoType=`取消` 保留原件，输出 `cancellation_unverified`，阻止旧报；不编造“官方已解除”。未知状态/版本、无法识别信息组的电文继续隔离。
- 地方父海区与细分海区仅按[官方对应表](https://www.jma.go.jp/jma/kishou/know/kurashi/umiyoho.html)匹配**完整集合**；不同海区、缺少细分项、警报种类不符仍拒绝。原始父区/细分区绑定分别保留，未生成多边形或推导船位适用性。
- 全般见出与正文首个警报 Kind 按名称、代码、区域标识及数量核对；不混入概况和全般预报，也不将不同预报时刻的 Circle 强行等同。Coordinate 仅位置形式单列 `original_position_only_warning_extent_not_supplied`，不补造危险半径。

`eligibleForReview` 只是内部候选资格，不是发布批准或航行判断；`publicationApproved=false`、`safeToNavigate=null`、`navigationWarningComplete=false`、`replacesVesselWarningSystem=false`。原文追溯含 URL、字节 SHA-256、适配器版本 `jma-sea-warning/2`、海区代码包/工作簿 hash、层级映射 hash及警报代码表 hash。后续批准应绑定这些版本，规则变化需重新复核，不能只绑定标题。

## 本轮真实证据与离线用例

真实获取时间：2026-10-23 **16:18–16:23 UTC**（10月24日01:18–01:23 JST）。只取得一次官方字典、一次代码管理表、一次 `other_l`、三份不同的海警 XML；六个200响应合计 **739,948字节正文**。统计不含HTTP头和浏览官方文档的流量。首次受限沙箱请求在 DNS 阶段 ENOTFOUND、未发送HTTP；保留失败记录后在允许联网的执行环境完成单次获取，没有改DNS、代理、凭据或网络安全配置。

本轮新原件：冲绳地方、长崎地方、R08全般。结合此前7份已归档原件，10份真实样本比较结果为：旧解析器接受9份、新解析器接受10份，只有长崎样本结果改变；官方总区5100对应正文5110/5120/5130全部细分区，修复了旧版的误拒绝。原件均逐字节及hash核验，旧7份回放输出完全一致。冲绳和R08的新旧原件进入同组更新链，旧记录不会复活。

本次 Feed 有609条入电、391个全般/地方海警候选，样本集只覆盖其中10个，仍有381个未取得。快照正确输出 `unresolved_feed_bulletins`、**0个可送审核候选**；不能把10份解析成功写成完整接入已验收。样本获取时Feed.updated约早1小时49分，保留真实时间，不用抓取时刻改写。

本轮及此前10份海警样本均为通常/発表；**没有真实訂正、取消、解除、无警报或训练样本**。相关路径仅由源码生成的离线合成用例验证，数字为哨兵值，不是官方预报。真实样本字节回放与合成生命周期测试分别记账。

验证：Node **24.15.0**，40项JMA针对性测试通过；全部涉及文件的严格 TypeScript 检查通过；Pacific/Honolulu下重放JSON与原重放逐字节相同。没有全仓库、DB、浏览器测试或服务启动。独立 astra/max 只读复核发现的“pending滚窗丢失、错误范围无警报、同类扰动数量丢失”已修复并再次复现确认。

证据文件：

- [真实样本前后比较与HTTP收据](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/docs/fishery-center/evidence/jma-lifecycle-20261024.json)
- [警报代码官方工作簿摘录](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/docs/fishery-center/evidence/jma-warning-codes-20261024.json)
- 私有原件、下载checkpoint、完整生命周期输出、测试日志：`[private-local-path]`
- 旧归档只读复用：`[private-local-path]`

```bash
node --test modules/fishery/tests/jma-marine.standalone.test.ts modules/fishery/tests/jma-sea-warning.standalone.test.ts
node modules/fishery/scripts/replay-jma-lifecycle.ts <本轮capture目录> <旧marine-20261023目录>
```

回放脚本不联网，输出标识 `archived_http_receipts_replayed_offline`。它示范单窗口观察而非完整恢复；收据是本机记录，不是官方数字签名。所有原件在仓库之外，不提交二进制、环境文件或凭据。

## 交统一集成者的上线门槛

1. **可以先合入未注册的模块。** 建议直接 merge 本分支最终SHA，它已包含旧五个提交与基线。若使用cherry-pick：先 `6e58fb1 → 5105117 → 90581aa → 114dde2 → e384bdb`，再本轮实现及证据提交；不要把 `b14a980` 当普通提交 cherry-pick。完整精确SHA见最终交付消息。
2. 唯一采集器、共享每IP预算、发现台账持久化及重启恢复要在隔离环境接入验证。遵守[官方PULL限制](https://xml.kishou.go.jp/xmlpull.html)：长周期每小时更新，避免重取已取得电文；当前函数默认100MB日正文预算只管该目录，不覆盖同IP其他进程。只需other_l获取本模块海警，regular_l/extra_l作为旧背景验证保留，勿为海警重复下载三套Feed。
3. 初始化窗口/停机缺口要明确处理并验收。当前还没有真实订正、解除、无警报、取消或网络304/中断/断电恢复证据；不能将合成测试冒充这些实测。InfoType取消仍不是本模块已确认的正常发布语义。
4. 主调度、管理员入口和公开读取由统一集成者完成；保持现有管理员鉴权、CSRF、许可、审核及共享publication读取层。页面读取不采集、不调用AI，不把此模块送新闻评分或付费写作链。后台原文参考与公开展示资格分别验收，缺数据时保留明确状态。
5. 面向读者前，确认原文使用范围和编辑责任文案，维持官方数值、单位与区域/条件，不生成导航或救援指令，不称法定船舶预警系统。不宣称覆盖火山海警、全部海警版本、实时送达或精确区域几何；遵循[官方使用说明](https://xml.kishou.go.jp/considerationforxml.pdf)。

沿用旧分支的 `fast-xml-parser 5.11.1` 直接依赖声明（原锁已有该版本），本轮没有新增依赖或版本升级，无迁移和新环境变量，无需修改 `.env`。未完成上述门槛时，部署代码后仍保持模块未注册/不可公开；这不是批准生产海警业务已上线。
