# 晋江与IOTC最小离线适配验证

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


2026-10-20；基线`c849caa66628648f15441a55cc0e96f9dcdba41e`；分支`feat/fishery-materials-mvp`。本轮开始及中断恢复时只读核对工作区，未发现范围外改动。没有付费模型、生产DB写入、自动批准、长期调度、Easel联调、push、部署或发布。没有更改全站行业提示词、评分门槛或核心采集链。

## 改动

- 模块`backend/source-adapters.ts`提供来源专用离线纯函数。晋江核验可见日期与meta、保留+08:00；缺日期不取URL或事件日期替代，不从厦门出发推断归属。IOTC区分Pending、异议截止、通过年份及捕捞限额条款年份，并核对PDF与页面的文号/状态/截止日。
- `scripts/prepare-official.ts`和`pdf-text.swift`读取归档文件并核对hash；现成macOS PDFKit解析原件，记录获取状态/最终URL/时间、附件hash、页数、正文hash与解析状态。无解析器时未核，不下载安装或调用付费服务。HTTP收据不是远端签名证明。
- 契约增加year精度及可选policyContext/sourceCapture；Pending不能带确定的effectiveFrom。私有素材版本0.2，无迁移和公开接口。原权利、审核版本、撤回、publication门槛保留，另拒绝失败/缺失/未核或冲突证据，人工批准不能覆盖获取或解析失败。
- 仅将已存在的cheerio@1.2.0声明为模块直接依赖并离线更新锁文件，无包升级或系统安装。测试为最小合成DOM/语句，未复制整个第三方网页或PDF进提交。

## 最终真实归档离线回放

本轮未重新请求网站；沿用上轮正常GET获取的原始响应。抓取时间为UTC，回放时间另记，不把回放当新抓取。

| 原件 | 已归档获取结果 | 最终回放 |
|---|---|---|
| [晋江报道](https://www.jinjiang.gov.cn/xxgk/jjyw/202603/t20260321_3276478.htm) | HTTP200，2026-10-20T05:51:00Z附近 | parsed，2,053 UTF-8字节；原时间字面值“时间：2026-03-21 19:36”，规范时间2026-03-21T11:36:00Z，日期为day；不改厦门出发事实 |
| [IOTC措施页](https://iotc.org/cmm/resolution-2601-establishing-interim-catch-limits-yellowfin-tuna-iotc-area-competence)和[PDF](https://iotc.org/sites/default/files/documents/compliance/cmm/iotc_cmm_2601_0.pdf) | 均200；分别05:51:00Z及05:52:31Z附近 | PDFKit parsed，5页、12,516 UTF-8字节；Pending；异议截止2026-11-18，effectiveFrom未知；adopted仅year=2026；provisionYears=[2027,2028]，未生成2026年限额 |
| [福州公示](https://hyj.fuzhou.gov.cn/zwgk/tzgg/202610/t20261009_5379704.htm) | 404，05:51:00Z附近 | failed，readyForReview=false，零正文；没有搜索摘要替填，没有猜撤稿原因 |

三个输出的状态/关键日期/条款年份及成功正文hash均经独立Python断言核对。IOTC原件PDF SHA-256为`6d60080cf90f9fe7f0e960b28e73c8f23e24764bcf7d12f240d6ad3c09dac44e`；晋江HTML为`e4a43b08caaab02742f2dacb030abcd2eaa5a7644773246d2f6cdce372f22fc2`。文件完整性不能替代业务事实、法律适用性或转载许可审核。

原件目录`[temporary-evidence-path]`；输出`[temporary-evidence-path]`，成功样本另有body.txt。它们未入库、未上传、未提交，临时目录可能被系统清理。提交内的合成回归不依赖这些路径。

## 本轮检查

| 检查 | 实际结果 |
|---|---|
| 最终`npm run typecheck` | 用户明确批准后执行通过 |
| 最新`npm run test:standalone` | 239/239通过，无失败/跳过/取消；无数据库回归集合 |
| 模块standalone最初单独运行 | 11/11通过，已包含在239项中，不相加 |
| 不需浏览器的8个Web测试文件 | 36/36通过，本地假API，无真实DB |
| Web构建 | 通过 |
| 最终三原件离线回放 | 晋江/IOTC可送人工复核，福州正确失败；关键语义/hash断言通过 |
| 完整DB suite及新增DB端到端案例 | 未跑：无可用隔离PostgreSQL；按限制未安装或启动额外数据库 |
| 完整浏览器suite | 未跑：锁定WebKit缺失；未下载安装 |
| 整站smoke | 未跑：本轮未启动DB/API/Web服务 |
| 模型评测、全量信源接通或生产发布 | 未执行，不属于本轮验收结论 |

离线回归覆盖正常/缺失/仅day/冲突/非法日期，404/缺正文，hash/域名不符，Pending与生效日分离，year不补日，2027—2028条款年份，PDF缺失/失败/未核及文号/状态/截止冲突，失败证据导出拒绝。已有DB测试文件补充“批准后仍拒绝失败获取证据”场景，但尚未执行，不能用纯函数检查代称API/DB全链路通过。

日志位于本任务目录`[private-local-path]`：fishery-adapter-standalone.log、fishery-adapter-unit.log、fishery-adapter-typecheck.log、fishery-adapter-build.log、fishery-adapter-web-tests.log、fishery-adapter-lock.log；最终回放与关键语义见fishery-adapter-replay.json。前一期944/59项通过不是本轮结果。

## 已解决中断与剩余边界

最终类型检查此前两次被自动审批按早期“只读研究”范围拒绝，命令明确未执行；一条文档写入调用随后被中断，恢复时确认未写入。用户明确批准本机类型检查、三原件离线回放及本地提交后，重新核对工作区并执行上述最终检查成功；没有更换路径绕过拒绝。回放辅助断言曾错误地要求时间字面值不带“时间：”标签，核对原页后修正断言，保留原始字面值，未为测试删改来源字段。

剩余最小验证为在另行允许且具备隔离PG/WebKit后运行DB端到端及完整浏览器检查。在线列表发现/增量采集、持久化原件库、业务金标、渔业提示词与正式模型评分仍未实现；readyForReview不是批准或发布，未知许可依旧关闭。
