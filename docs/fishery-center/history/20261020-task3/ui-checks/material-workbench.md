# 素材工作台（内部试运行）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


入口为现有后台导航的“渔业素材”，路径 `/admin/fishery`；详情 `/admin/fishery/:id`，沿用现有管理员会话、CSRF和no-store规则，没有另一套应用或新增依赖。

## 日常操作

1. 默认看真实原件素材；“测试演练”单独显示合成许可和测试审批副本。隔离环境里的真实原件也不等于正式业务批准。
2. 列表可按标题、机构、文号、链接和状态筛选，目前范围为最近100条，页面明确标出这个上限。展开“来源与最近获取”看HTTP响应、解析状态、获取时间、许可版本和自动采集状态。
3. 详情先核对原始URL、获取方式/时间、发布日期、通过/生效日期、适用范围。事件日期未建立独立记录时明确为未知，不从其他日期推断。IOTC Pending的异议截止不是生效日。
4. 已存文本仅以纯文本显示，核对其与最新观察的哈希；不渲染原始HTML。不匹配或没有文本时明确说明。附件展示来源链接、哈希、页码和解析器版本，不暗示已经取得第三方转载许可。
5. 审核通过、拒绝、撤回都要填写原因和确认版本。对话框绑定打开时的观察与来源许可版本；变化后不能自动审批新版本。法律适用性仍不由本页面判断，撤回后本页面不提供恢复。
6. JSON/Markdown只在后端最新门禁允许时可申请下载；后端再次核对，页面无法放行。拒绝、撤回、缺正文/未核验、许可未知/过期、观察或许可版本变化均给出具体阻断原因。返回页面、窗口重新聚焦及操作后重新读取状态；并发变化最终以提交时后端判断为准。

本页面不提供许可编辑、正文编辑、新建素材、采集按钮、模型处理、批量发布或自动投递。现有采集CLI和管理员观察API仍是输入路径；没有虚构这些尚未提供的界面能力。下载后的离线文件不能远程召回，每次使用前须重核。

## 实时与回放标记

`sourceCapture.acquisitionMode`区分`live_capture`、`archive_replay`和旧记录的`unknown`。`prepare-official.ts`默认归档回放；`capture-official.ts`传入实时模式；验收CLI按真实输入方式传递。实时GET失败仍是实时失败收据，不代表取得正文。警示文本按模式生成，不再统一写“Offline archive only”。标记是归档来源说明，不是远端签名或许可。

既有服务器记录修正时，不重新获取来源，不修改原件和HTTP收据，也不改写旧观察。保留旧prepared元数据备份，再由相同原件生成带正确模式的新prepared结果，并为未审真实主记录追加未审观察。已有审核不会因模式修订自动沿用。

## 验收与访问边界

本轮使用本任务已有Mac隔离预览进行真实浏览器操作：列表/搜索、404阻断、测试副本拒绝与审批、两种实际下载、仅解析器版本变化导致旧审核失效、重新审核与撤回；390像素列表/详情无页面横向溢出。原件主记录不审批，测试副本有醒目标识，导出保留隔离测试警示。

服务器仍是独立`fishery-pilot`项目：服务器上的`http://127.0.0.1:39871/admin/fishery`，API在服务器回环39872，数据库不映射宿主端口。这个localhost不是用户电脑的localhost，公网地址不提供该后台。终端可通过已授权SSH访问服务器后检查这些回环地址；从用户电脑浏览器查看，需要另行提出并获批临时SSH本地转发。本轮不擅自建立隧道、公开端口或持久凭证。

完整服务器启停与回退见[server-pilot.md (local original; provenance)](../../../provenance/source-manifest.json)。UI写动作测试与远端回环HTTP验收分别记录，不能把本地浏览器结果冒充远端浏览器实测。
