# JFA 系统占位兼容修复：增量发布步骤（待新 SHA）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


状态：仅本地准备。当前生产仍为 fa8，未对生产重试 handover、改用途、停进程或构建新镜像。必须收到 core 正常 commit/push 的精确新 SHA、manifest 和 reviewer 通过通知后才执行以下准备。唯一部署执行者仍为 native_ui_ops。

## 范围与固定目标

- 只修有界 handover 对有匹配审计、未付费 system-superseded 旧任务的识别；不改日常 permit。
- 唯一目标 document `aa4e2e7a-67f0-4244-8552-c90f19854928`，article `jxr71d4jo1wbyzpbkrob4rwe6`。
- 两任务：旧 `14eceb9c-e041-4448-aa55-2694c6178d6f`（system supersede，audit995）、当前 pristine queued `c3b0c9c6-ff9e-4ca4-a72c-f7ad79d8b79d`。任务状态、capture 和 audit 必须重新核对，不能只凭本文件旧快照执行。
- MARA document `5c4a718f-bb43-475a-b765-246725c0607f` 有实质授权拒发/付费筛选，始终保留。指定政策仍 review_only 不可发布；MPA 历史与日期保留。
- scope 保持 fujian、fujian-notices、jfa-press、moa，createdAfter=`2026-10-21T07:13:00Z`。原累计账本 ¥10 上限，最新已核 53 次/¥0.699208；不改凭据、路由、许可、全文或外发。

## 1. 精确版本与旁路镜像

1. 收到新 SHA、正常推送证明、review 通过及定向测试记录，保存安全接受记录。核 git parent/ancestor 为当前 fa8，diff 只含批准的 handover、既有 materials 测试和部署说明；若出现其它运行行为或前端输入变化先停该准备。
2. 以 git show 精确导出新 SHA 的运行源文件，不复制工作树未提交内容。只在 task5 保存新 release 包，不另开集成仓库。
3. 前端源码/站点/行业/contracts/模块前端与 fa8 必须 Git tree 相同。复用已验证 web build 的全部 85 个文件，每文件重新 SHA256 与 fa8 RELEASE.json 比较，不能只比单个 server 文件；生成新 RELEASE.json，分别记源 SHA 和复用 build 来源。
4. 旁路 Dockerfile FROM 已部署 fa8 镜像，锁定其 imageId，--pull=false --network=none。新 tag/release 目录均含新 SHA 短号；逐文件验证新源 manifest、85 build hash、镜像 label/AIHOT_RELEASE。不得覆盖 fa8 release/tag/备份。

## 2. 隔离副本精确演练（零外部调用）

1. 只做生产在线私有快照用于副本；0700 新备份目录、新 `_test` DB、新 data 副本卷，名字含新 SHA。不覆盖已有备份/库，不运行测试 runner。生产名称 `fishery_pilot_test` 仍是业务库，绝不因后缀作测试库。
2. 新镜像预演只给副本 DB/data；所有采集/模型/外发阀 false、不注入模型 env 文件/凭据，不启动 worker，不调用 compose/report/group 等业务动作。所有多步骤远端脚本先上传私有文件，再 bash 文件；不靠 SSH stdin，命令无输入时显式 `/dev/null`，每阶段 marker 回读。
3. 保存副本 before：实际13 ID/source/published/discovered/binding；policy/task/purpose；MARA task/paid evidence；账本完整安全 hash、条数、金额、pending/unknown；JFA 两任务/匹配 audit/capture 当前 revision、hash、body identity、article dates/backfill/state；scope 与8源 profile/config 指纹。
4. 对 JFA 新 CLI 默认 dry-run，证明只移除/接管指定未开始任务（实际分类/数量以新实现 DTO 为准），不改变库；再只对这个 document `handover --execute`。无 dispatch。匹配 audit 保留，新增 handover 审计可回溯旧任务；当前 purpose native 与原 capture/body 绑定，日期/文章身份不变。
5. MARA 默认 dry-run 仍明确拒绝（不可执行）；policy 仍 review_only，指定政策发布不可读。13 读层与账本严格连续、source rights/scope/8源配置不变；没有模型/HTTP外部请求；receipt/analysis 不新增。若新版本幂等 dry-run 对已 native 返回拒绝，按其明确定义验收，不绕过。
6. 不再执行 migrate、0108 初始化、initialize-review-only、八源 profile/recover、retire-legacy。副本保存 before/after/CLI 结果及严格断言 summary，供 root/reviewer 只读核对。

