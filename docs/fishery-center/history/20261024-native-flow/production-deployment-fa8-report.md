> 历史记录：以下为 fa8 部署及当时未解决的 JFA handover 状态；当前版本和结果以 production-deployment-report.md 为准。

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


# 生产部署结果（2026-10-24）

代码已正常提交、推送并部署。唯一版本为 `fa8eb3d26ba0da128c0686cd9738bb8213249b2f`，远端分支 `Maidamai/AIHOT:feat/fishery-native-flow-v2-20261024`，父提交 `a5a0f8c064d5c82a707af2f170582338bb8ff10e`。原分支未强推或回退。部署收尾完成于 04:36:38Z，最后运行指标观测 04:41:51Z、决定来源观测 04:43:52Z。部署完成不等于已有真实新稿或刊物完成验收。**当前实质阻塞：fa8 的有界 handover 将 JFA 旧系统 supersede 与实质拒绝混同，无法接管该唯一近期旧候选。core 正按授权修复；待新 SHA/manifest 和独立审查后，先副本精确演练，再准备针对性生产接管。此报告仅证明 fa8 当前已部署，不代表 JFA 迁移问题已解决。**

## 实际部署

- 服务器既有 release：`[private-server-or-temporary-path]`。
- API、web、fishery-native、fishery-archive 四个实际容器均为 `fishery-pilot-app:native-fa8eb3d`，镜像 ID `sha256:3f56f434fe12457f52ded6d3a08c76495cd5b60048a0bb51d02342bac3b2e3c4`，AIHOT_RELEASE 全为上述 fa8 SHA，重启次数 0。原 manual 容器正常停止并保持 exited。
- API/web 于 04:31:05Z 启动，native 于 04:31:10Z 启动，archive 于 04:31:13Z 启动。两个 worker 的数据库 heartbeat 分别更新至 04:41:12Z、04:41:18Z，release 均 fa8。Web 自身不写 worker heartbeat，以容器实际 release/镜像和 HTTP 验证为证。
- 镜像内清单 865 个文件逐一 SHA256 验证；web server build SHA256 `7e4088216281e13306692b961348422d19af2d8f69917bd1fc5397bf8b0fd2bd`。
- 只新增执行 `0108_fishery_document_purposes.sql`。指定政策 `5f67141e-47ee-4521-bd66-7e842936c02f` 显式初始化 review_only，原决定/账本保留，不排发布。
- 原 runtime 数据卷 `fishery-pilot_data` 保持；迁移 proof CLI 仅只读挂载该卷。API/native/archive 继续同卷，没有采集写 A、证据读 B 的分叉。
- 原四源自动处理范围保持：fujian、fujian-notices、jfa-press、moa，起点 `2026-10-21T07:13:00Z`。ITF/FAO/MPA 归档启用不代表进入模型范围。累计金额上限 ¥10，未新增 request 数量上限。
- 没有执行 handover；29 个旧普通占位未一把清空。28 个旧 MARA 历史材料保持原状，JFA 因现有 CLI 对旧 rejected 任务的兼容约束，dry-run denied，执行数 0；后续审计确认该旧任务只是系统 supersede，不能称为人工拒绝。原专项配置保留，旧 news 队列在空队列确认后退役，历史回执保留。

## 副本与八源迁移

私有备份在 `[private-release-or-backup-location]`，目录权限 0700；最终停消费者后数据库 dump SHA256 `48494c0d2c43455136a805b946dcc22574508e7f807780aace012ad8ae80faaa`，数据 tar SHA256 `4d70757ef1fac59ce2b3a5ac10a5d41d936904124914a8a783b6003708fd3bcf`。备份未下载到用户可见报告目录。业务库虽名为 fishery_pilot_test，始终按生产库保护，未运行测试 runner。隔离预演仅在独立 `fishery_native_fa8_20261024_task5_test` 副本执行，无外部/模型调用。

八源都已精确比较旧 hash 并完成迁移。需要恢复的 JFA/MPA 在同一次迁移传入原最新 ended round，核实 before/sourceBinding/真实列表 proofs 后再同 runId disable/re-enable，保留 claimed/current/nextAt。NPFC 仅基本迁移，原 fail2 与六小时节奏保持。

| 来源 | 动作 | 列表 proof 数 | 结果 |
|---|---|---:|---|
| fao-tuna | basic profile migration | 0 | completed |
| fujian | basic profile migration | 0 | completed |
| fujian-notices | basic profile migration | 0 | completed |
| itf-fisheries | basic profile migration | 0 | completed |
| jfa-press | recover j-ae8f49f7-c333-41db-a498-540bdf119349 | 5 | completed |
| moa | basic profile migration | 0 | completed |
| mpa-port | recover m-9d6be2af-5e3b-4d76-905e-a8705924333b | 4 | completed |
| npfc | basic profile migration | 0 | completed |

## 读层、门禁和账本

实际统一读层原 13 个 article ID、来源、真实发布日期/发现时间和 binding 逐项相同。当前全部动态可读 13，精选 timeline 0；没有新增 publication 更新，指定政策仍不可读。物理 publication 行数未被冒充为读层数量，MPA 历史日期/用途保留。

公网匿名 HTTPS `/`、`/all`、`/feed/all.xml` 仍 302 至原 `/admin/login`，登录页 200，后台 API 和公开 API 均 401，与 task4 旧门禁基线一致；全部 private/no-store。API/web 对外绑定仍仅 127.0.0.1。PRIVATE_PREVIEW=true 保留，来源许可/全文/对外推送/凭据/安全设置均未改。

