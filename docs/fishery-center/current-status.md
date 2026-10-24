# 当前事实：2026-10-24

分别核实：3a 部署 05:44 UTC、JFA 重评 05:57 UTC、自然日报 06:14 UTC（06:17 回读），信源状态最后核实 06:23 UTC。本文是归档事实入口，不是实时监控。依据为[脱敏验收摘要](evidence/production-acceptance-20261024.safe.json)、[最终生产报告](history/20261024-native-flow/production-deployment-3a162-final-report.md)及[来源校验清单](provenance/source-manifest.json)。

## 版本、目录与运行结果

| 项目 | 已核实事实 |
| --- | --- |
| 固定开发目录 / 用户仓库 | `/Users/choco/workplace/AIHOT`；origin = Maidamai/AIHOT |
| 原项目 / 原版 | upstream = KKKKhazix/AIHOT；固定对照为 b399，不代表跟随其最新 HEAD |
| 业务分支 / 最后源码提交 | `feat/fishery-native-flow-v2-20261024`；3a162cb5f30e27a6385d0fb0c1b7227f059028a3，已正常推送 |
| 最后生产 release | 同为 3a；API/web/native/archive 四服务运行，旧 manual 停止，未取消私有预览鉴权 |
| 本次文档归档 | 在上述源码后提交文档；归档提交 SHA 见本文件 Git 历史。不能将它写成已部署源码 |
| 普通新闻主线 | queueProcessing → runAnalysis（预筛、双评分、结构、详写/短摘要）→ publishArticle → 原 group/digest/hot/reports；无逐篇素材批准和普通终审 |
| 已有真实样本 | 既有 JFA 文章正常后台单次显式重评，prefilter PASS，双评分 22/22，自动生成中文摘要并进入全部动态；selected=false |
| 读取结果 | 全部可读 13→14，仅增加 JFA；原 13 条身份、日期、binding 保持。网页/API/RSS/MCP 一致；本稿未进入精选，未形成 story/fact/digest |
| 自然刊期 | 原调度 compose 207 于 06:14 UTC 成功，daily:2026-10-24，report id 1“本期暂无入选资讯”；judgedReports=1、selectedReports=0、entryCount=0、model=null |
| 日报出口 | 日报 API、网页和 RSS 均 200、同日期标题；这是无精选条目的平静日报，不是含稿日刊 |
| 费用与回执 | 原 ledger 累计 59 条 received，按 usage 估算 ¥0.897700；pending/unknown=0、累计上限仍 ¥10。本次重评新增 5 次（55–59）估算 ¥0.162376；自然日报无新增模型调用 |

## 保持的限制

模型范围仍是原四栏目，起点 `2026-10-21T07:13:00Z`；[范围表](sources-and-scope.md)区分注册、归档、原生模型和专项提名。ITF/FAO/MPA 仅归档不等于模型授权，NPFC 保留专项，JMA 未上线，IOTC 排除。真实日期不修改为今天，旧资料不冒充新稿。

指定政策 `5f67141e-47ee-4521-bd66-7e842936c02f` 仍 review_only 且不可读；MARA 的明确授权拒发与已付费结果保持。旧 analysis 1 / receipt 46 的 BLOCK 原样保留，新 analysis 2 / receipts 47–51 为独立新版本结果；不手写 PASS、不抹费用、不自动换身份重发未知请求。

正文默认摘要加原文链接，site_fulltext 与全文外发仍关闭；推送/飞书/IndexNow 等不随资讯主线整体开启。公开数据模型的 public 投影不等于匿名公网开放；公网仍受既有登录门禁，源站仅回环绑定。

## 采集实况与验证边界

JFA 05:33 轮与 MPA 05:32 轮列表成功，正文分别 2/1 项失败，因此整轮 partial；fetch_runs=ok/partial，job_runs 显示 failed。两源 fail_count=0、last_error=null、未暂停，进度与下一轮保留；NPFC 06:17 自然轮 partial、正文失败 1，但 06:23 fail_count 已为 0、未暂停，下一轮 12:17 UTC；此前 fail_count=2 属于旧阶段。不能称八源全绿，也不能把单篇失败说成整源失败。

本地支持的 Node 24 完整 backend 1255/1255 发生在最后队列登记修复之前；该修复后 1/1 定向及类型检查通过；d92 handover 21/21，3a prompt 2/2 既有定向，后两次未重跑全量。web 90/90、本地 smoke 30/30 是本地结果。假模型测试不等于真实模型选材证明；生产真实结果另列于上表。

已存 ITF/FAO/MPA 两轮有限离线对照：114 个共有 core 候选观察 / 57 URL，行业过滤后 68 观察 / 34 URL；6 份详情对应 3 篇文章，日期正文无差异。MPA 503 和 72h 排队为人工注入，证明 partial/firstSeen 行为，不是实际生产故障恢复。详见[回放报告](history/20261024-native-flow/verification/archive-replay-report.md)。

## 仍未完成的验收

- 自然新到新闻从采集到发布的真实闭环；当前正例是既有稿显式重新评估。
- 高分稿进入精选、事件归并与综述/热点的真实正例。
- 含精选内容的日报、周报、月报；不能把零条目平静日报称为有稿刊物。
- 至少 48 小时连续运行与后续刊期观察；全源故障消除和生产恢复演练。

历史计划的“未部署”“仅本地”“等待重评”是当时时点，均由本页及最终报告取代。没有为本次文档归档新增部署、模型、抓取或全量测试。
