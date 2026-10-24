# 生产部署与真实处理结果（2026-10-24）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


当前生产版本为 **d92f8eee0b053f559e0a135e26828f8081e966c6**，父提交 fa8eb3d26ba0da128c0686cd9738bb8213249b2f。同一 feature 分支 `Maidamai/AIHOT:feat/fishery-native-flow-v2-20261024` 已正常提交/推送并远端读回确认，没有 force。实现仓库工作树 clean。d92 仅改 handover、既有 materials 定向用例和部署说明，21/21 定向验证、模块 tsc/diffcheck、独立静态审查通过；没有重跑生产全量测试。

**部署与有界迁移成功；真实模型结果是 BLOCK，且内容核查认为存在误拦截疑点。没有真实发布正例，不能声称评分、写作、归组、刊物已经在该新闻跑通。**

## 实际发布和数据连续性

- 收尾完成 05:09:41Z；API/web/native/archive 四服务实际镜像 `fishery-pilot-app:native-d92f8eee`，imageId `sha256:b94467a76e5efd041bc17afa3f7fea571419f98b6940aaa1784e4f12751f67a6`，AIHOT_RELEASE 均为 d92，旧 manual 保持停止。两个 worker heartbeat 最后观测分别为05:12:49Z、05:12:52Z，release 均 d92。
- 发布目录 `[private-server-or-temporary-path]`。865 个镜像文件逐hash核对，前端85个构建文件与已验fa8逐hash相同；web server hash仍 `7e4088216281e13306692b961348422d19af2d8f69917bd1fc5397bf8b0fd2bd`。
- 先在线私有副本演练通过，再正常停 native/archive、排空，按当次最新状态重核JFA/队列/账本，建立新私有 final 备份。DB dump SHA256 `0de5ccd4cf5ca827fc20860e6b9dd0ea6c84d64cc75344e245c0a7af049995a5`，data tar `f4703d27ff7198ad27d88fa59a70a426c74a4a19e5d860adb7c0d6a929df641b`，远端目录 `[private-release-or-backup-location]`（0700）。没有恢复旧业务库或丢掉自然新增数据。
- 唯一JFA document `aa4e2e7a-67f0-4244-8552-c90f19854928` 接管成功，只处理旧 system-superseded task14ece…与 pristine queued taskc3b0…两个任务；旧 audit995 保留，新增 handover 审计保存任务决定、snapshotHash、分类和原审计ID。没有把 system-superseded 误当真人拒绝继续阻塞。
- 原13条读层 article ID/来源/真实发布时间和发现时间/binding逐项保持；当前全部动态13、精选0。指定政策5f67141e…仍review_only且不可读；MARA5c4a718f…有已付费筛选及实质授权拒发，完整保持。来源权限、全文、原四模型信源和起点2026-10-21T07:13:00Z、金额上限¥10都未扩。
- d92增量未重跑0108、policy初始化、8源profile/recover或legacy退役。fa8阶段已完成这些步骤，八源和原claimed/runId/真实日期保持；首次自然JFA归档partial（2篇正文失败但列表成功/fail0/未暂停），MPA恢复后自然轮成功，详见历史报告。
- 公网匿名首页/全部/feed仍302至原登录页，登录页200，后台/公开API401；API/web仅127.0.0.1绑定。PRIVATE_PREVIEW=true，外发保持关闭，无凭据、鉴权、公开范围或安全设置变更。

## 真实模型闭环：已完成预筛，未发布

新闻原标题：**11月3日から7日は「いいさかなの日」**，中文题意“11月3日至7日为‘好鱼日’”。日本水产厅，来源日期 **2026-10-23（JST日精度）**，原链接 https://www.jfa.maff.go.jp/j/press/kakou/261023.html 。内部published_at为2026-10-22T15:00:00Z，discovered_at为10-23T14:51:32.146Z，backfill=false，未改日期。

新服务首次自然tick领取article `jxr71d4jo1wbyzpbkrob4rwe6`，无需显式dispatch：

| 项目 | 实际结果 |
|---|---|
| analysis | id1，prefilter BLOCK；reason“仅鱼食推广活动，未涉远洋渔业” |
| 请求回执 | receipt46，prefilter_article，completed；实际模型deepseek-flash |
| 用量 | 输入17978 tokens，输出20，maxTokens512，未超过原2048上限 |
| 后续阶段 | scores=null、writer=null，未进入双评分、写作、结构化、归组或事件摘要 |
| 状态 | processing_state=blocked、processing_error=null；grouping_status=pending但没有归组队列/回执/错误 |
| 发布 | publications无该article；统一item detail=not_found；没有story/digest，全部/精选均无该条 |
| 账本 | 新增entry54 received，36116 microCNY（¥0.036116）；累计54 received、735324 microCNY（¥0.735324），pending/unknown=0、未决预留0 |

