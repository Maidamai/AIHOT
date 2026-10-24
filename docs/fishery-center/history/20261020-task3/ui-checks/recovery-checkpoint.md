# 素材后台 UI：暂停检查点

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


记录时间：2026-10-20 10:12—10:14 UTC。按母会话要求停止新增工作，仅做只读诊断并保留现场。

## 已有结果

- `[private-local-path]` 基线仍为 `c65939d289d7de381a9f905a62b94be2e880205b`；18 个文件已暂存，没有未暂存改动；本轮尚未提交、推送或更新服务器。
- 已写入现有应用的 `/admin/fishery` 和 `/admin/fishery/:id`：默认真实素材、独立测试区、搜索/状态筛选、来源获取、纯文本及证据、日期/范围未知、版本审核、拒绝/撤回、JSON/Markdown导出。
- 页面阻断原因与实际导出共享后端检查；CSRF、管理员权限、当前观察与许可版本、撤回和采集失败门禁仍由后端执行。
- 实时/回放标记已贯穿生成逻辑和CLI，新增404回归；旧服务器 prepared 文件尚未更新，不能声称已修复远端历史数据。
- 完整类型检查、Web构建通过；本轮全后端959/959通过。没有新增依赖、凭证、模型调用或采集调度。

## 实际浏览器验收范围

只在本任务已有本地隔离预览（Mac `127.0.0.1:39871`，API `39872`）操作，未建立服务器SSH隧道。这些不是远端UI验收证据。

已完成：默认真实3条/测试区分；IOTC关键词+待审筛选为1条；福州HTTP404与无正文/不可导出提示；测试克隆的原因确认、拒绝、v1审核通过；实际JSON下载且 `editorial.confidence=isolated_test_workflow_not_business_approval`。

测试克隆ID：`804086c8-70c4-4b84-b1b8-fc6df766a5a5`，来源为既有合成许可来源，观察v1、许可v2。只读诊断确认为approved，2次审核（rejected、approved），没有追加观察或撤回。另一测试副本 `3cb42da1-c97f-410d-bfb3-888c5b35613f` 为unverified、审核0。真实3条主记录审核全部为null。

## 长等待的精确边界

发生于 CUA 同一段工具调用，返回耗时2365.094秒（约39分25秒）：

```js
var jsonWait = fisheryTab.playwright.waitForEvent("download");
await fisheryTab.playwright.getByRole("button", {name:"导出 JSON",exact:true}).click();
var jsonDownload = await jsonWait;
var jsonDownloadPath = await jsonDownload.path({timeoutMs:10000});
// 随后复制下载文件并校验其测试标记，再读取AX状态
```

目标为本地测试克隆详情页 `http://127.0.0.1:39871/admin/fishery/804086c8-70c4-4b84-b1b8-fc6df766a5a5`。不是服务器部署命令、不是生产发布。

审计时间：拒绝09:31:54 UTC，通过09:32:04 UTC，唯一一次导出10:11:43.721 UTC。文件10:11:43.940 UTC保存，3078字节。因此不能断言一直卡在“已点击后的下载等待”；现有日志不能区分该组合调用内部哪个await阻塞。该调用最终已返回成功，目前没有待确认、被拒绝或结果不确定的写动作；没有重复请求。

## 未完成，不能当作已交付

- 本轮完整Web套件未运行（上轮59项不能当作本轮新UI验收）。
- 浏览器Markdown下载、版本变化/旧审核失效、重新审核、撤回和移动布局尚未验收。
- 本轮正式提交、服务器更新、远端页面/回环复验和提交-镜像映射尚未做。
- 服务器仍运行此前c65939d独立试验，尚无本轮素材UI；未触及原6容器、Nginx、80/443。
- 真实转载许可与业务审核未完成，福州原文404仍存在。没有公网、反代、DNS、Clash、防火墙或新持久凭证变更。

## 恢复步骤（需继续执行授权后再做）

1. 先核对HEAD、暂存区与两份测试克隆当前状态，保留真实主记录未审。`staged-ui.patch`为本轮18文件补丁备份；现有工作区已经包含改动，不要重复apply。
2. 不重复已知成功的v1拒绝/通过或JSON导出。后续版本/撤回验收仅用测试克隆，新观察与审核都明确带版本和测试原因。
3. 下载验证拆成可诊断、有时限的步骤；若工具再次长等，停止并读取API审计，不盲目重试写操作。
4. 完成剩余浏览器路径和移动布局、完整Web回归，再做范围内修正与本地提交。
5. 仅更新服务器现有fishery-pilot目录/库/卷/回环端口。修正历史实时获取标记时保留原始记录，新增未审观察，不调用采集、不自动业务批准。核对665+源码文件、镜像、原6容器和Nginx不变。
6. 明确远端路径在服务器回环地址。当前只可通过既有SSH执行只读终端查看；新的浏览器隧道或公网入口需要先提出，不能自动创建。

## 证据

- `read-only-recovery-diagnostic.json`：恢复诊断，真实主记录与测试副本状态。
- `test-clone-audit.txt`：测试副本动作与时间；唯一导出记录。
- `browser-export-r1.json`：浏览器实际下载的测试JSON。
- `desktop-list.jpg`、`fuzhou-blocked.jpg`：真实浏览器截图。
- `full-db.tap.log`、`typecheck.log`、`web-build.log`：本轮检查日志。
- `staged-ui.patch`：53543字节，SHA-256 `3242311decf0815d12c6d27ea4dedb23889b21f9b3f46340aa0944616185bc84`。
