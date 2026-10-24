# 已存公开归档离线对照（2026-10-24）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


本次只补小样本验收，不修改implementation、不新增抓取、不启动DB、不调用模型、不部署。执行环境Node v24.14.1。结果均为本地回放，不能解释为新采集或真实出稿。

## 版本和方法

- 原部署固定a5：`a5a0f8c064d5c82a707af2f170582338bb8ff10e`，代码来自task5/snapshots/current。
- 新版为task5/implementation未提交工作树，基线HEAD仍是a5；tracked patch SHA256：`d5b4ee89e6bb596d5cae1a37528d9204a08bab4bef4819075bbacc3cd638ea9c`；回放自用JSON文件hash映射摘要：`1113f3dff77cf6403ca80757b9d4b0250e2ec4de9a61737f7530e35dc1682da8`。它的算法是：对“改动/新增文件路径→文件SHA256”映射执行Python `json.dumps(map, sort_keys=True)`（默认分隔符、`ensure_ascii=True`），UTF-8编码后再求SHA256；此值不是标准逐行manifest的hash。既有[标准文件清单 (local original; provenance)](../../../provenance/source-manifest.json)的文件SHA256仍为`d872dd506c8f530956d8e852b2acbb8ef5bb81ff9b08bd1f074fa4a3e5a0a811`，两种序列化不同，不代表源码变化。
- 必要上游固定b399：`b3998dc6fc138eb9659f33f55eb38c1c716f0d57`，仅比较它实际存在的fromHtml、fetchRss、readable入口。上游没有行业适配器，不制造行业对照结果。
- a5与新版各自加载本版本的business-capture/business-sources/column-batches/column-progress、日期、RSS及正文函数。本地workspace模块没有替换成同一实现。仅第三方依赖共享implementation现有锁定安装；具体本地模块hash见summary.json/moduleHashes。baseline私有advance仅由Node加载钩子在内存追加export以调用原函数，源文件未编辑。
- RSS的fetchListing被精确URL→已归档响应字节替代；不启动HTTP假服务。global fetch与socket connect均被拒绝，DB地址指向不可用本地测试端口。所有收据原始SHA256及字节数均先核验。
- MPA PDF使用既存`mpa-pdf.parsed.json`的Apple PDFKit/v2两页全文，先核对rawSha256与两份原始PDF；本次没有重新提取PDF，因此不声称验证了新解析器输出。

## 一、真实列表和详情字节直接对照

原件根目录：`[private-local-path]`。全为2026-10-23已保存的公开响应，非本次抓取。每个文件对应同名前缀`.receipt.json`；URL、状态、获取时间与完整路径见summary.json/artifacts。此批直接样本为6份列表、6份详情HTML、2份同一PDF（共14份响应；3篇独立文章）。

| 来源 | 共有core列表候选观察（初次/复访） | 行业适配器候选观察（初次/复访） | 前后差异 |
| --- | --- | --- | --- |
| ITF fisheries | 4 / 4 | 4 / 4 | 0条身份/标题/日期/正文状态差异 |
| FAO tuna | 3 / 3 | 3 / 3 | 0条身份/标题/日期/正文状态差异 |
| MPA RSS | 50 / 50 | 27 / 27；每轮排除23条非通知 | 0条身份/标题/日期/正文状态差异 |

**114条是共有core候选观察（ITF8+FAO6+MPA100），并非114篇独立文章；对应57个独立URL。行业过滤后是68条观察（ITF8+FAO6+MPA54），对应34个独立URL。** 每源两次列表没有新增或消失URL。

a5→新版：6个共有列表输出、6个行业列表/详情输出、6份通用readable正文输出全部相同。新版→b399的6个共有列表和6份通用readable输出也全部相同。没有检测到本轮日期/登录过滤修复误伤这批真实样本。ITF/FAO仍使用UTC日期口径，MPA仍使用+08默认口径。a5与新版在UTC和America/Los_Angeles下的真实列表/详情输出也相同。