金额是按真实模型usage计入原累计账本的**估算CNY**，receipt.cost/currency本身为空，不声称是账单核销价。停取前原53个entryHashes逐一保持，只追加这一次合法请求。

实际 receipt 的 `prefilter@aecb27e420` 和 systemHash `11c2c072976d675a31515fbf500c8b3ee194e24d3746e46d1d3ef7d37d00979d` 与镜像实际渲染的 `industry/prompts/prefilter.md` 完全一致；模板为远洋渔业，非AI行业模板。没有因出现BLOCK而重试/重评分/改阈值。

新增snapshot使用 store.hash（对象键递归排序后JSON.stringify再SHA256），同算法迁前/迁后账本hash4e792…保持；自然调用后为7f209…，通过原53逐entry hash前缀不可变证明连续。旧fa8 JSON.stringify顺序算法的441c…与SQL文本5c90…是另外两种序列化，不能跨算法当账本变化。

## 内容事实与模型判断分开

严格只读该article现存body（hash db524330…ba796c），没有重新抓取或读取其它材料/附件。263字中文摘要及最多3段各不超过80字日文依据见 `production-preparation/jfa-final/jfa-content-check.safe.json`。

主体是水产消费推广周及活动汇总，但正文也含海洋环境引起上岸鱼种/捕捞期变化、年度合同整船采购定置网天然鱼、低利用鱼加工利用和渔民合作等具体资源/采购实践；未见新增许可配额、船员、跨境通关或作业政策条款。独立reviewer认为这些事实难满足宽召回模板“只涉及无关行业或空泛广告”的BLOCK条件，**疑似过度排除，不能称正确过滤**。该质量判断不自动等于PASS、可发布或精选；未修改实际blocked状态或付费重跑，后续标准/样本校准由root按任务继续处理。

## 刊物和出口的实际边界

日/周/月报真实保存和目录均为0。d92首次reports.compose（run164）真实failed，日志底层原因仍为 `daily 2026-10-24: nothing judged in its window`；不是未运行，也没有用假日期补刊。周/月没有首日报供汇总，未进入模型。

05:19:17Z实际网页loopback `/items/jxr…` 为404且private,no-store；既有API `/api/v1/items?limit=50` 和RSS均读取200且无该ID。公网门禁保持。没有可读发布，因此没有声称本次获得API/RSS/MCP的发布正例或认证访问正例；原出口本地测试不替代生产发稿结果。

## 安全执行记录与证据

1. fa8时一次性路由诊断通过--env-file加载完整models.env，被自动审批拒绝；确定未执行、未重试。改用明确允许的非秘密路由及key变量名存在boolean核验，10能力路由一致。正式服务必要Compose注入是独立部署动作，正常获准；d92没有重复此诊断。
2. 两次收尾验证预期过严已留证修正：fa8把loopback缓存标志误当登录跳转；d92要求archive所有阀显式字符串false，而原配置FEISHU_CONTENT_PUSH_ENABLED缺省即false。都经源码/旧新实际flags对照，只改验证/元数据，没改安全配置或重启/重复迁移。
3. 一个临时只读observer pool1等待已精确停止；另一个observer旧stories.status字段已在0051删除，修观察投影后重读。均无业务状态/模型影响，生产四服务没有因此重启。

主要安全证据：

- `production-preparation/jfa-final/deployment-summary.safe.json`、`runtime.safe.json`、`archive-valves.safe.json`、`http-final.safe.json`
- `production-preparation/jfa-final/production-before.safe.json`、`production-migrated.safe.json`、`handover-summary.safe.json`、`production-running.safe.json`
- `production-preparation/jfa-final/business-outcome.safe.json`、`reader-http.safe.json`、`jfa-content-check.safe.json`
- `production-preparation/jfa-preview/preview-summary.safe.json`（独立副本0请求/0worker）
- `verification/supersede-handover-commit-manifest.json`（SHA c89da90…9681fd）和完整69文件manifest（SHA a06d4d74…954a）
- `production-preparation/model-routing-approval.safe.json`（原拒绝与安全替代）

此前fa8完整上线/八源恢复的历史记录见 `production-deployment-fa8-report.md`。当前部署没有凭据/审批阻塞；尚无真实发布正例，且本例预筛质量存在明确待审疑点，48小时自然运行观察尚未完成。
