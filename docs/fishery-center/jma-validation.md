# JMA 气象信源隔离验证（2026-10-23）

> 后续补充：用户授权正式海上警报后，已另行验证other_l中的现行全般/地方海警，见[正式海上警报验证](jma-sea-warning-validation.md)。本文及原JSON保留第一轮regular/extra实测范围和当时缺口；后续适配器白名单、测试数以补充报告为准。

结论：指定的两个官方长周期 Atom 可获取并用于内部气象资料发现；本分支提供离线元数据适配器、显式单次缓存传输函数及17项确定性测试。**不能作为完整、实时、可靠送达的海上航行预警接入。** 未注册生产信源、写数据库、添加队列/定时任务、调用模型、启动/改动运行中服务或部署。

基线为 `90ff396d66759593434fbbd57ce0b241139752b2`，从主仓库只读克隆至独立任务目录，主题分支 `feat/jma-marine-validation-20261023`。已核对 origin 为 `https://github.com/Maidamai/AIHOT.git`，不是 upstream。遵守根目录 AGENTS.md；仓库没有额外 `.agents/`、`.codex/` 或嵌套 AGENTS/SKILL 文件；只读参考本机 memory_summary.md 的证据分层和及时提交约定。原有研究文档中“不push”的历史阶段限制已由本次明确的独立分支提交推送授权更新。

## 本次真实运行

HTTP 采集发生在 **2026-10-23 00:55–00:59 UTC**，即09:55–09:59 JST。两个 Feed 各下载一次，五份 XML 各下载一次。所有七份响应均200，归档响应正文共 **8,687,011字节**；该数字不含HTTP头和浏览官方技术文档的流量。

| Feed | 正文字节 | entry / 唯一URL | Atom.updated | entry时间范围（UTC） |
|---|---:|---:|---|---|
| regular_l | 4,648,731 | 9,510 / 9,510 | 2026-10-23T09:51:28+09:00 | 10-16 01:01:10至10-23 00:50:56 |
| extra_l | 3,428,447 | 5,733 / 5,733 | 2026-10-23T09:54:33+09:00 | 10-16 01:06:14至10-23 00:54:16 |

本次约7日的可见窗口只是快照，不是官方历史保留保证。Feed实际响应 `Cache-Control: max-age=60`；官方说明长周期每小时更新，因此缓存传输函数至少一小时才重验证同一Feed。HTTP缓存时间不能充当气象电文有效期。

| XML样本（文件名中产品码） | 字节 | 观测结果 |
|---|---:|---|
| 亚洲太平洋海上恶天48小时预想图 VZSF61 | 352,187 | 发布03:57:18+09:00、预测基点前日21:00+09:00；`Area.Name=強風域`，无海区编码；几何仍在原XML，未转成航线范围 |
| 地上48小时预想图 VZSF51 | 147,357 | 对照样本，**不是海上专用产品**；无Area编码，不以同前缀推定海区 |
| 台风解析/预报 VPTW60 | 56,429 | EventID=TC2636，Serial=81；发信00:40:41Z，官方发布09:45+09:00，预测基点09:00+09:00，三者不可互换 |
| 新潟气象注意报 VPWW54 | 25,598 | 雾注意报解除的对照样本；InfoType仍为発表，正文解除不是电文取消；地区编码属于府县/市町村 |
| 兵库波浪注意报 VPWW59 | 28,262 | InfoType=発表；兵库县280000、南部280010等均为陆域行政/预报分区，不是海上警报海区 |

五份样本均Status=通常、InfoType=発表，均无Head.ValidDateTime。**没有获取真实訂正/取消/训练电文，也没有实际遇到跨窗口停机补采。** 对应行为由合成XML/模拟传输测试验证，不冒充实网验收。真实采集使用有大小上限的一次性HTTP请求；缓存函数的304、预算和故障恢复路径未对JMA实网重复请求验证。

完整公开URL、SHA-256、ETag、Last-Modified、HTTP日期、时间字段及前四个Area节点摘录在[机器可读实测收据](evidence/jma-20261023.json)。原始Atom/XML和HTTP头保留在任务目录 `../jma-evidence/`，没有提交原文、生产数据、环境文件或凭据。收据是本机采集记录，不是JMA数字签名。