| 详情来源 | 原文日期 | 全文字符数（JS length） | 正文SHA256 | a5→新版 |
| --- | --- | --- | --- | --- |
| itf-fisheries | 16 Apr 2026 → 2026-04-16 | 3264 | `b0002582be6f382a3b239909bac4543fd1c3f4c5ef3113f1c4409f828b1ee1bc` | 无；初次/复访均ready |
| fao-tuna | 23/07/2026 → 2026-07-23 | 2001 | `9fe39838c04ca39be8cdb0bf6fdeb9a07cbdf5e98942fee5bd531aaff5c2fce4` | 无；初次/复访均ready |
| mpa-port | Published 22 Oct 2026 → 2026-10-22 | 1937 | `346bb2f812e151b1549405b9c47f92fc1bee0c76ba8470a1339de30d46ee646c` | 无；初次/复访均ready |

ITF及MPA的初次/复访HTML字节不同，但日期、正文hash与内容versionHash相同；证据evidenceHash随真实原件hash变化。FAO的初次/复访原件相同。两版给出同样结果，这是既有原件/内容版本分离语义，不能把网页边栏变化算作新稿。6份详情均ready不等于已审核或可公开发布。

| 原件文件（真实） | 字节数 | SHA256 | 原收据获取时间 |
| --- | ---: | --- | --- |
| `itf-fisheries.raw` | 175434 | `20ed4618120ba9555f394a3197e8983a4ab4475c89d74efede7b2f7d86d439c9` | 2026-10-23T16:15:10.462338+00:00 |
| `itf-fishers-article.raw` | 113842 | `c418ced095fa81499be48cf7f888505fd27b6f65d6cf7e236737f76759cbc7cd` | 2026-10-23T16:17:14.814035+00:00 |
| `itf-fisheries-revisit.raw` | 175434 | `17c212d54aff1ce522cd814a51776eaab0fbe1855d785abad8a780ebe3cd380f` | 2026-10-23T16:27:20.543696+00:00 |
| `itf-fishers-article-revisit.raw` | 113842 | `edba2ac1ffa65d59e6b51a6ec4ce508035a726bd903750f1cbe6c0e5e176c8ab` | 2026-10-23T16:27:20.637589+00:00 |
| `fao-tuna.raw` | 63400 | `c73f5fc8e342dc50cdc09acc82ec1eecbed6efd3dae3ad9ac2f9b4a77f025bd4` | 2026-10-23T16:14:09.593789+00:00 |
| `fao-article.raw` | 59951 | `f6537d914d1c680e5380440750bcfb86f7a379fb992bce327ddf407105ccc588` | 2026-10-23T16:15:09.115742+00:00 |
| `fao-tuna-revisit.raw` | 63400 | `c73f5fc8e342dc50cdc09acc82ec1eecbed6efd3dae3ad9ac2f9b4a77f025bd4` | 2026-10-23T16:27:18.931521+00:00 |
| `fao-article-revisit.raw` | 59951 | `f6537d914d1c680e5380440750bcfb86f7a379fb992bce327ddf407105ccc588` | 2026-10-23T16:27:19.518027+00:00 |
| `mpa-rss.raw` | 70422 | `e1bb847a4a661b17e60532bb50ab13442b6fe5008cb4f7b6aaa7139c34a6dba6` | 2026-10-23T16:12:45.665528+00:00 |
| `mpa-notice.raw` | 233541 | `56b0a768849616548348f3e8ef82738436ce44138cfeae2d8192f0957cb50e44` | 2026-10-23T16:14:10.777620+00:00 |
| `mpa-rss-revisit.raw` | 70422 | `0c699451df6ca1e900960f6eb6ceaa003099f52c2ece132260515a2a433a802d` | 2026-10-23T16:27:17.863223+00:00 |
| `mpa-notice-revisit.raw` | 233539 | `80f36c6193860ae5ee4042b90be501957db958169b2ab2b7d069729e570470ad` | 2026-10-23T16:27:18.383024+00:00 |
| `mpa-pdf.raw` | 103555 | `050a21ba258ae3a6db97ca1e9b0c96a181903d409f800509734816772ada8cee` | 2026-10-23T16:17:13.014282+00:00 |
| `mpa-pdf-revisit.raw` | 103555 | `050a21ba258ae3a6db97ca1e9b0c96a181903d409f800509734816772ada8cee` | 2026-10-23T16:27:17.584544+00:00 |

