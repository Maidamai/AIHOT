# 归组、热点与成刊的独立只读核查

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


核查版本：上游 b3998dc6fc138eb9659f33f55eb38c1c716f0d57；本站 a5a0f8c064d5c82a707af2f170582338bb8ff10e。文件均来自本任务 snapshots/upstream 与 snapshots/current。以下是源码能力；生产是否跑通见 production-trace.md，不能把调用存在等同于真实近期正例。

## 原版链路

- apps/worker/src/main.ts:20–28 注册内容、事件、发布与定时工作者；schedules.ts:27–35 定义每5分钟内容扫描/热榜、每小时热度采样、每半小时成刊。
- packages/backend/src/events/group.ts:234–263 的 groupArticle 在归组开始、成功、失败时重算发布投影；成功把 grouping_status 置 complete 后 publishArticle。人工归属是覆盖机制（277–281），不是每条文章的必经终审。
- group.ts:289–307 区分历史、综合稿、事实未知；历史不建立事件、不贡献热度，未知事实不能精选。发生同一新闻的报道可以合并事实；后续进展进入同一story。算法没有被本站重写。
- jobs/events.ts:12–22 在 groupArticle 返回非signal的story后，延迟60秒排入 composeStoryDigest；events/digest.ts:44–88 对当前证据写模型综述。原版有自动生成事件综述，不能认为摘要事实已审过就等于综述也已审过。
- events/hot.ts 的48小时、24小时半衰期与每个独立参与方只计一次保留；computeHotRanking 要求至少2个参与方、至少1个editorial（现版同文件58–61、192–195）。单篇可建立事件，不自动成为多源热点。

## 本站当前链路已接上，但被审批与输入约束

- modules/fishery/backend/news-editorial.ts:21–41 的 approvedNewsRun / projectNewsAnalysis 把真实预筛、双评分、已审结构化和文章写入核心analyses，不伪造模型结果。
- publication-bridge.ts:165–171 在终审投影时 projectNewsAnalysis → publishArticleTx → enqueueNews。
- news-editorial.ts:45–77 再检查当前审批、正文revision、projectionHash、非backfill，并在同一累计授权下直接调用原 groupArticle，随后 publishArticle。新闻队列有消费者（manual-processing.ts:67–72），不是无人消费。
- manual-processing.ts:80–87 每10秒维护中实际运行 dispatchAutomaticDocuments、refreshApprovedHot、composeApprovedReports。开启总worker不是接通这一链路的必要条件，直接开启反而会同时启用原有付费/分发任务。
- 本站未经过原 jobs/events.ts 包装器，所以未排事件综述队列；周/月报用 writeOverview:false（news-editorial.ts:128），有意复用已审文字，不额外生成未审总述。它减少新断言与费用，但不等价于原版完整自动编辑功能。
- 规则和共享读取层已支持归组、精选、热点、成刊，既有生产证据却没有近期合格输入正例。不能将旧文档里“尚未接通”的中间结论套用到a5。

## 日报空输入不是同一种行为

上游 reports/compose.ts:89–116 的 composeDaily：

1. entries=0 且 judgedReports=0：抛错“nothing judged in its window”，留待补刊。
2. 有已判断内容但没有新要闻：保存带“平静日”导语的空日报。
3. 有条目：规则编排、保存；日报不调用模型。

judgedReports 是公开可列出、有score、非backfill的报道数（edition.ts:275–280），不是所有任务数。dailyEdition 同时考虑精选和 missedFacts（299–304）；missedFacts 可用官方报道+至少3个独立参与方补进日报，不要求先有精选（240–272）。

上游 composePeriod:194–210 只有“应有日报齐全且原始条目全空”才自动跳过周/月报；缺日报、被撤回到无可用条目等仍报错。composeDueReports:305–334 按日历枚举缺期，每期分别捕获失败，不让一个失败阻塞其他期。

本站 composeApprovedReports（news-editorial.ts:108–132）先查已公开精选、非backfill：
- 一条也没有便返回 generated:[]，原 composeDaily 的“没有判断输入”错误根本不会执行。
- 日期从已有精选推导，不枚举所有应有刊期；仅有低分资料或只有missedFacts的日子不会触发。
- 周/月报在 periodEntries.entries=0 时直接continue，提前遮蔽原版关于完整空周期与缺期的区别。
- 循环没有每期独立catch；一篇日报失败会退出本次维护，外层只打印通用maintenance failed，后续期刊与同次维护缺少具体失败上下文（manual-processing.ts:82–83）。

这不是建议用空日报假装成功。建议恢复原版“按刊期检查、区分经过判断后的平静日和未完成处理、逐期失败隔离”的语义，保留当前审批过滤与禁额外模型总述。本站低分现在不发布，原judgedReports不能直接代表所有完成过的选材，应明确记录/呈现该区别，不能只照搬SQL便宣称监控完成。

## 保留的正确改动与明确代价

- reports/edition.ts:114 用 currentPublicationCondition；periodEntries:183 用 listedCondition；events/hot.ts:116–137 把当前模块审批加入热度输入。撤销/换版后旧投影不能继续进日报或热榜，这应保留。
- 来源运行状态通过 hot.ts:91–101 纳入实际专用调度，不把核心enabled=false误报为所有来源未工作。
- 事件综述与周/月总述暂不生成属于当前产品边界，不能用“原版算法已复用”省略这一差异。
- 本轮未跑模型、未运行数据库测试、未访问生产，未取得“新文章→终审→归组→精选→日报”的真实成功证据。
