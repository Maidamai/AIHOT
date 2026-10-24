# 信源与实际运行范围

最后核实为 **2026-10-24 06:23:21 UTC**，见[脱敏摘要](evidence/production-acceptance-20261024.safe.json)的 sourceInventory。它不是实时可用性保证。来源能力、归档启用、模型用途和公开资格是不同层级；注册或归档成功不等于允许付费或全文转载。

## 已启用归档：8 栏目、7 机构

| 栏目 ID（省略 fishery-column- 前缀） | 机构 / 栏目 | 原件入口 | 归档节奏 | 原生普通新闻模型范围 | 最新轮结果 |
| --- | --- | --- | --- | --- | --- |
| moa | 农业农村部渔业渔政管理局 / 工作动态 | [官方栏目](https://yyj.moa.gov.cn/gzdt/) | 每小时 | 是 | success |
| fujian | 福建省海洋与渔业局 / 省局动态 | [官方栏目](https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/) | 每小时 | 是 | success |
| fujian-notices | 同机构 / 通知公告 | [官方栏目](https://hyyyj.fujian.gov.cn/xxgk/tzgg/) | 每小时 | 是 | success |
| jfa-press | 日本水产厅 / 新闻发布 | [官方栏目](https://www.jfa.maff.go.jp/j/press/) | 每小时 | 是 | partial，正文失败 2 |
| itf-fisheries | ITF / 渔业劳动资讯 | [公开栏目](https://www.itfglobal.org/en/sector/fisheries) | 每小时 | 否，仅归档 | success |
| fao-tuna | FAO GLOBEFISH / 金枪鱼市场分析 | [官方栏目](https://www.fao.org/in-action/globefish/species-analysis/tuna/en) | 每小时 | 否，仅归档 | success |
| mpa-port | 新加坡 MPA / 港口通知 | [官方 RSS](https://www.mpa.gov.sg/feeds/media-releases) | 每小时 | 否，仅归档 | partial，正文失败 1 |
| npfc | NPFC / 逐项养护管理措施 | [官方清单](https://www.npfc.int/cmms-pdf) | 每 6 小时 | 否，保留独立专项用途 | 06:17 轮 partial，正文失败 1 |

八栏目均 archive enabled、core fetch disabled，使用专用 archive，避免双采集；06:23 快照 fail_count 均 0、last_error=null、未暂停，current_round=null。partial 保留成功进度和失败待办，不代表全部正文取得；运行页将部分轮记为 failed，不应与列表失败混用。NPFC 此前 fail_count=2 是旧阶段；06:17 自然轮后已为 0、下一轮 12:17 UTC，不能用旧值描述当前。

原生模型 scope 仅四栏目 `moa/fujian/fujian-notices/jfa-press`，首次发现起点仍 `2026-10-21T07:13:00Z`；这不是要求全部材料都付费，仍需当前原件证据、native 用途、非历史、无真实拒发等许可。自动预筛、评分、写作、归组等实际模型请求仍受同一原 ledger、¥10 累计额度、既有端点和容量约束。

## 其他已注册与研究池

- **9 个手工资料来源**用于既有业务指南/原件，例如地方申报、海关、单一窗口、船级社等；它们不是 9 个定时归档栏目，也不加入四源模型 scope。见[历史登记](source-register.md)。
- **IOTC**当前为 isolated，不在八栏目归档配置或原生模型范围；残留隔离测试注册不等于上线。
- **JMA**有本地候选适配/验证与契约文档，未在本次生产启用；[验证](jma-validation.md)、[海警验证](jma-sea-warning-validation.md)、[接入契约](jma-integration-contract.md)属于候选研究。
- **WCPFC、SPRFMO、FRA**等属于历史研究池或业务扩展候选，不能从登记文档推断已生产采集。历史范围论证见[早期研究入口](history/20261020-research-entry.md)。

源站默认摘要及原文链接；unknown 权利状态不表示有全文转载许可。明确 restricted/revoked、许可到期或用途禁止仍阻断；site_fulltext 与全文外发不随“官方源”自动开启。最新源码能力以 [official-columns.ts（固定 3a）](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/official-columns.ts)为参照，实际运行范围以上述生产快照为准。
