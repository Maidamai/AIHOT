# 内容审核任务交付

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


已完成。独立工作副本：`[private-local-path]`。这是隔离Git副本，不修改共享主目录的checkout或Git索引。

- 基线：`605ac218a44a724bbcbd2c616706b331191c4ca5`
- 分支：`audit/fishery-review-quality-20261024`
- 提交：`d72b2319a03bf80cd7bbedcaa4b32beff36a5049`
- 提交内容：2个研究交付文件，无运行时代码、迁移、依赖、配置或权限改动。
- 按只读查看的集成约定，push/部署由唯一集成者执行。本分支未推送；不再等待其他任务。
- 合入顺序：无前置依赖，可在605ac218之后独立cherry-pick；不需要运行迁移、重启服务或模型重跑。

集成者可从本地副本取得该提交：

```sh
git fetch [private-local-path] audit/fishery-review-quality-20261024
git cherry-pick d72b2319a03bf80cd7bbedcaa4b32beff36a5049
```

## 交付

报告：`review-quality/docs/fishery-center/review-quality-2026-10-24.md`

清单：`review-quality/docs/fishery-center/review-samples-2026-10-24.json`。12个真实样本，5条建议保留参考审核、4条对其指定用途拒绝、3条待补证。不是用户金标或发布批准。

本目录内的`policy-current-readonly.json`是16:20:27 UTC直接生产SELECT快照，事务`readOnly=on`；指定政策仍needs_human_review、72/72、supported、终审空、发布绑定0，累计调用53、未决0。`policy-formal-review.json`及`policy-after-normal.json`为已有原响应证据副本；`policy-original-body.txt`保留与审核绑定的完整原文。两次模型同意不代表真值，报告逐项说明了独立语义复核边界。

`historical-error-evidence.json`保留宁德安全检查同观察同引文误拒及人工纠正、会议事件状态错误、低分产量统计。`offline-replay-result.json`证明当前校验器拒绝原文“在福州举办”，而对6条合成正反控制保持预期；不把这条会议当有精选价值的正例。草稿相关性提示仍有已证实的范围冲突。

`npfc-catch.html`与HTTP头保存本次HTTP200原件：截至10月17日、34158吨、29.6%，页面TAC115425吨。原报告记录10月10日，但未持有其原始页面字节，不声称实际发布日或两期数量差。本轮未接源。其他原件body和receipt来自既有授权归档，历史文件未改写。

## 验证

- `node review-evidence/replay.mjs`：零网络/模型/数据库调用，校验12个claim与12个绑定、配置与当前观察/来源哈希，并复现已知误拒。脚本在执行前关闭付费/推送阀并让fetch抛错，读取的只是本地文件。重跑会覆盖本目录结果文件；保留本次结果时先另建副本运行。
- 3个既有定向回归通过，命令记录为：`node --test --test-name-pattern='ID expansion retains occurrence|complete calendar dates translate|server-selected manual revision' modules/fishery/tests/materials.standalone.test.ts`。实际日志在`targeted-tests.log`。
- 12条JSON结构、唯一ID、HTTPS来源、标签计数和报告相对链接检查通过；`git diff --cached --check`通过。
- 实际Node版本26.5.0。已存在的Homebrew Node24因缺libsimdjson.31.dylib不能启动；没有修环境或改依赖。这个限制不妨碍本轮离线结果，不冒称Node24实跑通过。

## 集成边界与剩余事项

没有仍受阻的本轮读取或交付动作。首次默认SSH身份认证失败，随后只使用本地memory明确记录的既有souler身份成功完成只读查询；未新建凭据或改安全设置。应用托管worktree工具不可用，采用隔离本地Git副本完成任务。

指定政策仅获正式审核授权，不能终审、批量同步或发布。发布许可未核实也没有改写。新模型请求0、生产写入0，预算不占用。

本轮不提交运行时提示或谓词修复，因为当前规则指纹嵌入已审流程快照，直接部署会使旧绑定失效。集成者如安排后续窄修复，应先量化受影响范围、受控重审成本并保留旧证据；不能用不升版本、改hash或删除旧审核的方式规避。当前无需新增付费样本来证明上述两项问题，也不能据小样本降阈值。
