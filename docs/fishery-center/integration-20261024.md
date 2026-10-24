# 2026-10-24 集成约定与上线门禁

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


本轮基线 `605ac218`。合入审核报告 `d72b2319`、业务适配 `13cea7ef`/`3fb6b741`、JMA `cb7f2de7`。唯一集成与生产写入分支为 `integration/fishery-20261024`，共享工作区不切换分支。

## 审核修复

v5.6 修复真实“专题研讨班在福州举办”的事件状态误拒，同时保留未/拟/将举办、据称、疑问和否认的阻断。生成相关性规则纳入明确渔船/船队业务（船员、港口、补给、安全等），仍拒绝只凭企业名称、泛海洋或鱼种词推断，不改变预筛、双评分、数值门槛或事实/适用性/终审规则。T1 来源层级的旧问题在605基线已修，本轮不重复变更。

部署前只读核对：4篇文章和9份指南依赖旧审核版本。文章新任务使用v5.6；仅已qualified的v5.5文章按已存版本只读重建原提示词、验证正文/来源/权限版本、目录和候选绑定。旧请求不能重新发送，未知版本仍失败关闭；新终审仍要求当前版本。指南验证没有变化，独立保留原deterministicRules绑定，不能因文章规则变更重标指南。自动派发在同证据的已有尝试/决定遇到新规则时阻断，不能静默新建付费重复任务。

9月30日政策文档 `5f67141e-47ee-4521-bd66-7e842936c02f` 保留72/72与12条supported历史记录；未终审，未发布。此次变更不执行新模型请求、终审或发布。

## 业务源

新增 `itf-fisheries`、`fao-tuna`、`mpa-port` 专用capture身份与证据分区，接现有原件归档、来源租约、进度、审计、导入和pg-boss控制器。MPA直接复用核心RSS解析的纯函数，不重新实现RSS身份和日期语义；读取者不会再次联网。FAO按日/月/年解释日期，MPA按新加坡日历核对RSS与正文；日期不足不补今天。

MPA每篇最多3份、单份10 MiB完整PDF，页数、正文和通知号/年份必须匹配；缺失、错误、无法解析不进入模型。真实同URL的PDF字节变化或必需附件清单变化使旧批准失效。网页装饰变化而内容版本不变时，新增原件保留为获取记录，旧观察/审核不改写。

启用动作分离：先 `node modules/fishery/scripts/business-archive.ts --register --column <id>`，再用 `moa-archive.ts --column <id> --enable --mode hourly --run-id <唯一ID>` 显式启用正常周期。每小时最多一页列表、一篇正文；历史30日以外分入historyDeferred，不假装近期更新。未注册时无自动获取。核心source.enabled仍false，付费自动派发范围不增加，转载/翻译/公开发布权不授予。

- ITF是工会报道；劳工指控须归属ITF，不能变成行政认定。使用条款限制商业利用，非商业用途也有条件：https://www.itfglobal.org/en/page/terms-use
- FAO为有日期的HTML市场分析；最新季度PDF、动态价格板未接入，不能当实时鱼货/船边报价。研究、新闻、翻译和商业用途的许可不同：https://www.fao.org/contact-us/terms/en/
- MPA是新加坡港口通知；停电/靠港安排或加油量不等于燃油报价。使用条款不证明本站转载许可：https://www.mpa.gov.sg/footer/terms-of-use

来源条款/许可保持待核；本轮受控获取与内部未审核素材不代表已获转载、翻译或公开发布许可。

## JMA及验证

JMA仅合入离线模块，不注册来源/任务/公开出口。交付快照391候选只获取10、381缺失；真实订正/解除/取消证据不足，eligibleForReview=0。不能宣称海警可用、不能进入新闻数量。

本机Node24.15定向回归：40项JMA、8项业务适配、归档RSS/依赖/原件重建、举办/日期/人工修订门禁、模块严格类型。新增数据库导入/版本与派发回归需在独立临时_test库运行；部署证据另存交付目录。只运行相关用例，不运行全量测试。部署沿用现有鉴权/网络/凭据/阀，保留605ac21镜像和数据库/归档快照；回退先停新源并移除其调度，保留获取与费用记录。
