# 本机隔离试部署验收

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


2026-10-20；基线`deb11ef8ba169ab19482fb9c5dbe1b356768eb80`。用户批准官方PG/WebKit依赖、本机隔离部署、隔离数据测试审核和本地提交。没有生产写入、公开发布、push、Easel发布、第二份调度或付费模型调用；没有改其他项目配置。

## 实际入口和启停

- Web：`http://127.0.0.1:39871`；API：`http://127.0.0.1:39872`；PG：`127.0.0.1:55437/fishery_pilot_test`。
- 来源：`http://127.0.0.1:39871/api/admin/fishery/sources`；文书：`http://127.0.0.1:39871/api/admin/fishery/documents`。
- 仅loopback监听，使用开发管理员旁路及开发CSRF值，没有新建长期token或密码；没有公网访问。网站仍是示例界面，渔业素材由管理员API查看，尚无素材GUI。
- Node24.15.0；采集调度/模型/飞书/IndexNow阀全关，不启动worker、不加载真实.env，凭据目录指向不存在的测试路径。
- 运行时/数据：`[private-local-path]`。没有写入/Applications或注册系统服务，没有启动已有Docker。

已实际验证stop→start，数据保留，最终保持运行：

```sh
/usr/bin/python3 [private-local-path] status
/usr/bin/python3 [private-local-path] stop
/usr/bin/python3 [private-local-path] start
```

脚本只管理本任务PG数据目录及已记录且命令匹配的API/Web进程；遇到他人占用端口会拒绝，不强杀或清理其他服务。不在DB测试执行期间停止PG。

## 依赖来源及校验

| 依赖 | 官方归档 | 下载体量 | 实际验证 |
|---|---|---|---|
| Postgres.app2.9.6 / PostgreSQL17.11 | [官方release](https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-17.dmg) | 119,621,638字节 | 官方asset大小/SHA256一致、DMG校验通过、codesign严格深度验证通过、postgres/psql实际均17.11 |
| Playwright WebKit26.5 revision2311 | [官方CDN](https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2311/webkit-mac-15-arm64.zip) | 80,910,090字节 | 官方HEAD长度一致、ZIP CRC通过、锁定Playwright1.61.1/browsers.json一致、全套浏览器实际启动成功 |

PG SHA256：`b38bb00b8c8702a568270aab85995c550f7f93d1503b818efdc5ff9a519b7168`；签名TeamIdentifier为`ZF84SJ5A3G`。WebKit本地记录SHA256：`a029455b79e20f218992899b87cb59dde6f775c89d79f98ead423698cba08f9b`，未取得发布者独立hash，不把本地hash说成发布者认证。Chromium1228/headless及FFmpeg1011复用已有缓存，没有额外下载。运行时位于任务.runtime/Postgres.app及.runtime/playwright；只读挂载的DMG已经卸载。

## 实时请求与旧原件回放

本轮系统解析为晋江198.18.0.7、IOTC198.18.0.6、福州198.18.0.5。受保护采集在晋江/福州页面请求前、IOTC robots请求前拒绝，没有本轮HTTP响应、正文或PDF。失败收据保留status:null、目标、时间和原因，并写入隔离库审计日志；没有自动重试、缓存回填或改变传输规避拦截。

只读诊断：到保留段路由经utun1024、网关198.18.0.1，Clash Verge/Mihomo运行；系统DNS显示114.114.114.114，HTTP/SOCKS代理开关关闭。这支持Fake-IP/TUN推断，但活跃配置`/Library/Application Support/clash-verge-service/users/501/runtime/config.yaml`读取被操作系统权限拒绝，未使用sudo或替代路径绕过；无法确定具体解析接管来源。没有改DNS、代理、VPN、ALLOW_PRIVATE_NETWORK_FETCH或私网例外。云环境成功不是本机采集成功。

本轮入库来自2026-10-20约05:51—05:52 UTC已获取的原始响应，经重新核对hash、PDFKit回放入库；保留原获取时间及本轮登记/回放时间。四份响应和原收据另复制到任务.runtime/original-archive，不提交第三方HTML/PDF。

| 旧原件 | 原始获取 | 本轮回放/入库 |
|---|---|---|
| 晋江 | 200；HTML SHA256 e4a43b08caaab02742f2dacb030abcd2eaa5a7644773246d2f6cdce372f22fc2 | 正文2,053 UTF-8字节、原始HTML存入隔离库私有档案；模块主记录待审，真实许可unknown |
| IOTC页面/PDF | 均200；PDF SHA256 6d60080cf90f9fe7f0e960b28e73c8f23e24764bcf7d12f240d6ad3c09dac44e | PDFKit5页、正文12,516 UTF-8字节，正文和HTML/PDF字节入私有档案；主记录待审、许可unknown |
| 福州 | 404，原始错误响应hash保留 | 零正文，不创建核心新闻文章；仅失败观察和当前网络失败审计，不标记官方撤稿 |

成功原件经既有upsertMaterial入库，并以“隔离私有档案，非官方撤稿”原因关闭核心公开可见性；availability断言为unavailable，未开全文、未进入公共新闻池。模块文书不关联可公开article，私有核心raw中的文书ID及验收清单保存关联。没有伪造模型分析或分数。

## 实际闭环和语义边界

实际运行pilot-evidence.ts --exercise-test-review，64次HTTP检查全符预期，包含no-store断言：

