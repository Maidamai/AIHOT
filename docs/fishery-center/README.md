# 远洋渔业资讯：当前事实与文档入口

本目录汇集本项目方案、原版对照、实施交付、生产验收和历史记录。**当前事实统一从 [current-status.md](current-status.md) 读取**；截至 2026-10-24 06:17—06:23 UTC 的快照，不代表之后的实时状态。

| 入口 | 内容 |
| --- | --- |
| [当前状态与剩余验收](current-status.md) | 源码、推送、部署、真实模型与刊期结果分开列示 |
| [信源与实际范围](sources-and-scope.md) | 8 栏目 / 7 机构、4 栏目原生处理，归档与模型权限分开 |
| [当前设计依据：原生流程 v2](history/20261024-native-flow/AIHOT-native-flow-implementation-plan-v2-20261024.md) | 普通资讯走原引擎；取代 v1 普通审批方案 |
| [实施交付](history/20261024-native-flow/implementation-delivery.md) | 行为差异、代码入口、验证与真实效果边界 |
| [最终生产报告](history/20261024-native-flow/production-deployment-3a162-final-report.md) | 3a 部署、JFA 单次重评发布、自然平静日报 |
| [轻量验收证据摘要](evidence/production-acceptance-20261024.safe.json) | 只收必要字段，不收业务库、完整账本或凭据 |
| [本地验证汇总](history/20261024-native-flow/verification/summary.md) | 全量与后续小改分开；合成模型与生产结果分开 |
| [部署及回退说明](rollback-and-operations.md) | 既有机制入口、数据/费用保护和当前边界 |
| [历史及取代关系](history/README.md) | 早期研究、task-2/3/4、v1/v2、fa8/d92/3a 阶段 |
| [来源、去重、脱敏与校验清单](provenance/README.md) | 原件 hash 与入库副本 hash 不混用，未收录证据说明 |

固定开发目录为用户指定的 `/Users/choco/workplace/AIHOT`，开发仓库为 [Maidamai/AIHOT](https://github.com/Maidamai/AIHOT)，`origin` 指向它；“原项目 / 原版 / 上游”仅指 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，对应 `upstream`。不将上游未评审改动自动合入业务分支。

这次归档只提交文档；文档提交本身不代表新源码部署。最后核实的业务源码与生产 release 均为 [`3a162cb5f30e27a6385d0fb0c1b7227f059028a3`](https://github.com/Maidamai/AIHOT/commit/3a162cb5f30e27a6385d0fb0c1b7227f059028a3)。临时原件全部保留在本地，没有搬走或删除。