原收尾脚本错误地要求回环首页跳至 `/api/auth/login`，曾在服务均已成功启动后因此退出。源码及 a5/fa8 无差异证明 PRIVATE_PREVIEW 仅缓存策略，回环 200 + private,no-store 为现有契约；已记录错误依据，按真实公网门禁验收后只补元数据，未改 auth、未重启、未重复迁移。

截至最后观测，累计账本仍 53 received，真实累计金额 ¥0.699208（699208 microCNY），本次新增模型请求 0，pending/unknown/refused 0，未决预留 0。JS 原账本 hash `441c1764b6ab4d19eb5f611764bd8560391f5e6b3e15504062369acca6733d12` 不变；SQL 规范文本 hash 使用另一序列化算法，为 `5c90c60a37700c9fa1b496edb6931e5ae45dfffd6c008ba3802c82537f46ba93`，两者分别与各自迁前值一致。未发付费探测。

10 个原生 capability 实际路由都经只读非秘密检查解析为既有 deepseek-flash、原官方 endpoint、thinking disabled、reasoning 0、无 fallback、max2048 guard。API key 只证明变量名存在，未声称值非空或有效。实际服务通过既有 Compose 必要注入运行，未另读/复制密钥。

## 首轮真实自然运行与未完成验收

启动后自然计划发生以下归档，没有主动手工新抓取：

| 来源 | 实际 round 结果 | found/new | 状态 |
|---|---|---|---|
| 福建 | success | 5/0 | 完成 |
| 福建通知 | success | 1/0 | 完成 |
| JFA | partial | 5/0 | 列表成功，单篇正文失败 2；job_runs 记录 failed；fail_count=0、pausedReason=null、cursor/成功时间已保留，05:32:28Z 下一自然轮 |
| MPA | success | 1/0 | 完成；正文失败 0，normalCycleVerified=true；仍不进入模型 |

native 两次 content.sweep 均 ok，hot.rank 两次 ok，hot.snapshot、stories.links、ops.recover 均 ok。没有新的 content.analyze/events.group/events.digest 队列任务，因此归组/事件摘要没有真实生产输入可验收。04:41:51Z active/created/retry 总计 0。

四源起点后 core 记录共 38：36 条 backfill，2 条非 backfill。后者均 body ok、无 native purpose，目前实际 eligible=0，扫描均 restricted，不产生请求。精确决定来源并不相同：

- JFA document `aa4e2e7a-67f0-4244-8552-c90f19854928`：旧 prefilter 任务 14eceb9c-e041-4448-aa55-2694c6178d6f 的 decision actor=automatic-dispatch、internalOnly=true，审计995为 fishery.flow.auto_superseded；note明确“Unstarted automatic placeholder superseded by new source evidence; no paid result was rejected.”，draft/quality/results/stage_requests均空。因此这是系统替代旧占位，不是实质审核拒绝。另 queued 占位保持，现版 handover 实际拒绝，未绕过；该兼容迁移边界已交 root/core/reviewer 评估，不能把 denied 本身当成真实人工拒绝证据。
- MARA document `5c4a718f-bb43-475a-b765-246725c0607f`：原 10/22 发布、10/23 发现，旧 score-2 任务7151c72d-ea97-4369-9b22-0235697108ae 的决定来自 authorized-agent:news-flow-correction-20261023，审计512为 fishery.flow.decision，理由明确记录预筛PASS、两次评分42/38未达标且无远洋企业可执行变化，拒绝发布并保留回执。它有 stage_requests/results，属于实质授权审核决定，不能与系统 supersede 混同。保持原拒绝，无修改用途或绕过。

`reports.compose` 确已运行且真实 **failed**（job id133）。原日志底层原因：`daily 2026-10-24: nothing judged in its window`；该刊期原始 scored/non-backfill 候选也为 0。日报没有被伪造成“安静刊期成功”。日/周/月报实际保存及公开目录均为 0；没有首日报，周/月无可汇总输入并未尝试模型。真实新稿、精选、归组、digest、刊物成功仍待四源自然出现合格新消息，不能把本地假服务测试当生产成功。

一次后续临时只读观察容器因自行设 pool=1、并发窗口读等待，已精确停止 `6164af143d53/tender_hertz`（exit137），释放观察连接；实际生产默认 pool=10、四服务未重启。随后改用直接只读 SQL 与已有日志完成根因核对，未调用 compose 重试。

## 安全证据

- `production-preparation/final/deployment-summary.safe.json`：最终部署/STAGE概要。
- `production-preparation/final/final-runtime.safe.json`：实际镜像/flags/loopback/账本/队列与首轮归档。
- `production-preparation/final/production-before.safe.json`、`production-final.safe.json`：13 条逐 ID/date/binding 对照、manifest 和账本。
- `production-preparation/final/production-profiles.safe.json`：8 源逐项实际结果、精确 hash/round/proofs。
- `production-preparation/final/http-final.safe.json`：真实公网基线和错误回环断言修正说明。
- `production-preparation/final/natural-observation.safe.json`、`final-reasons.safe.json`：首轮原生维护、刊物失败、候选守卫与04:41 heartbeat。
- `production-preparation/final/rejected-provenance.safe.json`：两目标决定 actor/internalOnly/note 与对应审计；纠正早先将 JFA rejected 字段误称人工拒绝的判断。
- `production-preparation/model-routing-safe.json`、`final/actual-native-model-routing.safe.json`：非秘密模型路由核验。
- `production-preparation/model-routing-approval.safe.json`：一次拒绝的完整安全记录。

自动审批曾拒绝“一次性路由检查通过 --env-file 加载原 models.env”的动作，理由是验证路由无需读取完整模型凭据。该动作确定未执行，未重试/绕过；按审批明确建议改用非秘密路由变量及 key 变量名存在 boolean 后通过。实际服务的必要 Compose 注入是单独获准的部署动作，正常成功，无剩余凭据阻塞。
