本轮已完成安全修复并部署，版本 `2563192f14728ec04933166115bba032d11716f3`；本地、origin分支与服务器一致。部署时间2026-10-23 02:13:09UTC。站点 https://fishery.conchterm.top/ 继续私有登录，原站正常。

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../../current-status.md) and [source/hash inventory](../../../../provenance/source-manifest.json).


修复包括：

- PDF逐页无提取文字时阻断处理，旧指南创建/核查/读取也受共享证据门禁约束；不宣称能识别所有图像遗漏。
- NPFC已确认附件URL/有效PDF字节变化使旧审核失效；404/超时只记不可用，文号/日期等语义冲突不掩盖已验证依赖变化。原始矛盾与历史证据保留。
- 冻结批次原子幂等，旧A重放不回滚B；新捕获A仍可形成新版本。
- 每次flow执行拥有UUID，阶段及失败写回CAS隔离旧执行者；已收到响应仍独立结算，重启复用回执。
- 福建网页及多PDF来源分段，页码/URL/hash绑定；最终合格读者引用第二附件时链接第二附件。
- 原站RSS/v1/Markdown读取时带截止/失效/未知状态；保留批准原摘要与原证据。

源码入口： [证据目录](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/evidence.ts)、[NPFC归档](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/column-batches.ts)、[批次导入](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/import-batch.ts)、[事务幂等](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/store.ts)、[执行隔离](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/flow.ts)、[读者证据](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/reader.ts)、[发布投影](https://github.com/Maidamai/AIHOT/blob/2563192f14728ec04933166115bba032d11716f3/modules/fishery/backend/publication-bridge.ts)。

最终验证：后端1159/1159，浏览器75/75，类型/构建通过，线上30项smoke通过。精确测试版本及干净工作树记录见RESULT；中间失败和测试启动脚本错误也保留在test-history，不计为通过。gpt-6-astra只读复审固定2563192未见限定范围剩余缺口，静态审查不代替动态测试。实现使用原生隔离工作树/6.1-sol执行，根任务单点集成部署；未声称外部真人专家参与。

真实归档零GET复核7项：福建0ready、1解析但不相关、3待解析复核；没有新增素材文档/合格文章。NPFC3项提取页数22/11/40，可作待审候选，未批准为法律或航行指令。每页有文字不证明扫描图像全部读取，Office附件/扫描页仍缺可靠提取。

农业部正常小时轮01:55:20—01:55:26自动完成，1去重、0新增、0自动AI派发。下一轮02:55:26UTC。NPFC六小时计划保留，下次06:12:36UTC，尚未观察完整正式6小时轮；此前两轮为临时60秒/max2真实调度验证。福建定时未开启；JMA未合并启用；IOTC持续停用隔离。来源覆盖仍有未遍历部分，不把来源目录数量当采集器数量。

合格阅读投影仍13项；生产实测9指南的v1/RSS/Markdown提示均存在，申请资格和法律效力保持unknown。新增DeepSeek调用0，累计33次、估算0.486372元、未决0，10元硬限未重置。

备份 `[private-server-or-temporary-path]` 留在受保护服务器；回滚镜像 `fishery-pilot-app:original-9acbd92`。未执行回滚。需要回退时只回退代码/现有配置，不恢复旧数据库、账本、游标。暂停/恢复使用既有来源采集管理流程，未决付费请求不能盲重试。应用API/Web回环，数据库未映射主机端口；未改变公网权限、凭据和匿名发布开关。

本包只含脱敏验收元数据和检查摘要；不含密钥、原始数据库、私密配置、正文附件、浏览器会话或源码部署包。完整原始测试日志保留本任务目录。
