# 分层信源登记与取证状态

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


核验日：2026-10-20。`已读`表示本轮实际读取公开正文或文件，`入口`只表示发现入口或页面可达，`待验`不能据此声称已接通。频率分为页面提供的证据和我们建议的检查节奏；本轮没有建立采集器、订阅、调度或付费账户。公开GET成功不代表许可、结构稳定性、历史完整性或生产SLA。

时效优先使用本执行者实际取得的2026年NPFC/SPRFMO资料；Pro比较表中采用的较旧年度报告作为历史证据，不能替代新资料。来源发布年、统计年度及版本分别登记。

## 核心：政策、资源及可审计原始统计

| 来源与直接入口 | 覆盖与原创性 | 格式、语言、频率证据 | 实际核验与首版方式 | 权限和缺口 |
|---|---|---|---|---|
| [中国农业农村部渔业渔政局通知公告](https://yyj.moa.gov.cn/tzgg/)；[远洋渔业专题](https://yyj.moa.gov.cn/yyyy/) | 中国远洋管理及全渔业政策，官方发布；必须按远洋相关性筛选 | 中文HTML/附件，不定期；通知列表存在2026条目，远洋老专题首条仍2023-12-15 | 已读列表；专题不能作为唯一入口。建议每日查列表、定期核对部令/有效规章目录；历史修订链单独整理 | 页脚保留权利、未经允许不得复制镜像；不默认可全站镜像。具体新规原文/修订决定需逐件取证，不以新闻摘要代替法规 |
| [法规司2025修改决定](https://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm)；[第950号有效规章目录](https://fgs.moa.gov.cn/flfg/202509/t20250925_6477748.htm) | 国内远洋规章的修订链；不能只保留2020版 | 中文HTML，决定署2025-07-15，网页2025-08-01；其他规章修改部分2025-09-01施行 | 本执行者实际读取：决定附件一第五项修改远洋管理规定；950号目录注明2025年第3号修订。纳入首批政策样本 | 同一决定不同部分有不同生效日；本次未据此生成完整合并现行条文或法律意见 |
| [农业农村部2026新渔业法实施答问](https://yyj.moa.gov.cn/gzdt/202605/t20260520_6484313.htm) | 主管机关对新修订渔业法实施的说明，国内基线必须更新 | 中文HTML，2026-05-20；正文确认2025-12-27审议通过、2026-05-01施行 | 本执行者已读主管机关正文；不能仍把旧法版本作为当前唯一基线。主席令官方转载入口另次读取超时 | 答问不是逐条法律原文；新法正式全文、配套规范与具体适用性仍需逐件审核，不根据摘要输出许可结论 |
| [湖南省政府转载农渔发〔2024〕13号](https://www.hunan.gov.cn/zqt/zcsd/202405/t20240506_33293093.html) | 外籍船员管理与服务正式通知的可读政府转载，来源注明农业农村部 | 中文HTML，发文2024-04-17，转载2024-05-06；正文自印发日起执行，部分联动机制2024-08-01实施 | 本执行者实际读到执行与取代2021通知的段落；附件与后续修订需另核。不是仅有2023征求意见稿 | 原发布机关页面尚未成功核验；不能把特定条款节点当整份通知生效日，亦不称完整现行用工意见 |
| [NPFC 2026 CMM汇编入口](https://www.npfc.int/compendium-npfc-conservation-and-management-measures) | 北太公海相关非高度洄游资源养护、监测、报告与转运；官方一手 | 英文HTML/PDF，按会议/措施变化；页面同时列2026与历年版本 | 已读汇编索引与单件入口；汇编版本、单件CMM、附件分别观察；汇编年号不等于每条现行生效 | 未确认全量转载许可或稳定RSS/API；先元数据/短摘要/原文链接，原件保存权限待逐项确认 |
| [NPFC Convention与范围](https://www.npfc.int/about_npfc/convention_and_npfc_area_of_application) | 法律管辖边界原始入口；公海、物种排除与国家水域须区分 | 英文条约PDF、示意图、shapefile入口 | 已读页面；地图注明无法律地位。坐标/排除条款正式建模前逐条核对条约，不以网页地图直接作许可依据 | 未下载/校核shapefile；不画“此处可作业”边界 |
| [NPFC 2025 Fisheries Overview，2026-TCC09-IP01](https://www.npfc.int/system/files/2026-03/NPFC-2026-TCC09-IP01%20Fisheries%20Overview.pdf) | 各成员2025年度渔获/努力量，区分Convention Area与National Waters | 英文9页PDF，年度；数据来自2026成员年报，非实时 | 实际下载、提取并渲染核对第3/4页表格。中国Convention Area鱼种含秋刀鱼、鲐、沙丁鱼、柔鱼；仅用于选择研究范围 | 表间数字与叙述须核对，不能直接据此推断配额履约/超捕；未取得第三方附图再发布许可 |
| [NPFC秋刀鱼公开累计捕捞](https://www.npfc.int/pacific-saury-cumulative-catch-public)；[鲐累计入口](https://www.npfc.int/chub-mackerel-cumulative-catch-public) | 通报累计量及TAC利用，不是船位、实时资源或可捕额度 | 英文HTML，秋刀鱼页明确截至2026-10-10 | 秋刀鱼正文已读；鲐入口本轮读取超时。保存as-of、单位、措施链接；建议每日检查但不承诺每日更新 | 总体TAC不代表某企业/某船可用额度；缺失时标未知，不能推算当前许可 |
| [日本水产厅2026-04-17 NPFC会议结果](https://www.jfa.maff.go.jp/j/press/kokusai/260417.html) | 日本官方对2026/27秋刀鱼、鲐类、沙丁鱼措施的说明 | 日文HTML+PDF，事件驱动；发布日2026-04-17 | 正文已读，作为CMM交叉解读；必须区分“会议合意”与措施原文生效、日俄国家水域合作口径 | [MAFF条款](https://www.maff.go.jp/j/use/link.html)已读：PDL1.0适用范围、署名/编辑说明、第三方权利及标志例外须保留；不推广为全部日本官方资料均开放 |
| [日本FRA 2026研究发布目录](https://www.fra.go.jp[private-server-or-temporary-path])；[太平洋スルメイカ9月30日预报](https://www.fra.go.jp[private-server-or-temporary-path])；[浮鱼8月3日预报](https://www.fra.go.jp[private-server-or-temporary-path]) | 研究机构原创资源/来游预报，日方沿近海和太平洋背景；スルメイカ不能仅按“鱿鱼”汉译与Neon flying squid或茎柔鱼自动合并，也不能等同中国公海渔场预报 | 日文HTML/PDF；目录有不同月份和季次 | 目录和两项正文入口已读；建议周查与季节性专题，提取地理/物种/预测期/方法/不确定性 | [版权页](https://www.fra.go.jp/copyright.html)保留权利且限制转载/修改；首版只做参考摘要和链接，未经许可不翻译整份图表发布。PDF表格自动解析未接通 |
| [WCPFC CMM库](https://cmm.wcpfc.int/) | 西中太平洋高度洄游资源规则；金枪鱼线观察核心，不能用于全部北太平洋非金枪鱼 | 英文HTML/PDF，可区分现行/历史/未生效状态 | 公开页实际GET成功，已读状态入口；中国年报、具体2026鱼种/渔法分布需逐份取证后入库 | 未验证稳定RSS/API及内容再分发许可。观察阶段人工重点摘录，跨组织边界不能仅按经纬度归属 |
| [WCPFC中国2026年报元数据](https://meetings.wcpfc.int/node/32189)；[原PDF](https://meetings.wcpfc.int/file/21027/download) | 中国提交的2025年度作业与市场链，非全体中国远洋船队普查 | 英文17页PDF；文号WCPFC-SC22-2026-AR-CCM03，2026-07-07发布 | 本执行者追加读取第2—4页：延绳钓/围网、太平洋岛国EEZ及公海、热带/赤道附近活动；日本刺身、斐济和泰国罐头加工链。足以反驳“所有业务只看日本以东” | 正文也有明显无效日期字样，说明官方原文需校验；不自动据年报生成当前许可结论。转载许可未确认，首版只做元数据/摘要/链接 |
| [WCPFC CMM 2024-04](https://cmm.wcpfc.int/measure/cmm-2024-04) | 船员劳动标准正式措施，未来生效样本 | 英文HTML/PDF；页面标Not Yet in Force及2028-01-01 | 本执行者已读取措施元数据：截至核验日不能把“2024已通过”写成“已生效”。建议纳入长期日期提醒回归样本 | 未完成所有条款/成员实施/例外的法律审核；不据此推定其他现有劳动义务不存在 |
| [SPRFMO CMM入口](https://www.sprfmo.int/fisheries/conservation-and-management-measures/) | 南太平洋公海非高度洄游资源；东南太平洋茎柔鱼/智利竹荚鱼政策候选 | 英文HTML/PDF，按措施版本和委员会节奏 | 公开列表GET200并留证；本轮尚未完成每个单件、成员数据和西语沿岸国政策全链核查 | 只以SPRFMO代替秘鲁/智利国家水域、港口和海关规则会漏项；观察区扩为核心前补齐 |
| [SPRFMO SC14会议目录](https://www.sprfmo.int/meetings/scientific-committee/14th-sc-2026)；[SC14-Doc19中国年报](https://www.sprfmo.int/assets/Meetings/02-SC/14th-SC-2026/Plenary/SC14-Doc19-Annual-Report-China-a.pdf) | 中国提交的茎柔鱼鱿钓年度报告，识别经营研究线及季节性海区关联 | 英文19页PDF；2026会议，报告2025年度；目录说明SC14最终报告2026-10-12可用 | 本执行者实际下载、提取并核看摘要页；正文描述秘鲁外公海与东中太赤道海域往返 | 原文存在年度/趋势表述及观察员数量口径不一致，进入质量样本；不自动从某句CPUE评价作业前景，不再传播个人观察员清单 |

## 交易、加工、产业原始报道与港口

| 来源与直接入口 | 价值与频率证据 | 本轮状态、访问方式与权利 | 首版定位 |
|---|---|---|---|
| [日本海关统计说明](https://www.customs.go.jp/toukei/info/)；[2026发布日历](https://www.customs.go.jp/toukei/calendar/calend.htm)；[月度发表](https://www.customs.go.jp/toukei/shinbun/happyou.htm) | 官方HS/国别/数量金额统计，按月发布且区分初值/修订 | 已核实公开入口和月度日历；未完成具体HS代码、可下载文件和自动解析；再利用条款须逐数据集确认 | 日本是关联市场，不假定所有鱼货进入日本。只做有统计期的贸易背景；金额÷重量是统计单位价值，不是船端成交价 |
| [みなと新聞](https://www.minato-yamaguchi.co.jp/minato/)；[免费/付费内容说明](https://www.minato-yamaguchi.co.jp/minato/notecontents/) | 日本水产加工/流通产业媒体原创报道，适合补政策之外的经营链 | 入口与免费/付费说明已读；未订阅、登录、验证全文采集、API或RSS；不使用付费摘要绕过版权 | T2原创媒体候选；链接与许可内摘要，付费许可后再扩展。不能以媒体报道替代官方政策原文 |
| [FAO GLOBEFISH prices](https://www.fao.org/in-action/globefish/prices/en) | 国际市场背景，所检看板是欧洲周一首售/批发价格，非本区船端报价 | HTML200留证，PowerBI底层数据未获取；条款/导出能力待核 | 背景观察，不能作为西北太平洋日常报价主源 |
| [新加坡MPA bunkering](https://www.mpa.gov.sg/port-marine-ops/marine-services/bunkering/bunkering-statistics)；[media RSS](https://www.mpa.gov.sg/feeds/media-releases) | 港口原始公告/燃油统计；RSS实测XML50条、当时最新2026-10-19 | GET200留证，但公开条款有传播限制；没有得到大规模复制许可 | 非本区默认补给港，不作为首版核心。只有实际供应链关联成立才启用 |

## 扩容前必须补的业务证据

中国企业/协会与港口官方源、冷链加工/回运成交的持续原始证据仍不足，不能用门户转载补出“强信源矩阵已完成”的假象。以公开企业年报/公告、实际读者访谈或经授权业务资料验证经营链；不编造协会域名、交易API、船端价格和固定登陆港。本轮未读取用户私有船队/贸易/船员数据。

若主打太平洋金枪鱼，需在已读中国年报之外系统补IATTC边界及物种管理、相关太平洋岛国沿岸/港口许可、Fiji/Thailand/Japan贸易链；东南太平洋鱿鱼经营研究线还需在已读SPRFMO中国年报之外补IMARPE资源调查、PRODUCE法规、秘鲁港口/海关及智利适用规则。以上是具体核验任务，不是已经开通的信源。

入库资格表至少增加 `rights_status, rights_checked_at, access_mode, auth_required, allowed_internal_archive, allowed_summary, allowed_translation, allowed_fulltext_export, allowed_publication, evidence_url, review_due_at`。`unknown`默认仅保留最少元数据/链接，不自动把网页全文交给Easel。源健康在既有系统上补解析成功率、表格校验、附件变化、许可到期、核心业务覆盖空缺；低频政策源不能用24小时无更新判死源。