## 实现与使用

- `modules/fishery/backend/jma-marine.ts`：解析Atom和JMAXML默认命名空间的管理/头部及Area元数据；拒绝DTD/ENTITY、不完整XML、不支持的生命周期或命名空间、无时区/非法日期、非白名单URL。二进制输入严格UTF-8解码，SHA-256保留原始字节（含BOM）。不做产品XSD、编码表版本和正文语义的完整验证。
- `currentJmaMetadata`：按官方 `Control.Title + EditorialOffice + Status + EventID（如有）` 分组，以Control.DateTime选最新；不用Serial排序。同组同刻内容冲突关闭候选；訂正取代此前最新报；取消保留墓碑，旧报不会因新报过期而复活；训练/试验独立隔离。调用方必须提供**全部已保存历史及取消记录**，仅传未过期条目会破坏撤销语义。
- `Head.ReportDateTime`作为官方发布时间，Control.DateTime为发信时间；Atom.updated只用于发现；TargetDateTime保留未知/nil；显式ValidDateTime到达即过期。无官方截止时，调用方必须传入本地复核TTL，输出明确 `local_review_ttl_only`。本次回放采用6小时，仅是隔离复核示例，**不是JMA产品有效时长或业务默认值**。状态review_candidate也不代表适航或当前有警报。
- `areas`只是原XML的Area节点及其上下文type/codeType摘录，保留前导零；codeType缺失时保持null。`強風域`或`熱帯低気圧`不是已解析的海区；正文中的Area也可能不是地理区域。未实现坐标多边形、海区映射、风浪值/等级、逐区域解除状态、航线关联和跨产品合并，不可据此对航行作结论。
- `modules/fishery/backend/jma-cache.ts`：显式传入目录、时钟、transport（可用fetch）才执行一次获取；从未接入worker/server/源注册表。每份电文URL只成功下载一次并持久化hash，后续即使跨日也复用本地原件；缓存缺失或hash损坏直接失败，不重新下载掩盖问题。Feed保留ETag/Last-Modified，每小时条件请求。电文URL本身不可因TTL过期重新拉取，需等新Feed条目。

传输白名单只有指定两个Feed与同一JMA主机的`/developer/xml/data/*.xml`，拒绝外站、凭据、查询参数和片段；`redirect:error`，30秒请求超时，Feed正文上限8MB、电文2MB。纯元数据函数没有网络权限，测试只调用注入的本地模拟transport。为fishery模块声明已有的fast-xml-parser 5.11.1直接依赖，只改该workspace的依赖清单/锁条目，未升级依赖、安装新服务或付费。

## 配额、去重与恢复边界