- 三个主来源真实许可unknown，主文书没有审核；晋江/IOTC待审、福州获取失败无正文。未授权导出409，错误CSRF403，原获取时间和旧证据保留。
- 另建同证据家族的测试克隆，合成许可链接指向example.org、actor/note标明ISOLATED TEST、applicabilityReviewed=false；不是实际转载许可或人工业务批准。
- 晋江/IOTC克隆测试审核后JSON/Markdown导出200，均含isolated_test_workflow_not_business_approval及中文警示，标记参与内容hash。福州失败克隆即使测试批准仍409。
- 相同canonical URL追加合成正文/PDF字节变化：旧revision及未重审新revision导出409，重审后200，保留两版观察。合成改版文件均TEST-ONLY，未冒充真实上游改版或新请求。
- 来源revision更新使旧批准失效，重审后才可导出；本地测试撤回后新旧revision都409。不是对官方撤稿的判断。
- 模块不存在导出缓存链接、公开证据出口或外发队列，对这些不存在入口的绕过检查记不适用；无法收回用户已离线保存的文件。已保存测试导出仅为历史证据，当前再次导出已拒绝。
- 测试克隆和政府转载不计独立佐证；本轮保存每个官方URL的证据家族，未实现跨站转载家族自动识别。

晋江发布字面值为“时间：2026-03-21 19:36”，按+08:00规范为2026-03-21T11:36:00Z。出航原文“20日下午”需结合报道上下文解读，不替换发布日期。报道称晋江船队，出发港为厦门远海通达码头，目的海域北太平洋；不从港口推断企业归属或NPFC措施适用。除发布日期外，这些事件要素仍在原文中待复核，尚无独立结构化字段；scope未知项显式unknown。

IOTC保留Pending、通过年2026（year精度）、异议截止2026-11-18；发布日期/effectiveFrom未知。2027/2028为条款年份，不当成2026年现行限额，未生成配额数字或法律适用结论。112条研究材料不是人工gold，没有模型准确率结论。

## 本轮检查

| 检查 | 实际结果 |
|---|---|
| PG初始化/迁移 | loopback55437、UTC；69项迁移通过 |
| 最终全仓typecheck | 通过 |
| 完整DB suite | 953/953，无失败/跳过；独立fishery_acceptance_test及每文件副本 |
| Web构建 | 通过 |
| 完整Web suite | 13文件59/59，含Chromium/WebKit，无跳过 |
| 整站smoke | 30项：15页面、14机器出口、MCP握手全过 |
| 离线入库和测试审核 | 64次HTTP检查及正文/原件DB hash、非公开availability断言通过 |
| 启停 | stop→start通过，数据保留、最终运行 |
| 实时在线正文采集 | 未成功：保留地址解析触发SSRF，不是本轮HTTP404或超时 |

首轮DB回归952/953，架构检查发现旧适配器手算北京时间；改用@aihot/contracts/time的beijingDate后完整重跑953/953通过，没有扩大测试白名单。standalone239、非浏览器36和早期Chromium10为阶段子集，不与完整数量相加。

日志在任务deployment-checks：final-typecheck.log、full-db-suite-final.tap.log、full-web-suite.tap.log、whole-site-smoke.log、pilot-migrate.log、evidence-run-1/acceptance.json；初次失败日志保留。下载校验报告在.runtime/*-download.json。

## 复现离线闭环

先用start命令启动已有隔离实例；输出目录必须不存在。以下会追加一批隔离记录：

```sh
cd [private-local-path]
env -i PATH=[private-local-path] \
  NODE_ENV=test AIHOT_ENVIRONMENT=test \
  DATABASE_URL=postgres://aihot_test@127.0.0.1:55437/fishery_pilot_test \
  AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials \
  AIHOT_DATA_DIR=[private-local-path] \
  node modules/fishery/scripts/pilot-evidence.ts \
  --archives [private-local-path] \
  --probe-failures [private-local-path] \
  --base http://127.0.0.1:39872 --output [temporary-evidence-path] --exercise-test-review
```

省略--exercise-test-review仅入库保留待审。脚本拒绝非本机/非*_test库、非test环境及非loopback HTTP，不安装依赖、不加载凭据、不访问原网站。当前失败探测不是旧原件新获取的证明。

单次在线入口为`node modules/fishery/scripts/capture-official.ts --source jinjiang|iotc|fuzhou --output <不存在的新目录>`，复用DNS/连接/重定向SSRF检查；HTML/PDF限制6/10MiB。IOTC先将新robots响应与已人工检查的完整快照hash核对，任何字节变化都停下复核，避免部分规则匹配漏掉祖先路径禁令；同源请求间等待10秒。尚未接入worker、自动批准、增量同步或长期调度；当前DNS下不能宣称在线采集接通。

## 网络后续候选（未授权、未执行）

现有防护明确拒绝198.18.0.0/15，私网信源例外也不允许该保留段。本次固定来源入口使用受保护直连；没有已经验证且无需改变网络设置的修复。把ALLOW_PRIVATE_NETWORK_FETCH打开、钉死猜测IP或换传输规避拒绝都未执行。

若用户在Clash Verge中确认当前确为fake-ip模式，且fake-ip-filter-mode为blacklist，最小候选是将下列三个精确域名追加到原有dns.fake-ip-filter列表，保留其他条目；不是覆盖整段DNS配置或改变全局模式。官方文档说明该过滤可让匹配域名不返回Fake-IP，但不同filter模式语义不同，须先确认现有模式。[Mihomo官方DNS配置](https://wiki.metacubex.one/config/dns/#fake-ip-filter)

```yaml
# 仅供确认后的增量合并，当前未应用
dns:
  fake-ip-filter:
    - www.jinjiang.gov.cn
    - iotc.org
    - hyj.fuzhou.gov.cn
```

影响是本机所有应用对这三个域名的DNS回答，代理重载也可能短暂影响连接；保持TUN/代理和应用SSRF/TLS核验。若当前为whitelist或rule，不能套用此片段。实际根因与配置仍未证实，需要另获用户批准后才可修改；之后先核对公网解析，再按原受保护路径重测，仍失败则继续记录，不放宽防护。
