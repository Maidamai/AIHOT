# 隔离部署检查点（2026-10-20 UTC）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


实际仓库：`[private-local-path]`；分支 `feat/fishery-materials-mvp`；HEAD 仍为 `deb11ef8ba169ab19482fb9c5dbe1b356768eb80`。本轮修改保留在工作区，尚未提交。

## 已完成

- 仅读探测系统运行时、缓存与端口。Node24.15.0/Chromium1228可复用；Docker守护进程未启动，本机无已发现的PostgreSQL，WebKit2311未缓存。没有启动Docker或触碰其他项目服务。
- 类型检查通过；standalone239/239；Web构建通过；8个无需浏览器的Web测试36/36；Chromium子集10通过、1项WebKit明确跳过。
- 三个固定来源单次、受SSRF保护的采集入口，保存新目录的原始字节/收据或独立失败记录，不重试，不用缓存回填。代码通过类型检查；真实运行因本机DNS安全检查停止，未获正文。
- 补充空PDF与HTML伪装PDF故障断言，通过既有standalone集合。
- 增加test环境导出的JSON/Markdown演练标记；其DB测试已经写好但尚未运行，不能称已验收。

## 未启动 / 未执行

没有隔离DB/API/Web实例，因此没有本轮访问URL或启停实例命令。未执行迁移、完整DB suite、正文入库、测试审核/导出/改版/撤回HTTP闭环、完整浏览器suite和整站smoke。没有模型调用、生产写入、Easel联调、推送或发布。

## 两类明确阻碍

1. **待批准，未下载**：独立PostgreSQL17.11和锁定WebKit2311。准确官方来源、大小和必要性见`dependency-request.json`；本轮任务明确要求任何新运行时先列清单再暂停该下载步骤。
2. **采集器主动拒绝，未获得HTTP响应**：本机公开域名被解析到198.18.0.0/15保留段。晋江198.18.0.7、IOTC198.18.0.6、福州198.18.0.5。guardedFetch在晋江/福州页面请求前、IOTC robots请求前拒绝。没有关闭SSRF或修改DNS/代理，没有通过另一传输绕过该拦截。需要确认本机fake-IP代理/DNS的安全接入方式后才能完成应用真实采集。详情见`current-capture-failures.json`。

此前原件归档不冒充本轮采集；本轮福州状态为无HTTP响应，不能记作本轮404或官方撤稿。云环境独立200/404也不是本机请求结果。

## 当前保留的仓库修改

- `modules/fishery/scripts/capture-official.ts`（新文件）
- `modules/fishery/backend/export.ts`
- `modules/fishery/tests/materials.standalone.test.ts`
- `modules/fishery/tests/materials.test.ts`
- `docs/fishery-center/local-pilot.md`（新文件）

最后`git diff --check`通过。未覆盖他人修改；本轮开始时工作区干净。

## 证据

- `chromium-subset-authorized.tap.log`：实际Chromium通过日志。
- `chromium-process-check.log`：临时浏览器/Web进程清理检查，无匹配。
- `web-nonbrowser.tap.log`：36项通过。
- `live-{jinjiang,iotc,fuzhou}-20261020/*.failure.json`：逐次失败时间、目标、原因和status:null。
- 类型检查/standalone239/Web构建的退出码0由工具执行记录确认，未另存完整日志，不能用旧阶段日志冒充。

后续复现继续使用Node24、清空真实凭据环境、全部外部动作阀关闭；数据库只使用127.0.0.1和独立`*_test`名称。没有运行或清理任何其他项目的容器、数据库、端口、配置。