官方[获取说明](https://xml.kishou.go.jp/xmlpull.html)按来源IP统计，**一天达到10GB会封禁**，要求避免重复取得同一文件。缓存目录以JST日切累计响应正文，默认100MB日预算，可显式调整但拒绝超过9GB；发请求前按正文上限预留，成功后按实际正文结算，失败保留预留额。同目录`writer.lock`互斥；原件和checkpoint通过fsync+rename保存。HTTP错误、重定向、超限、进程中断和不明确结果会留下pending并停止自动重试。

预算只约束使用这个目录的调用，**不覆盖同IP的其他会话/机器、其他目录、HTTP头或所有链路开销**。正式接入需由父会话统一每IP下载预算与唯一采集器，不能每进程各开9GB。100MB默认值是保守原型上限，会导致大Feed的全天轮询提前停下；本分支没有常驻轮询保证。

进程重启后，成功checkpoint和hash校验通过的原件直接复用；已有电文记录不能随着feed滚动清理。若中断遗留writer.lock，先确认没有在运行的**该目录**写入者，再人工核对原件/checkpoint/请求收据；若原件已落盘但checkpoint pending，只能人工确认、补记hash收据后恢复，不能删除checkpoint重新下载。若请求是否完成不明，保持隔离。原型未提供自动解除锁或自动修复不明确请求的工具，避免重复下载；未完成故障重启/断电的实机杀进程验收。

Feed恢复不使用“最新时间”游标跳过旧条目，调用方应重扫可见窗口并按完整URL缓存查漏。`jmaRecoveryStatus`标记首次启动覆盖未知、上次checkpoint早于当前最老entry的保留窗口缺口，以及长时间停机后的交叠复核。它只是缺口提示，**没有自动历史回填或完整性认证**；有交叠也不能证明上游从未漏报。Feed/电文HTTP成功不等于完整获取或天气安全；超出窗口不得宣称已补齐。

## 官方范围和用途

[官方电文清单](https://xml.kishou.go.jp/xmllist.pdf)将全般/地方海上警报、地方海上预报、火山海上警报、潮位信息列入「その他」，不在这次指定的regular/extra覆盖范围。本次没有擅自抓取other_l或注册更多源。regular中的预想图和extra中的台风/波浪等陆域产品只能作为气象背景和后续选型依据，不代表完整海上警报。

[XML运用指针](https://xml.kishou.go.jp/jmaxml_guide_20130412.pdf) §2.1.3规定信息组、最新电文、订正、取消和截止；[格式规范](https://xml.kishou.go.jp/jmaxml_20221209_format_v1_3.pdf) §1.6.4区分四个时间字段。[使用留意事项](https://xml.kishou.go.jp/considerationforxml.pdf)要求理解产品资料，不得损害警报原意；改变预测值形成独立预测涉及许可要求；编辑传播需声明经过编辑及编辑责任。保持原意的区域筛选/等义换算不意味着任意AI改写、翻译或航行建议已获准。

本期用途限定为**内部元数据待审、保留JMA发布机关及原文链接**；没有将官方一般二次利用原则自动登记为现有fishery_sources的publication/fulltext/translation许可。发布前由父会话按现有许可、人工审核和publication读取层完成用途文案与撤销联动。维护可能延迟/停止；需要快速可靠送达应另行评估官方指向的专业渠道，本任务没有购买或创建凭据。

## 验证与失败项

复现新增功能（不联网、不连库、不调用模型）：

```bash
node --test modules/fishery/tests/jma-marine.standalone.test.ts
node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2023 --lib es2024 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --types node modules/fishery/backend/jma-marine.ts modules/fishery/backend/jma-cache.ts modules/fishery/tests/jma-marine.standalone.test.ts modules/fishery/scripts/replay-jma.ts
node modules/fishery/scripts/replay-jma.ts ../jma-evidence
```

- 新增17项确定性测试全部通过，新增文件严格类型检查通过。实测回放5/5成功，逐份核对原件长度和SHA-256；重复回放输出与已提交实测收据逐字节相同。
- `npm run typecheck`：失败于未修改的`egress-proxy.ts`连接类型与`entities/decode`缺失。隔离环境复制原仓库依赖后，实际entities=4.5.0、undici=7.30.0，仓库声明分别为8.1.0/8.11.2；本任务未修复无关依赖。
- `npm run test:standalone`：未全绿，既有测试触发`entities/decode`包路径未导出，以及沙箱禁止本地listen导致`EPERM 127.0.0.1`；新增JMA测试在同一命令中全部通过。
- `npm run build -w @aihot/web`：隔离副本构建完成；随后的`node --test apps/web/tests/*.test.ts`未通过，存在沙箱本地listen EPERM；本期没有前端改动。构建前将只读复用依赖替换为隔离的物理副本，构建产物仅位于隔离目录且不提交。
- 未执行数据库`npm test`和服务smoke：本适配器无DB依赖，也没有连接现有数据库/服务或创建运行服务。全仓库验收仍需父会话在受控测试环境补齐，不能把本期17项通过当作整站验收。

尚缺：真实订正/取消/训练/显式过期报样本、实际故障停机与断电恢复、官方海上产品other类别、海区编码/几何和产品版本语义、全天配额容量与多进程共享出口预算、稳定送达/漏报监测、公开用途和现有审核链集成。这些均未在生产启用；父会话统一决定整合与部署。
