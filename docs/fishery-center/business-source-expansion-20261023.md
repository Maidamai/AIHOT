# 首批互补业务来源：隔离适配交付

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


核验时间：2026-10-23 16:12–16:27 UTC。基线 `605ac218a44a724bbcbd2c616706b331191c4ca5`；分支 `feat/fishery-business-sources-20261024`。

本批只交付三个来源的有界预览定义和离线适配，不修改 `industry/sources.json`、生产库、共享采集调度、审核核心或公开出口。没有部署、注册生产信源、启用周期、使用付费模型、接入 IOTC 或创建凭据。按照本轮集成约定，由唯一集成者统一合入、推送和部署。

实现位于 [`business-sources.ts`](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/backend/business-sources.ts)。它复用原版 `fromHtml`、`Candidate/SourceRow`、日期与 URL 身份规则；MPA 使用原版 `fetchRss` 后做范围约束，附件复用已有 `extractPdf` 和分段证据目录。没有另建 RSS 引擎、队列、数据库表或持久化游标。

## 每个来源的实际边界

“已收录”在本表指代码中有未启用的预览定义，不等于生产库存在来源。三者均是 `enabled=false / participation_mode=isolated`，输出 `readyForImport=false`；`readyForReview` 只说明指定原件的技术提取与证据校验通过，不代表用途许可、业务相关性、评分或发布批准。

