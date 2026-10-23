# 正式海上警报接入验证补充（2026-10-23）

按本次新增授权，继续独立分支 `feat/jma-marine-validation-20261023`（本轮基线 `90581aa`），增加正式全般/地方海上警报的**内部原文参考与审核适配器**。没有合并、部署、注册信源、写数据库或调度；没有调用AI生成、改写、推导预报。未改主工作树、主会话测试环境或运行服务。此前[regular/extra验证](jma-validation.md)和原收据保持为第一轮历史证据，本文补足其正式海警覆盖缺口。

## 官方入口与产品选择

入口均来自[官方PULL页面](https://xml.kishou.go.jp/xmlpull.html)「その他」的实际链接，未根据名称猜URL：

- 长周期：`https://www.data.jma.go.jp/developer/xml/feed/other_l.xml`，每小时更新、可见数日。本轮仅此入口实际GET一次；新增至现有缓存白名单，仍至少间隔一小时才条件重验证。
- 高频：`https://www.data.jma.go.jp/developer/xml/feed/other.xml`，每分钟更新、至少近10分钟。只核实官方链接，**未下载或接入高频轮询**，不把长周期适配器宣称为实时告警。

[官方电文清单](https://xml.kishou.go.jp/xmllist.pdf)确认海警归「その他」；[产品代码表1.1](https://xml.kishou.go.jp/jmaxml_20260806_format_v1_3_hyo1_1.pdf)与[产品解说整理表](https://xml.kishou.go.jp/jmaxml_20260826_manual_list.pdf)对应如下。旧格式、预报和火山海警列出边界，未混入本轮警报白名单。

| 官方产品 | 电文代码 | 本轮支持/证据 |
|---|---|---|
| 全般海上警報（定時）（Ｒ０８） | VPZU54 | 实测；InfoKindVersion=1.0_3，首选现行定时版 |
| 全般海上警報（定時）（Ｈ２９） | VPZU52 | 实测；1.0_2，保留为过渡版对照，不是第二个独立气象信源 |
| 全般海上警報（臨時）（Ｈ２９） | VPZU53 | 实测；1.0_2，临时报，与定时版分别保留，不擅自合并其适用范围 |
| 地方海上警報（Ｈ２８） | VPCU51 | 实测4份；1.0_2 |
| 全般海上警報（定時/臨時）旧格式 | VPZU50 / VPZU51 | 官方代码已核实，本轮窗口未见、未实现旧1.0格式 |
| 地方海上警報旧格式 | VPCU50 | 官方代码已核实，本轮未实现 |
| 地方海上予報（含H28） | VPCY50 / VPCY51 | 是预报，未当作警报；选择器明确排除 |
| 火山現象に関する海上警報・海上予報 | VFSV50–61 | 官方列于「その他」，本轮无样本、未实现；不能宣称正式海警全种类已覆盖 |

R08不是简单改名。[官方规格No12001](https://www.data.jma.go.jp/suishin/shiyou/pdf/no12001)、[技信671](https://www.data.jma.go.jp/suishin/jyouhou/pdf/671.pdf)与[上线通知](https://www.data.jma.go.jp/suishin/oshirase/pdf/20260605.pdf)说明增加着冰警报、分海域风浪等内容。不能只接H29再称覆盖R08，也不能把同一时刻的新旧版累计成两次独立确认。本轮选择器供受控验证，未设置生产优先级、跨版合并或替换策略。

## 本次真实采集与回放

采集时间 **2026-10-23 01:10–01:14 UTC**（10:10–10:14 JST）。Atom及七份警报XML各取一次，全部HTTP200；正文合计 **361,650字节**，其中Atom254,372字节、七份警报107,278字节。官方解说包及代码包另外各取一次，共14,902,732字节，未提交这些原件。两轮归档响应正文总计23,951,393字节（不含HTTP头和网页浏览），远低于10GB；没有重下任何已获取的警报文件。

`other_l`快照共549条/549唯一URL，其中四种已支持警报376条：地方H28共292条，全般R08定时、H29定时、H29临时各28条。另有地方预报H28 168条及观测5条，均未被当作警报。最老entry为10-16 02:25:38Z；此窗口长度不是保留SLA或完整性保证。

| 样本 | 正文字节 | 官方发布时间（JST） | 显式失效时间（JST） | 区域/结构核验 |
|---|---:|---|---|---|
| VPZU54 R08定时 | 48,200 | 10-23 05:20 | 10-24 03:00 | 鄂霍次克海9050；低气压/热带低气压/经纬度警戒域保留原Circle/Polygon |
| VPZU52 H29定时 | 24,777 | 10-23 05:20 | 10-24 03:00 | 同期旧版对照，内容与R08不等同 |
| VPZU53 H29临时 | 8,050 | 10-23 08:20 | 10-24 06:00 | 动态热带低气压影响范围；未改成固定海区 |
| VPCU51 冲绳 | 6,163 | 10-23 08:35 | 10-24 06:00 | 6030沖縄南方海上、6010東シナ海南部、6020沖縄東方海上，3个SubArea |
| VPCU51 札幌 | 10,372 | 10-23 05:35 | 10-24 03:00 | 1010–1050等海区，7个SubArea；编辑/发布官署均札幌管区气象台 |
| VPCU51 函馆 | 5,050 | 10-23 05:35 | 10-24 03:00 | 1110/1120；编辑官署函馆地方气象台、发布官署札幌管区气象台，不能用Atom作者/发布官署归组 |
| VPCU51 神户 | 4,666 | 10-23 05:35 | 10-24 03:00 | 4010瀬戸内海、4020四国沖北部；3个SubArea，含「豊後および紀伊水道を除く海域」「紀伊水道」 |

七份均Status=通常、InfoType=発表；**没有真实訂正、InfoType取消、解除、无警报或训练样本**。当前官方海警产品解说Head表规定InfoType仅発表/訂正；地方「海上警報解除」是警报正文/见出名称，可不带ValidDateTime，不能为了填补样本而伪造一份“真实取消”。

证据见[机器可读收据](evidence/jma-sea-warning-20261023.json)：确切URL、HTTP日期、ETag、SHA-256、字节数、头部日期、地区绑定、原数值/单位的少量路径级摘录和离线缓存回放结果。原文、技术包、提取文本和PDF核对图在隔离任务目录 `../jma-evidence/marine-20261023/`。收据是本机观测，不是官方数字签名，不应将快照中的预测数值用于当前航行。

## 海区范围与字段边界

全般产品的官方整体服务范围为北西太平洋 **100°E–180°、赤道–60°N**，依据No12001；这不是每一项警报的影响范围。单项警报可能为命名海区、移动圆形影响区、经纬度多边形等，须连同警报种类和时效读原XML，不能把整幅服务边界当作危险区。

地方海上警报针对日本附近12个地方海上预报区及细分区域，参见[官方海区与担当官署说明](https://www.jma.go.jp/jma/kishou/know/kurashi/umiyoho.html)、[海区图](https://www.jma.go.jp/jma/kishou/know/kurashi/image/kaijo_yoho_ku.png)及[规格No12002](https://www.data.jma.go.jp/suishin/shiyou/pdf/no12002)。代码/名称核对来自[20261019官方代码包](https://xml.kishou.go.jp/jmaxml_20261019_Code.zip)中的`20260129_AreaMarineAJ.xlsx`：AreaMarineA表78项；AreaMarineJ表中地方警报可用标志为1的48项（12大区及36细分海域）。9999全般海上预报区的地方警报使用标志为0，因此不当作VPCU51的合法地方代码。

适配器保留codeType，按代码及官方原名共同校验；区域代码不是任意数字，也不是陆域行政编码。代码表只核对命名，没有提供已解析的精确边界。**未实现船位点落区、航线相交、Circle/Polygon几何计算或海域法律适用判断。** 无代码的动态警戒范围保留原几何节点，明确标记`original_dynamic_geometry_not_evaluated`；有代码也标记几何未解析。

[官方技信630](https://www.data.jma.go.jp/suishin/jyouhou/pdf/630.pdf)说明濑户内海的风警报可细分水道，浓雾仍用整体区域。本轮神户原件确实有不同SubArea。适配器保留整个原层级：Kind→Property→WindPart等→SubArea→AreaName/Sentence/Base/Becoming，不把所有数值摊平后挂在上层Area。地方见出与正文的警报名称/代码/海区绑定必须一致，否则失败；不将正文预测数字改写为站点生成的预报。

## 生命周期与安全失败

- `Control.DateTime`为发信时刻、`Head.ReportDateTime`为官方发布时间、`TargetDateTime`为电文基点；原时区字面值保留。独立的法律/业务生效起点未给出，输出`effectiveAt=null`，不拿发布时间或基点冒充。
- 活跃海警须有显式ValidDateTime且晚于发布时间；缺失时直接停止审核候选，不用抓取后24小时或普通本地TTL补造有效期。地方全部解除通知是官方文档规定的缺失截止例外，只保留为`official_release_notice`，没有“适航/安全”判断。全般「海上警報なし」也是参考通知，仍须有官方截止。
- 继续按Control.Title/EditorialOffice/Status/EventID（如有）选择最新Control.DateTime，Serial不排序。真实样本佐证发布官署和编辑官署可能不同。訂正替换同XML信息组；不同海区的编辑官署不会因发布者相同而合并。训练/试验由已有读取函数隔离。
- 通用JMAXML的InfoType=取消仍有合成墓碑测试；正式海警当前限定版本未声明此InfoType，因此专用适配器将它作为**源组待核查的安全失败**，不得跳过失败电文继续把旧警报作为当前有效。将来官方产品语义变更需先核文档/版本再实现。
- 未知产品/标题/版本、错误海区表或代码/名称、缺失正文/截止、地方见出与正文绑定冲突、异常XML/实体/外站URL均失败。新旧版不自动合并；不认识的产品未被选择，不等于它不存在。错误、过期、缺报、无数据都不等于解除或安全。
- `parseJmaSeaWarning`返回原始字节副本、原URL和SHA-256，以及保留全部数字字符串、单位、条件、原文空格和嵌套关系的检查树。树只用于内部检查，不重新序列化冒充官方电文；原始XML字节始终是原件。

缓存/预算仍使用第一轮实现：电文URL永久去重、hash核验、pending请求停止自动重试、目录写锁与原子落盘，Feed每小时条件请求、默认100MB日正文预算。跨目录/同IP的其他使用者不在这个预算内，生产仍需父会话统一出口预算。为避免重复下载，本轮用已捕获的真实字节做离线transport回放：每份两次函数调用、只读归档一次，第二次缓存命中且原文hash相同。**这不是实网304或杀进程/断电验收**；不为证明去重再次请求同一JMA电文。

## 验证、交付与尚缺

新增文件：`backend/jma-sea-warning.ts`、`backend/jma-marine-zones.ts`、`tests/jma-sea-warning.standalone.test.ts`、`scripts/replay-jma-sea-warning.ts`（均在`modules/fishery/`）；只扩充原有长周期Feed白名单，没有生产入口、路由或调度变更。

```bash
node --import ./tests/standalone.ts --test modules/fishery/tests/jma-marine.standalone.test.ts modules/fishery/tests/jma-sea-warning.standalone.test.ts
node modules/fishery/scripts/replay-jma-sea-warning.ts ../jma-evidence/marine-20261023
```

原17项+新增11项，共**28项确定性测试通过**，新/相关文件严格TypeScript检查通过；7/7真实样本回放通过，hash/长度全部匹配，二次回放与已提交收据逐字节相同。合成fixture在测试文件中明确标为结构试验哨兵值，**不是官方预测或真实订正/解除证据**。没有新依赖安装、模型调用或凭据变更。

为避免干扰父会话正在进行的P1安全修复，本轮只运行隔离目录里的无端口、无数据库的JMA测试和类型检查；未重跑全仓库/浏览器/数据库测试或启动服务。第一轮记录的全仓依赖不匹配与沙箱listen失败没有在本轮修复，整站集成仍由父会话验收。

仍缺真实訂正/解除/无警报/训练样本；海警取消不是当前产品声明的正常路径；尚未验收高频采集、长期漏报监测、历史补齐、真实网络304/中断、断电恢复、全部产品/版本/区域几何、发布许可文案与现有人工审核/撤销链集成。地方规格亦说明某些系统故障资料不补发，不能把窗口重扫当作完整恢复保证。

最终用途仅为**官方原文参考与人工核验**。遵守[公开XML使用留意事项](https://xml.kishou.go.jp/considerationforxml.pdf)，不改预测值形成独立预测，编辑传播标明责任；未自动登记全文/翻译/发布许可。互联网PULL可能延迟或停止，不能替代船舶GMDSS/NAVTEX、法定守听或船长航行决策；[IMO NAVTEX Manual](https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/Documents%20relevant%20to%20GMDSS/MSC.1-Circ.1403-Rev.2.pdf)及[装备指南](https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/IMO%20Documents%20related%20to/MSC.1-Circ.1645.pdf)可供后续核验，但本任务没有判断具体船舶、旗国、航区的法定义务。