## 二、真实字节加合成故障及排队时序

只使用上述MPA列表、通知页、PDF，另读取原MPA robots响应作为collector入口所需控制原件。模拟状态明确设为其余列表身份已完成，目标为第142号通知；模拟首次轮时钟为2026-10-23T16:20Z、再次成功轮为72小时后，PDF第一次返回的503状态是**人工注入**，不是归档中的真实故障（原件收据均为200）。两版调用各自collectColumns和原advance函数，使用本地文件manifest；没有数据库持久化。

| 比较点 | a5 | 新版 | 是否预期 |
| --- | --- | --- | --- |
| 同一真实PDF原件注入HTTP503 | item=failed，source outcome=failure，coverage=blocked | item=failed，source outcome=partial，coverage=current_page_only | 是；单篇错误与列表错误分离 |
| 首轮列表成功的独立记账 | 无listingSucceededAt/bodyFailures字段 | listingSucceededAt=2026-10-23T16:20Z、bodyFailures=1 | 是 |
| 待办/原件 | 目标保留pending，档案保留 | 目标保留pending，档案保留 | 相同；未判撤回 |
| 72小时后同一原件取得成功 | ready、完成目标、无firstSeen记录 | ready、完成目标，firstSeen仍为首轮16:20Z并由旧列表receipt重验 | 是；不改成队列消费时间 |
| 正文成功时间 | 整轮成功/捕获时间 | 独立lastBodySuccessAt更新到成功轮 | 是 |
| 第142号通知的原发布日期 | 2026-10-22 | 2026-10-22 | 相同，未改写 |
| 使用各版实际decideTimeline组合模拟discovery | backfill=true | backfill=true | 是；新版保留早发现，但在模拟首次时刻该日精度原稿已超过48小时，不能借改造变成近期成功样本 |

模拟firstSeen时间是此次场景注入的捕获时钟，不是把2026-10-23原始HTTP收据重新声称为新请求。此处证明纯函数及file manifest行为，**不证明DB cursor已提交、fail_count已修复或articles.discovered_at已写入**；这些由此前独立_test单测覆盖，本次未再启动DB。

## 三、完全未覆盖和明确限制

- 未覆盖MARA、福建、JFA、NPFC等其他真实源；没有JFA真实失败响应归档的本轮对照。
- 未覆盖其余列表候选的详情；三篇正文样本不能证明34个行业URL全部完整可读。
- 未覆盖真实登录重定向页面；本批没有触发该新防护，只能说明其未改变现有正常页面结果。其行为由此前合成回归另证。
- 没有真实503/404故障episode，本轮附件失败由合成状态注入；不能称真实故障恢复。
- 未重新运行PDF提取器、未重放数据库持久化/来源健康事务；未执行生产游标迁移。
- 未覆盖线上多源连续运行、真实48小时观察、业务模型筛选/写作、生产发布或刊期。现有鉴权、仅审核政策及累计预算均未操作。

## 产物和源码不变证明

- `worker.mjs`：定向回放脚本；输出为a5/implementation/upstream的UTC结果及a5/implementation洛杉矶结果。
- `summary.json`：所有逐样本原件路径/URL/hash、模块版本hash、对照计数及模拟时序结果。
- `implementation-before.json`与`implementation-after.json`完全相等：HEAD、tracked diff SHA256和全部改动/新增源文件内容hash均未变化；sidecar中的`manifestSha256`专指上述JSON序列化摘要，不与标准逐行manifest混用。整个implementation在此回放期间未写入。
- 网络请求0、DB连接0、模型请求0；没有新提交、push或部署。累计文件结果为本地验收证据，不是新的线上运行记录。

复现单个版本（只运行定向回放；新运行需先选空的模拟输出目录，原脚本故意不覆盖已有归档）：

```bash
env -i PATH=[private-local-path] TZ=UTC DATABASE_URL=postgres://unreachable@127.0.0.1:1/archive_replay_test AIHOT_CREDENTIALS_DIR=/nonexistent-replay-credentials MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node [private-local-path] upstream
```

其他已执行版本参数为`a5`、`implementation`；时区另执行`America/Los_Angeles`。所有运行均未使用数据库或HTTP服务器。
