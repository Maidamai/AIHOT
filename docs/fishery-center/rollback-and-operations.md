# 部署、回退与数据保护入口

本文归档截至 2026-10-24 的机制和结果，不是要求重新执行部署或测试。最后业务 release 为 3a，文档归档提交不是新生产部署。

- 机制说明：[仓库部署文档](../deploy.md#远洋资讯原生流程迁移2026-10-24)。旧普通新闻派发/消费退役，专项保留；full/native/manual 共用处理租约，archive 为独立来源租约。
- 已执行的分批方案：[fa8 原生切换计划](history/20261024-native-flow/production-rollout-plan.md)、[d92 单 JFA 精确迁移](history/20261024-native-flow/jfa-incremental-rollout-plan.md)、[3a 提示词增量计划](history/20261024-native-flow/jfa-prefilter-incremental-plan.md)。这些是历史操作计划，不能因为命令可见就重复执行。
- 最终结果：[3a 生产报告](history/20261024-native-flow/production-deployment-3a162-final-report.md)及[当前状态](current-status.md)。原源码与配置范围、原 13 条、MARA 拒发、指定政策仅审和旧回执/费用保持。

## 回退约束

1. 出现用途误放、证据错配、重复计费或账本不连续时，先停止对应消费者领取，排空或核实在途请求，再释放原处理租约；不能同时开两套消费链。
2. 兼容旧版本的代码回退不意味着回滚业务数据。保留本轮新增 observation、analysis、receipt、audit 和累计 ledger；**不能恢复旧库清掉已发生费用或覆盖自然新增记录**。
3. 生产备份原件及位置保持私有，仓库只记安全摘要与原件校验；本次未复制 dump、数据 tar、凭据或其配置。历史报告中的私有路径已脱敏。
4. unknown 或拒绝请求不自动换身份重发；先核实账本与真实回执，再通过已有显式流程恢复。只读观察不是新部署、抓取、compose 或付费授权。
5. 普通新闻不恢复双人工审批，专项及明确拒发也不因回退而自动公开。政策固定 review_only，真实日期与鉴权边界保持。

已核实停消费者备份和受控切换；**完整生产恢复演练尚未完成**，不把有备份文件说成已经验证可恢复。容量、来源、全文、外发权限仍使用原授权，不因归档文档扩大。