## 3. 副本通过后的生产精确动作（待具体脚本审查）

1. 先读当前实际账本/队列/目标版本。正常停止 native 领取并等待在途排空；archive 也正常停止，以冻结该 JFA capture/current round 和备份文件一致性，API/web 保持服务。停止后确认处理租约释放、无未决付费/active job、JFA exact两任务和匹配 audit/capture 未变化；有新自然数据则按新事实更新快照，不能恢复旧库覆盖它。
2. 新0700 final目录保存最新 DB dump（pg_restore -l 核验）与同数据卷归档、原 release/服务非秘密元数据及 before 安全快照。保留当前新增数据和累计账本；不恢复任何旧生产 DB。
3. 新镜像连接业务库、原 data 只读、MODEL/COLLECT/外发 false、无凭据 env 文件。先仅 JFA dry-run 与副本相同，断言通过后仅该 ID `handover --execute`（CLI 自己持同 processing lease）。不改 scope、不 dispatch、不重迁移。
4. 迁后立即验 capture/真实日期/13读层/policy/MARA拒发/账本/8源进度与 before 一致，唯一预期差异为批准的2任务迁移处理、native purpose 和新增 handover audit。失败停在具体 marker，保留已发生事实，不自动恢复旧库或盲重启。
5. 用精确新镜像重建必要 API/native 容器，所有被替换服务 AIHOT_RELEASE 必须新 SHA；可统一 API/web/native/archive 新镜像以避免长期混版（web build 已逐hash证明相同）。沿原 Compose 必要凭据注入，不做额外 credentials 检查；若该实际动作被自动审批拒绝则准确报告并停该动作。
6. 新 native 启动会立即自然 tick，并非只读。故生产 handover 后首次启动即可能在原四源/金额上限内发真实模型请求。停止/备份/验证已完成后再启动；archive 恢复原同runId/cadence，不重复配置。
7. 正常首 tick/下个5分钟 sweep 可自然领取指定 article；只读观察真实 prefilter/score/.../publication/group/digest/edition/receipt/金额/unknown。如果需要显式 dispatch，只能该 ID，先把实际队列/eligible 及理由交 root/reviewer，不能在启动和自然领取并行时重复手工排队。迁移阶段账本必须与当次停取最新快照完全相同；模型自然运行后允许累计增加，改验原 entries 前缀逐条不可变、新请求有对应 receipt/结算、总金额与未决预留不超过原 ¥10、unknown=0，不能硬把总数53或整体账本hash不变作为运行后条件。

## 4. 验收与回退边界

真实模型可能正常判噪声或失败；必须按回执和读层报告，不能预设必发稿、不能绕过阈值/真实拒发。日/周/月目前0及首日报 failed/no judged 是迁前业务状态，不冒充修复成果。新 JFA 真实模型结果出现后再按真实刊期观察。

应用回退可正常停新 native、保留最新账本/收据/数据、切回已知镜像并保持处理停用待评估；若 handover 已写 native purpose，不恢复旧 DB、删除审计或回滚累计费用。fa8 日常 permit 未变，对已正确 native purpose 的行为应由副本证明；任何兼容风险先报告具体 target/reason/outcome。

现阶段只准备以上计划和本地 package 脚本；尚无新 SHA，未进行旁路构建、副本创建或生产动作。

## 实际执行结果

d92精确副本与生产单JFA接管均已完成。4服务d92、原13和原53账本前缀保持；自然首次模型实际BLOCK，新增1次/¥0.036116，累计54/¥0.735324，unknown0，未进入发布。内容事实复核及独立review提示疑似误拦截，不能称正确过滤，不重试或强放。完整安全报告见production-deployment-report.md。