| 来源 | 已收录与业务价值 | 已适配／本次实际读取 | 未适配、启用与周期边界 |
|---|---|---|---|
| [ITF Fisheries](https://www.itfglobal.org/en/sector/fisheries) | `itf-fisheries`；渔船船员劳动、外籍劳工及供应链劳动风险。ITF 是工会组织，须保留其报告和指控的归属，不能写成行政裁决 | 真实静态专题页有 4 条新闻；两次独立 GET 均发现相同 4 个 URL。实际完整解析 [MSC 渔业劳动报告新闻](https://www.itfglobal.org/en/news/abuse-sea-report-exposes-labour-exploitation-in-msc-certified-fisheries)：3264 字符，原日期 2026-04-16 | 仅当前专题新闻窗；资源报告、视频、人物和其他站点不抓。未验证完整历史／分页，未读取所链接研究报告全文。专题中也有跨行业 AI 新闻，仍须走现有相关性筛选，不保证全部适用远洋渔业。非招聘岗位／工资报价源。生产未收录、未启用、正常周期未验证 |
| [FAO GLOBEFISH Tuna](https://www.fao.org/in-action/globefish/species-analysis/tuna/en) | `fao-tuna`；金枪鱼供应、贸易、加工端市场背景，补政策之外的经营信息 | 静态 Key news 有 3 条同源 HTML；两次 GET 均相同。实际完整解析 [燃油成本与原料短缺分析](https://www.fao.org/in-action/globefish/news-events/news/news-detail/fuel-costs-and-raw-material-shortages-lift-tuna-prices/en)：2001 字符，原日期 2026-07-23 | **不是全量最新报告入口**：页面另有 2026-10-15 的季度 PDF，当前适配有意不收。总新闻页是动态模板，不能用静态选择器冒充接通；PowerBI 价格数据也未取得。旧文 2023-11-09 保持旧日期。不提供实时鱼货、船端成交或燃油报价。生产未收录、未启用、正常周期未验证 |
| [MPA media RSS](https://www.mpa.gov.sg/feeds/media-releases) | `mpa-port`；新加坡靠港、换班与港口作业通知，补直接经营事项；不假定所有读者均在新加坡靠港 | 原生 RSS 解析 50 条，保留 27 条 Port Marine Notice／Circular／Shipping Circular，排除演讲及一般新闻。两次 GET 保持 27 个 URL。实际解析 [第142号船员办事窗口停电通知](https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no-142-of-2026-power-shutdown-at-ica-crew-office-psa-pasir-panjang-terminalppt-4-crew-office)与其 PDF：2 页、网页与 PDF 合计 1937 字符，原日期 2026-10-22 | RSS 摘要仅标题性元数据，绝不视为全文；必须取得本通知所有列出的 PDF（1–3 件、每件至多10MiB），校验通知类型、编号和年份，保存附件原件哈希及物理页码。非 PDF、缺页／无文字页、缺附件、超限均阻断。样本所述停电发生在10月22日，不应当作今天仍在持续的操作限制。未验证全部27条正文和历史分页。生产未收录、未启用、正常周期未验证 |

本轮没有找到并验证可立即使用的“燃油现货报价”或“实时鱼货成交”管道。MPA 月度加油量、指数、FAO 季度分析中的历史价格和海关单位价值不得替代这些指标。没有为了填满业务分类而扩大到更多同质政务源。

## 日期、原文与修订

- ITF 只使用列表和正文可见日期，核对正文 `datetime` 的日历日；保留日精度。完整正文容器明确排除文内订阅组件和相关文章，实际样本初次宽选择器检测到三个 body 后失败；修正为已核验的新闻主体路径后通过。
- FAO 的 `DD/MM/YYYY` 用来源专用规则转换，避免原版通用斜线日期按月/日读取。`09/11/2023` 必须是11月9日；不存在的日历日、缺日期、与正文不一致均失败。网页 `last-modified`、HTTP Last-Modified、URL、抓取时间和正文统计期都不是发布日期。**不得把 `businessSource('fao-tuna').config` 直接当成已完成日期适配的生产原生信源。** 它仅作原版列表发现配置，须调用 `discoverBusinessHtml` 补上来源日期。
- MPA 将 RSS 明确 UTC 时间换算为新加坡日历日，再与落地页可见日核对，最终保持落地页的日精度，不用 PDF 的事件日期改写发布日。网页正文容器中的类别导航不是附件；真实样本发现此边界后已加入回归。
- HTML 必须是可严格解码的 UTF-8、HTTP200、精确请求／最终 URL 且 SHA-256 一致；不使用搜索摘要或错误页补正文。PDF 必须匹配网页链接、HTTP 收据、原件字节哈希、完整逐页文本和首页通知身份。合并全文超过64000字符时阻断，不截断后送模型。
- `versionHash` 绑定正文、标题、发布日期、所列文档引用与所需 PDF 字节；`evidenceHash` 另外绑定原件和完整分段证据。真实复访发现 ITF 与 MPA HTML 字节变化、正文和日期不变；FAO HTML 与 MPA PDF 字节不变。三篇内容版本都未变，新增 URL 为0。重复读取不能伪造修订新闻。
- **内容未变时保留原先被审核的不可变原件／observation／review，只把新获取收据作为独立获取记录。** 新 `evidenceHash` 不能覆盖旧证据后继续使用旧审核。真实正文、日期或同 URL PDF 字节变化时，按现有版本机制失效旧审核。无法独立保存复访收据时，先补该集成契约，不能把两种哈希混用。`businessRevision` 不写任何游标，也不是发布授权。

## 真实验证和回归

| 验证 | 结果 |
|---|---|
| 三来源两轮真实 HTTP 获取 | 共7个选定地址（3列表、3正文、1 PDF）各两次；都200；原始响应及收据独立保留。首轮16:12–16:17 UTC，复访16:27 UTC。手动有界复访，**不是 worker 正常定时周期** |
| 原版列表解析 | ITF 4→4；FAO 3→3；MPA RSS 50→50，范围过滤27→27；三来源新增身份均0 |
| 三个正文样本 | 两轮均 `readyForReview=true`；日期分别2026-04-16、2026-07-23、2026-10-22，正文哈希全部稳定 |
| MPA 附件 | Apple PDFKit/v2，2页；主通知及 ICA 附件文字均取得；原件 SHA-256 `050a21ba258ae3a6db97ca1e9b0c96a181903d409f800509734816772ada8cee`。Linux/Poppler 与服务器真实周期尚未验证 |
| 修改前后 | 基线没有这三个独立适配；新增后能发现4／3／27条限定候选。FAO 3条显示日均正确；三篇详情两次均完整。没有将“适配新增候选”计作生产新增新闻 |
| 故障及修订回归 | 8项定向测试：旧日期／日月歧义、非法日期、日期冲突、原件／跳转／哈希错误、摘要与正文边界、缺附件／通知错号／无文字页、同 URL PDF 替换、页外字节变化、证据容量；均通过 |
| 类型检查 | `node node_modules/typescript/bin/tsc -p modules --noEmit` 通过 |
| 环境 | 最终检查使用 `[private-local-path]`；UTC 和 America/Los_Angeles 下定向测试均通过。Homebrew Node24 缺少其依赖 dylib，未修改系统安装，改用已存在的 nvm Node24 |

仅运行上述针对性检查。未跑全量 suite、数据库测试、Web build、线上 smoke 或付费筛选。

## 集成者需要完成的最小契约

本分支不依赖其他并行分支，没有依赖／锁文件变更、迁移、新环境变量或新增凭据。只新增模块文件、在既有 `materials.standalone.test.ts` 中追加回归、增加本文；如其他分支同样修改该测试文件，只需保留各自独立测试和导入。

1. `businessSource(id)` 是**未注册的解析预览 profile**。生产实体继续服从现有受控来源注册、许可和隔离机制；不可直接启用原生通用 worker，让它绕过下列正文及版本校验。现有栏目身份／来源授权／抓取器 dispatch 尚不认识这三个 ID，此处仅记录窄适配接点，不修改这些核心。
2. 对 ITF/FAO：在既有有界 HTTP 原件归档后调用 `discoverBusinessHtml(id, listingReceipt, raw)`。对 MPA：复用 `fetchRss` 的候选及原始列表收据，然后调用 `restrictMpaListing`。候选必须来自当轮成功归档的真实列表，不能由管理员填一个标题／URL绕过发现绑定。最新检查与旧档扫描保持独立；不以当前列表窗口宣称历史完整。
3. 详情调用 `prepareBusinessArticle`，传入经列表绑定的候选、精确 HTTP 收据与原件。MPA 按网页附件顺序传入原件与现有 `extractPdf` 的结果；页面给出的新增／变化附件先完整取得，否则本条失败。此函数不会自己发请求或解析 PDF，也不提供扫描页 OCR 兜底。
4. `fishery-business-preview/1` **不是当前 `captureSchema` 的可导入 payload**，不要伪装成 `jfa-press`、`fujian-notices` 或 `manual_official` 绕过已有来源注册。集成者需在已有受控捕获／导入契约中注册确切来源，保存完整原件、引用清单、body hash、page sections 和内容版本，再用正式当前 observation revision 重建证据目录。预览内部使用 revision=1 仅校验结构，不是生产审核版本。
5. 最新发现和已知 URL 修订检查要分别受现有单源租约、数量／字节上限、失败退避和幂等回执控制。`fetchRss` 的304／列表不变不能证明文章 PDF没变；应复用既有受控修订检查，而非把一次预览挂成第二套 scheduler。失败或未知结果不得推进成功游标。列表窗口消失不等于撤稿。
6. 先完成用途登记，再开启现有受控计划；保持站内与对外全文出口关闭。逐源在服务器跑一个**正常间隔**的真实周期，核对来源健康、`fetch_runs`、新旧观察、失败不推进、无重复付费任务以及公开侧未绕过审核，才可以标记“已启用／周期验证通过”。本分支没有完成这些操作。

## 用途与访问证据

这些是实际阅读到的源站条件及待办，不是本分支对任何使用方式的批准；也未替使用者作新的权限决定。

- [ITF 条款](https://www.itfglobal.org/en/page/terms-use)：保留知识产权，非商业及支持工会目标的使用有条件，商业利用、修改和第三方内容另有限制。内容应保持工会报告归属；新闻与所链接的研究报告是不同证据范围。用途状态维持待核，不自动开放翻译、全文再分发或商业用途。
- [FAO 条款](https://www.fao.org/contact-us/terms/en/)：网站内容、知识库出版物和统计数据采用不同规则；新闻发布另有说明，翻译／改编与商业用途、第三方图表仍需分别检查。当前适配只保留可核验文本，不取得照片或标志的转载权限，不把站点总条款当作所有附件授权。
- [MPA 条款](https://www.mpa.gov.sg/footer/terms-of-use)：页面列有个人非商业使用条件，对链接、复制和分发等另设书面许可条件。**尚未取得本业务站的持续归档／摘要发布等用途许可证据，不能因 RSS 公开可读就标成可发布。** 此为后续启用的真实待办，不是本轮工具操作被拒绝。
- ITF、FAO 的 `robots.txt` 本轮200，已检查所用路径不在其禁止列表。MPA robots 本轮404；没有写入403／404放行规则或伪造已批准的指纹。生产采集仍需按照现有抓取政策建立经核验的源级访问记录。

## 交付证据位置

私有原件、完整正文与临时回放工具不进入 Git；已保存在本任务目录，未上传或对外发布：

- `[private-local-path]`：最终两次真实获取后的逐源比较、原件/正文/内容版本/证据绑定哈希。
- 同目录 `{fao-tuna,itf-fisheries,mpa-port}-{first,revisit}.json`：每份完整提取结果、来源区间、原件收据和问题列表；仅供本地审阅。
- 上级 `*.raw`、`*.receipt.json`：列表、正文、PDF、robots、条款的原始响应及独立收据；`*-revisit.*` 是第二次获取，未覆盖第一次原件。
- `mpa-pdf.parsed.json`：原始 PDF 的2页解析结果；`verify-revisits.mjs`：最终离线比较脚本。脚本仅对已归档 RSS启动临时127.0.0.1假服务，结束后关闭，模型和数据库均不参与。

可重复的轻量回归命令（仓库根目录）：

```bash
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node --import ./tests/standalone.ts --test --test-name-pattern='business sources:' modules/fishery/tests/materials.standalone.test.ts
node node_modules/typescript/bin/tsc -p modules --noEmit
```
