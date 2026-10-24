# 3a162 部署完成，正式单条重评等待 Mac 解锁

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


当前生产 SHA：`3a162cb5f30e27a6385d0fb0c1b7227f059028a3`（parent d92），同 feature 分支正常 commit/push，单一改动 `industry/prompts/prefilter.md`。当前没有新版预筛真实调用结果；2/2验证仅本地假模型，不能把 d92 的旧 BLOCK 当新版结果。

## 已实际完成

- 05:44:24Z 四服务 API/web/native/archive 均运行 `fishery-pilot-app:native-3a162cb5`，imageId `sha256:64d3522e244d9775b918695792a695169778d4aa8da385c9ba4c83c31df2381d`，AIHOT_RELEASE 全为新SHA，旧manual停止。最新数据库 heartbeat为05:47:14Z、05:47:17Z，均新SHA。
- 新预筛 `prefilter@f1dd56b576`，rendered systemHash `2d3353d0dd0c0670de5f851d0fd31301e52f34ce2c7a1cab70bb96993c785576`；专项配置仍 `868fbe5dd400e28b8978065bc48bbff465241b6071a79c51f4ede3f488192c7c`，没有专项重新派发。
- 865文件manifest与完整70改动路径committed bytes核验；前端85个复用构建文件逐hash一致，prefilter仅backend运行期fs读取，未进入前端依赖，不需重build前端。副本只变新prompt版本/hash，全部业务、旧54账本、analysis1/receipt46、13读层、政策、MARA、来源/进度/schema均不变；0请求/0worker。
- 正常停native/archive后保存当次最终私有备份，未恢复旧库。DB dump SHA256 `075f631a58ba5fc72447688878f4050608967d33bdb5e62f800217b1e7403c21`，data tar `a7f8939c06f242fe8aadc83706245ff36067c3968d95a7bf3151da53a963959f`，目录 `[private-server-or-temporary-path]`（0700）。
- 最初停后“所有jobs必须空”的守卫命中8个pg-boss内置send-it占位。经真实ID/destination/revision/payload/hash与pg-boss源码核对、root/reviewer批准，仅允许这8个原八源归档created占位原样保留，普通业务/active/未决仍拒绝；不重stop、不删/取消/消费队列。续备份前后8条完整payload相同，新服务于05:44:15Z正常转发完成8个占位，证明原调度继续。安全JSON换行序列化小误差仅修证据文件，原比较/输出已通过，原始序列化另存，未改数据库/服务。
- 没有重复schema迁移、8源迁移/recover、policy初始化、legacy退役或JFA handover。没有调用内部rerun或直接DB重置状态。
- 原13可读ID/来源/真实日期/binding保持；JFA仍blocked，原analysis1/receipt46 hash不变；指定政策仅审不可读、MARA实质拒发保留。四模型信源/原起点/¥10累计上限/私有门禁/全文许可/外发关闭保持。公网登录跳转及API401与原基线一致。

## 当前费用与真实业务状态（05:47:32Z）

累计54 received，账本按真实usage估算 **¥0.735324**，pending=0、unknown=0。原54个entryHashes逐一保持，部署至今新模型请求0。仍只有旧analysis1、旧prefilter@aecb27e420的receipt46；该模型实际BLOCK理由“仅鱼食推广活动，未涉远洋渔业”，内容复核疑似误拦截，未覆写/删除旧结果。

全部动态仍13、精选0，JFA无publication、统一详情not_found、无story/digest；日/周/月刊物仍0，旧日报实际failed原因为 `nothing judged in its window`。当前没有新版评分、写作、归组、发布或刊物正例。

## 准确阻塞与待恢复动作

正常已有管理员会话已通过 Chrome 可见后台页核实，精确目标 `/admin/content/jxr71d4jo1wbyzpbkrob4rwe6`，存在“重新评估”控件。新4服务验证完成后，尝试重评前正常刷新时工具返回：

> The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.

- action：正常Chrome后台重评前刷新；target：现有Mac/Chrome上述精确目标；outcome：**pending manual Mac unlock**。
- “重新评估”与确认均未点击，正式rerun未尝试；最新 `content.rerun.analyze` 审计为空，仍analysis1/receipt46，确定未执行，非未知付费。
- root已请用户仅手动解锁Mac。当前不再尝试解锁/刷新/控件，不改走cookie/password/CSRF读取、evaluate/fetch、内部函数或SQL绕过。该项不是部署再授权。
- 用户解锁并由root通知后，仅恢复正常可见控件的一次目标Analyze和一次必要确认，应用自带会话/CSRF/idempotency；后端审计安全核实际requestId/actor/jobId并与新SHA关联。结果未知先查审计/queue/receipt，绝不重复点击。

若后续正常重评得到可读新闻，按实际selected/timeline/visible_after与arrival/release较晚时点进入真实刊期；不塞进10/24北京08:00已过截止窗口、不改日期/visible_after、不为演示强制补刊。真实新版判断仍可能BLOCK/低分/失败，不能预设发布/精选。

## 证据

- `production-preparation/prefilter-final/deployment-before-rerun.safe.json`：4服务/版本/旧状态保护完成marker。
- `production-preparation/prefilter-final/production-before.safe.json`、`production-prestart.safe.json`、`production-before-rerun.safe.json`、`runtime.safe.json`、`http-final.safe.json`。
- `production-preparation/prefilter-final/internal-schedules-before.safe.json`、`internal-schedules-after.safe.json`、`internal-schedules-preserved.safe.json`。
- `production-preparation/prefilter-final/ui-pending-unlock.safe.json`：当前审计/费用/target、原8调度完成及精确Mac锁屏阻塞。
- `production-preparation/prefilter-preview/preview-summary.safe.json`：零调用副本结果。
- `verification/prefilter-fix-commit-manifest.json`（SHA095759…52d1e）；完整70路径manifest（SHA4f5ebd…01761）。
- d92实际旧模型及单目标内容核查见 `production-deployment-d92-report.md`，其原字节SHA256 `1a6f769318c08619d789a40ebbcf49160fca12dc6ba7b45f3003cbfec2985f03` 保持。该阶段证据不会覆盖为新版结果。

历史一次完整凭据文件路由诊断被自动审批拒绝，确定未执行/未重试，已用允许的非秘密安全替代完成核验；本轮没有重复该动作。当前部署无凭据或审批阻塞，唯一待恢复动作受Mac锁屏阻塞。
