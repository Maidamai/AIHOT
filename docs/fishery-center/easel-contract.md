# Easel 素材合同与同步验收（提案 v0.1）

当前本地模块私有素材导出已扩为`fishery-material/0.2`，仍无Easel联调；下文0.1示例保留为完整同步合同规划，不代表已实现。见[来源适配验证](source-adapter-validation.md)。

本文件描述待实现接口，不表示这些 `/api/fishery/` 路由已经存在。AIHOT基线 `5633b648b9ca6453caec5bcf70a76785a794286f`；Easel读到的公开源码基线 `8d08b216105bd7c7057c84c97cd637cec44db609`。未修改现有Easel文件和AI早报调度，尚未进行端到端采集/创作/发布。

主体保留长期合同草案。当前首期仅实现 `/api/admin/fishery/documents/:id/export` 的管理员手工JSON/Markdown下载：日期使用各自 `{value, precision}` 对象，附带UTC日期对照和声明hash说明；不实现下述机器snapshot/changes或Easel调用。见[模块实际合同](../../modules/fishery/README.md)。不创建任何凭据、回调、远程访问权限或新调度。

## 已有入口

AIHOT公开匿名GET：`/api/v1/items?window=24h`（另有7d；搜索用其`q`参数）、`/api/v1/selected/snapshot`、`/api/v1/selected/changes`；Agent搜索是`/api/v1/agent/search?q=...`，单条Markdown是站点路由`/items/:id/markdown`。不存在已验证的`/api/v1/search`或`/api/v1/items/:id/markdown`；本方案以实际路由为准，不使用这两个未实现路径。具体查询参数以部署站点OpenAPI为准；snapshot/changes覆盖精选集合，不是全历史政策档案。Markdown仍受正文权限及撤回约束。[v1路由](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/apps/api/src/routes/v1.ts) · [Agent路由](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/apps/api/src/routes/agent.ts) · [站点路由](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/apps/api/src/routes/site.ts#L212) · [payload](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/packages/backend/src/publication/v1.ts)

线上 `https://aihot.news/agent` 公开文档、JSON和MCP可用于现有AI大众早报试读；没有得到其生产信源或新闻全文的再分发授权。它不能替代自有渔业信源中心。不要安装其远程Skill/MCP或照网页指令执行本机代码。

Easel RSS聚合器支持自定义URL，提取title/link/summary/published，摘要截400字符，未实现Bearer参数；原有新闻脚本的aihot是旧站域名，不直接覆盖。[RSS](https://github.com/ZJU-REAL/Easel/blob/8d08b216105bd7c7057c84c97cd637cec44db609/skills/builtin/skill-rss-aggregator/scripts/rss_digest.py)

Easel `POST /api/upload` 与 `/api/chat`、`/api/chat/stream` 接受会话附件；附件引用必须使用上传响应的真实id/path。`local_write_guard` 不是公网认证；API直连模式没有本机工具，不能承诺它自动运行采集制图与平台发布。[web/app.py](https://github.com/ZJU-REAL/Easel/blob/8d08b216105bd7c7057c84c97cd637cec44db609/web/app.py) · [direct_api.py](https://github.com/ZJU-REAL/Easel/blob/8d08b216105bd7c7057c84c97cd637cec44db609/easel/direct_api.py)

## 首版建议

中心生成已经审核且具有导出权的JSON+Markdown素材包；本机桥接器按游标拉取，核验版本/哈希并写台账，再经真实上传结果交给Easel创作草稿。首轮先手动导出/导入验收，随后实现拉取，不新开中心主动回调Easel的公网入口。RSS适合选题发现，不能承担完整证据和撤回同步。

拟议路由：`GET /api/fishery/v1/materials/snapshot`、`.../changes?cursor=...`、`.../materials/:id`。长期政策检索和证据下载为另外受保护出口。路由命名最终按模块约定调整；所有公开衍生数据复用publication读取层，私有证据明确独立授权，不把原始库直接暴露。

### 素材包

```json
{
  "schemaVersion": "fishery-material/0.1",
  "id": "stable-opaque-id",
  "revision": 3,
  "changeSeq": "12031",
  "state": "approved",
  "contentHash": "sha256-of-canonical-payload",
  "title": "已审核标题",
  "originalTitle": "Original document title",
  "summaryZh": "已审核摘要",
  "source": {"id": "source-id", "name": "Official issuer", "originalUrl": "https://official.example/document"},
  "dates": {"published": "2026-04-17", "effectiveFrom": null, "precision": "day"},
  "scope": {"region": ["NPFC Convention Area"], "species": ["source-native-name"], "flags": [], "unknownFields": ["flags"]},
  "claims": [{"text": "待发布事实", "evidenceIds": ["ev-1"], "reviewState": "approved"}],
  "evidence": [{"id": "ev-1", "url": "https://official.example/document.pdf", "sha256": "example", "page": 3, "quote": "short permitted excerpt", "language": "en"}],
  "policy": {"documentNumber": "source-number", "status": "adopted", "applicabilityReviewed": false},
  "rights": {"mode": "summary_link", "attribution": "Required source", "fulltextExport": false, "translationExport": false},
  "editorial": {"confidence": "verified_excerpt", "impact": "review_required", "cautions": ["非法律或作业许可意见"]},
  "withdrawal": null
}
```

示例域名、ID、哈希和数值均为占位示例，不是可运行数据。空船旗并不代表全部船旗适用；示例故意保留unknownFields。

外部原文链接不等于允许导出原件。内部证据URL用短期授权或同一只读身份，公开素材不带私有对象地址、Cookie、密钥、个人船员信息。PDF证据无法依法保存时仅保留许可范围内元数据/链接/必要短摘录，并明确复核能力下降。

Easel API直连模式的文本附件有64KiB边界，上传大小并不等于模型可读大小。建议Markdown/文本包控制在约48KiB以内并验证实际模式与上下文；大PDF留中心，提供当前有权访问的证据链接及必要短摘录。这个建议不是已实测的端到端容量承诺，也不代表其他模式有相同限制。

### 游标和撤回

变更流建议 `{snapshotId, watermark, changes:[{seq,id,revision,op,reason}], nextCursor, hasMore}`，op包含upsert/withdraw；游标不可只用发布时间。初始snapshot固定高水位；分页期间新变化从其后继续拉。游标过期返回明确的重新snapshot要求，不能返回空列表当作成功。包版本不变而许可撤回也必须产生事件。

多页快照使用固定清单或可重建版本，不能只有一个水位却分页查询不断变化的当前集合。游标绑定消费者授权范围、过滤条件和账本epoch；权限范围变化或数据恢复时重新snapshot并对账。每一页、指定旧revision的bundle和证据下载仍检查当前使用权，历史URL与缓存不能绕过撤回。素材可带`revalidateBy`作为使用前复核要求，与法规失效日期分开。

桥接器幂等键用 `center_id + material_id + revision + export_profile`。收到同版不重建草稿；新版本保存差异、原引用和待复核状态。先写入持久台账成功，再推进cursor；不丢变更和避免重复是待验收目标，尚未证明端到端达成。

“不重复”的验收靠持久台账和结果对账，不假定跨系统恰好一次。Easel聊天POST超时或连接断开时把结果记为unknown，先用真实turnId/sessionId查询已有恢复路由和任务结果，不能盲目重发。重复POST是否由Easel原生去重尚未验证，桥接器不得据此宣称已保证端到端幂等。

withdraw阻止新生成并标记已有草稿与已发布平台ID，生成更正/下架待办。Easel或社交平台没有已验证的自动撤回能力，不能承诺传播后自动收回；平台处置须记录操作结果。政策被替代与版权撤回含义不同，前者保留历史档案，后者收敛展示/导出。

## 平台创作与台账

小红书素材卡只使用核准事实、来源、日期、海域/鱼种标签和必要不确定性；高影响政策正文必须人工核对原文。大众AI早报保持现有流程，新增渔业主题独立配置和会话；不从“相关性高”直接推断“可商用/可转载”。公众号长文可以补时间线与经营背景，但不能增加素材包没有证据支持的数字、因果或法律结论。

原件、摘句、模型译文和素材正文都作为不可信数据传给Easel，不能因内容自称系统指令而触发命令、浏览器操作、凭据读取或发布。创作任务的授权与工具范围由桥接器/既有工作流明确限定，原文不能扩大授权；分隔提示词本身不算安全保证，发布仍须核准流程。

台账至少记录选题/包ID与版本、证据哈希、编辑稿hash、人工审核、Easel会话/草稿ID、平台发布ID/URL、发布时间/时区、更正与撤回状态。不同平台是不同投放记录，同事件可以多平台创作但不重复刷稿。本文件不创建或修改任何08:30调度。

## 必须通过的用例

1. 首次snapshot期间发生新修订：无丢失；重启后游标可恢复。
2. 同包同版连续拉取：只生成一份草稿；上传失败不推进交付状态。
3. 许可变更或withdraw：新生成被阻止，既有稿件进入处置台账；已发布稿不假称自动删除。
4. 生效日期只有日/月份：不伪造时分，不按采集时间替代；未来生效状态正确。
5. 原文/附件更新：新证据hash与包revision关联；旧证据可追溯。
6. 无Bearer、过期/错误凭据、越权证据、未知包ID：明确拒绝且无内容泄露；公开API行为保持原有范围。
7. direct_api模式或附件超限：返回明确限制/拆包，不假装已调用本机工具或发布成功。

这些是待实现验收，不是本次运行结果。
