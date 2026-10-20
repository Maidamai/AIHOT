# 渔业素材首期本地模块

实现范围是管理员手工闭环：在已有 source 上登记许可与健康备注，登记文书身份，追加观察，人工审核，导出当前获准的摘要与链接 JSON / Markdown。原有新闻采集、队列、AI行业示例分类和公开出口继续使用原实现；渔业地区、活动维度只在本模块受控字段内。未新增匿名 API、机器凭据、真实抓取、模型/OCR调用或外部调度。

## 数据和审核语义

- `fishery_sources` 引用原有 `sources`，不重复创建信源实体；许可默认 `unknown`，所有用途默认关闭。许可为 `permitted` 需填写核验时间、证据链接和复核期限。健康列表显示原系统 `health / last_fetch_at / last_ok_at / last_error`，并通过现有 `sourceHealth` 扩展提示许可待办；不按一天无更新判死源。
- 文书保存来源、发布机关、源文号（未知为 `null`）、原文 URL、可选 article 关联。没有标题相似自动合并。相同来源同 URL 重复登记返回409；后续在原文书上追加观察。
- 每次手动观察都追加新 revision，即使哈希曾在历史出现；A→B→A 不吞掉第三次观察。原文哈希与每个附件的哈希分别保存，附件单独变化也改变观察内容哈希。`observed_at` 是服务端登记时刻，不充当发布或生效日期。
- **管理员API中的原文/附件 SHA-256 仍是声明值。** 新增离线来源工具可核对本地归档文件与HTTP收据中的hash，但不认证远端HTTP，也不自动采集或批准。 输出 `hashAssurance=admin_declared_not_fetched`。观察的 `content_hash` 和素材的 `contentHash` 则由系统对元数据计算：递归按对象键的字典序排序，数组保持顺序，JSON UTF-8后SHA-256。管理员API不保存原文、正文或译文；schema拒绝额外全文字段。离线工具的正文仅写入用户指定的本地待审目录。
- 发布、通过、生效起止各自保存 `{precision: unknown|year|month|day, value}`，未知不能补日，日不能补时间。`effectiveDateState` 只按显式 `dateComparisonReference` 的 UTC 日比较日期进度，`reached` 不能解释为当地法定生效时刻、当前仍适用或作业许可；当年/当月及更早的年/月精度仍返回 `unknown`。
- 审核追加记录绑定精确 observation revision 和 source revision。新观察、任何来源资料更新、最新审核驳回都会使旧批准失效。`applicabilityReviewed=false` 会原样输出，不伪称全部适用范围已核验。来源许可可未知但仍可登记内部待审元数据；此时导出始终关闭。
- 每次导出都重新检查当前许可、核验时间不在未来、复核期限、来源参与模式、文书撤回和最新审核。关联 article 时经共享 `publication/itemAvailability` 读取层仅允许 `public` 或 `summary-only`；已撤回、删除、未知或其他状态阻断。旧revision不能回读绕过当前限制。
- 只导人工摘要与来源/附件链接、哈希和日期元数据。即使来源登记了全文/翻译许可，输出 `fulltextExport=false / translationExport=false`；许可字段是用途登记，不是已实现对应导出服务。`allowedSummary` 与 `allowedPublication` 都须打开。外部附件链接不等于获准交付原件。
- JSON和Markdown分别以 UTF-8 字节限制为48KiB；超限返回409，不能宣称已成功交给Easel。正文和URL在Markdown输出中转义，来源内容不能授予工具权限。实际Easel模式/上传容量仍待端到端验收。
- 文书撤回为本期终态；观察、审核历史与所有手动变更/导出审计保留，不提供删除/恢复接口。article_id 刻意不级联，普通文章清理不删除档案；关联文章消失后导出关闭。来源FK阻止误删有档案的来源。尚未验证离机备份恢复或建立长期保留SLA。

## 管理员 API

所有路由位于 `/api/admin/fishery/`，复用既有 `adminHandler` 会话与 `no-store`；写操作要求当前 `x-csrf-token`。未登录401，CSRF缺失/过期403，字段错误400，不存在404，过期版本/权利/审核/容量冲突409。没有 `/api/fishery/v1/...` 端点；不提供公开AgentAbility、RSS或MCP证据出口。

| 方法 | 路径（在前缀后） | 用途 |
|---|---|---|
| GET | `sources` | 已登记源、当前许可和原有健康字段 |
| PUT | `sources/:sourceId` | 登记/更新许可；新建 `expectedRevision=0`，更新传当前revision |
| GET / POST | `documents` | 最近100份文书 / 登记文书 |
| GET | `documents/:id` | 文书、全部观察与审核历史（管理员可看未审核元数据） |
| POST | `documents/:id/observations` | 追加观察；`expectedRevision` 须等于当前版本（首条0） |
| POST | `documents/:id/reviews` | `revision, sourceRevision, decision, applicabilityReviewed, note` |
| POST | `documents/:id/export` | `revision, format: json|markdown`；下载并记录导出hash/权利版本审计 |
| POST | `documents/:id/withdraw` | `expectedRevision, reason`；即时阻断后续导出 |

