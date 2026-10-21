# 人工业务指南（管理员内部）

人工指南使用独立的 `fishery_business_guides` 表，类型为 `business_guide` 或 `policy_reference`，沿用十主题配置。现有动态文章继续使用旧reader，不自动转换为指南。创建、编辑、审批和读取均不创建AI任务、回执、费用或调度，不更改模型提示词、原文审核、来源许可或公开投影。

根会话在现有fishery模块的HTTP安装函数内调用 `registerBusinessGuideRoutes(app)` 后启用以下路径，均使用现有 `adminHandler`；GET无需CSRF，POST/PUT要求真实管理员会话的 `x-csrf-token`。独立分支没有修改server.ts或前端。

| 方法 | `/api/admin/fishery/` 后缀 | 用途 |
|---|---|---|
| GET / POST | `business-guides` | 管理列表 / 创建草稿 |
| GET | `business-guides/context/:documentId` | 当前可编审原文、证据目录和快照 |
| GET / PUT | `business-guides/:id` | 管理详情 / 保存新草稿版本 |
| POST | `business-guides/:id/decision` | 明确批准、拒绝或撤回 |
| GET | `business-guides/:id/history` | 既有audit_log中的完整前后记录 |
| GET | `business-reader?topicId=&kind=&page=` | 统一当前有效内部阅读集合及十主题数量/待补状态 |
| GET | `business-reader/:id` | 同一集合中的详情 |

输入及响应类型在 `business-contracts.ts`。所有有值字段绑定当前证据目录ID；程序将ID定位为完整连续引文、段落和PDF页码，不接受用户自写quote或页码。日期须在同一选中引句中具有完整ISO或中文日期字面；目前其他日期写法保留unknown供人工，不用网页发布日期补政策生效/申报日期。源网页发布日期、原始时间字面和采集时间从观察独立返回；`verifiedAt`只由服务器人工批准时生成。

办理入口只接受当前原文引句明确写出的安全HTTPS URL，不根据来源URL或重定向猜入口。原文只有HTTP平台或未核实具体事项时保持unknown，可在有引证的材料说明中忠实记录平台文字；不全局放宽linkSchema。关系type为amends/repeals/interprets/supersedes；标题必须原文出现、URL未知为null，修改不等于整体废止。关键词与否定校验只是确定性边界，连续引文存在不证明摘要语义、官方属性或法律适用性，人工必须阅读全文和限定条件。

普通素材必须为当前观察/来源版本的最新approved，未撤回且有完整parsed sourceCapture。统一source-body helper读取旧栏目或manual_official归档；仅旧无归档记录保留既有article正文回退，再核对body SHA和完整PDF页标。若有关联article，还须当前available。合成fixture标识不进入业务读取。

快照绑定source/profile版本、观察/正文/raw SHA、目录算法/hash、关联article/原文URL，以及普通素材最新review的ID/hash。普通素材同版本先拒绝再批准，也不能复活旧业务批准。source/观察/权利/审核变化、实际正文损坏或源/指南撤回均立即不进入统一列表、数量和详情。编辑重置draft与核验时间；每次编辑/决定递增revision并做CAS。批准还必须匹配payloadHash和snapshotHash；拒绝/撤回允许关闭已经失效的旧记录，无需伪造当前可读context。withdrawn不可恢复，历史完整payload/快照/人审保留在既有审计表。

内部短信息允许保持来源rightsUnknown，沿用现有私读语义；不套要求公开转载许可的exportBlockers，也不授予全文、导出或公共发布权限。私读响应不含内部人审reason/actor或完整正文，仅返回所选引文、来源和版本。申请/捕捞资格始终为null，未知字段保持unknown。无敏感原件上传、代提交、预约、招聘或救援承诺。

验证使用独立本机55437、aihot_test角色、`fishery_business_guides_test`及runner副本。八项DB测试覆盖创建/审批/编辑/历史/撤回、快照CAS、素材拒绝再批准、观察/来源/原件变化、未知日期及入口、manual归档和PDF页码、关联article不可用，以及匿名401/写操作CSRF403。鉴权正例使用仓库既有隔离测试身份；生产真实浏览器登录验收由根会话统一执行。测试不发送外部请求或模型调用。