先在既有后台登记 source，保持试点 `enabled=false` 避免自动采集，再登记模块许可。生产来源的真实许可不能照抄测试fixture。登录后可通过现有 `GET /api/admin/me` 获取当前CSRF，使用正常会话调用上述API。本期没有新后台页面，操作界面留后续；请求schema以 `contracts.ts` 为准，最小请求样例见 `tests/fixtures.ts`。

## 离线回放

使用Node24，先按仓库约定迁移一个**独立本地**`*_test`或`*_ci`库。脚本拒绝其他库名和远端主机，创建禁用的合成external源，不访问示例URL、不调用模型、不生成凭据。不要在完整测试正在复制模板库时同时运行demo。

```bash
DATABASE_URL=postgres://aihot_test@127.0.0.1:55437/fishery_mvp_test \
  AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials \
  node modules/fishery/scripts/demo.ts --output /tmp/fishery-demo
```

输出 `fishery-fixture.json`、`fishery-fixture.md`，均标记合成fixture与管理员声明哈希。端口和测试账号仅是本任务临时隔离实例示例，不是部署配置。

## 后续边界

仍未实现：去重前在线抓取hook、HTTP失败/304持久化观察、自动附件下载、生产环境PDF解析与OCR、政策关系/条款证据、完整法律适用性审核、校准后的渔业新闻taxonomy/提示词、实际源批量入库、GUI、机器只读认证、固定清单snapshot/changes/tombstone、Easel拉取及下游处置台账、传播后撤回、真实样本准确率/性能/成本、部署和恢复演练。手工导出不能保证下游已经保存的包自动撤销；使用前须重核，`revalidateBy`只规定最迟复核期限，不保证此前权利不变。

安装：在 `site/modules/index.ts` 与 `server.ts` 注册，`site/package.json` 依赖模块包，Dockerfile包含模块包清单；无Web部分，无需在web清单登记空模块。迁移每个文件一条在线语句，新增表非破坏性；移除清单可关闭模块路由与健康扩展，保留档案数据，不改历史迁移。请勿删除许可/审核记录来“恢复”导出。


## 官方原件离线适配（素材格式0.2）

`scripts/prepare-official.ts`读取已有HTTP收据及响应文件，不自行联网、不加载.env、不查询数据库、不调用模型、不建立调度、不批准或发布。输出capture.json；只有正文可验证时另写body.txt。readyForReview=true仅表示原文可送人工复核，不表示已审核或已获转载许可。第三方HTML/PDF不提交仓库，测试只用最小合成结构。

晋江从.article_time按+08:00读取真实时间，保留sourceCapture.publicationLiteral/publishedAt；仅meta日期时保留day精度。无日期不从URL或事件日期补齐；不从出发港推断企业归属。日期冲突时关闭可用材料输出。

IOTC保留Pending、异议截止、可见通过年份；不把隐藏的1月1日当精确通过日期。PDF和页面的文号、Pending及截止日须一致。捕捞限额条款年份单独记入policyContext.provisionYears，不搬到抓取当年。未核发布日期及effectiveFrom保持unknown，异议截止不是生效日；未映射状态保留unknown和警告。

sourceCapture单列原件hash、获取状态/时间/URL、解析器、页数和正文hash。本机macOS使用现成Swift/PDFKit；其他平台或缺解析器时为unverified，不安装或静默转OCR/付费服务。获取失败、缺失/未核正文、字段冲突、PDF获取/解析不全会被附加导出门槛拒绝，人工批准也不能替代该门槛。原权利、当前版本审核、撤回、publication检查仍先执行。

policyContext/sourceCapture为可选JSON元数据，旧手工观察兼容，无数据库迁移；私有素材导出版本为fishery-material/0.2，无新增公开出口。

```bash
node modules/fishery/scripts/prepare-official.ts --source jinjiang \
  --receipt /path/jinjiang-request.json --html /path/jinjiang.html --output /tmp/fishery-review/jinjiang
node modules/fishery/scripts/prepare-official.ts --source iotc \
  --receipt /path/iotc-request.json --html /path/iotc.html \
  --pdf-receipt /path/iotc-pdf-request.json --pdf /path/iotc.pdf --output /tmp/fishery-review/iotc
```

收据至少含requestedUrl/finalUrl/status/finishedAt/sha256。它们是已归档记录，不能伪造为新请求。--source fuzhou可重放获取失败，不能用搜索缓存补正文。工具不会调用observe/review/export API；人工摘要、用途许可与业务审核仍走既有管理员流程。[本轮验证记录](../../docs/fishery-center/source-adapter-validation.md)。
