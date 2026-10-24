# 部署

### 远洋资讯原生流程迁移（2026-10-24）

此节是发布操作清单，不代表已在生产运行。普通资讯主线切回 core：预筛、双评分、structure、写作、归组、精选、事件综述和日/周/月报使用原生链；材料工作台只保留证据与专项审核。首页恢复上游精选timeline，空精选不再回退到普通文章池；相关低分稿和有效历史参考在 `/all` 按真实日期阅读，不删已有历史。网页以精选、全部动态、热点、主题及三类刊物为阅读入口，保留本站名称、品牌、分类、私有预览鉴权、来源全文许可和外部推送权限。

**部署前只读检查与副本预演：**

1. 固定待发布版本，并取得新的数据库、私有归档及部署配置快照；API、web、原生processor和archive使用相同版本。部署文件不得包含密钥，使用既有私有凭据注入。不要把审查日期的53次/¥0.699208当作上线账本现状。
2. 停止旧普通新闻自动派发及旧consumer取新任务，等待在途请求落账。逐项导出文书/核心article修订、观察、用途、当前有效binding、flow/job、核心receipt及原累计发送账本；pending/unknown/refused、running与active必须逐项说明。账本连续、未决为0、原10元上限及既有模型/端点/容量全部核对后才考虑启用。不能初始化第二份额度或根据核心receipt数量重建旧账本。
3. 在恢复的 `_test`/`_ci` 副本先执行迁移并运行只读 `status`。比较 `fishery.native.processing` 的 `sourceIds`、`createdAfter`、`enabled`、revision，以及每源归档授权、真实频率、下次执行、游标和逐篇阻塞。适配器登记不等于采集、模型或公开范围授权。原四源为 MARA、福建省局动态、福建通知公告、JFA；ITF/FAO/MPA后续单独扩围，NPFC保持专项范围，JMA独立事项，IOTC停用。
4. 用明确文书ID预演旧任务接管，核对只有未付费、无产物、无人工决定的普通自动占位可转原生。先保存预演结果，再执行明确的接管命令；已付费结果不伪装成原生analysis，仍需逐条验证兼容性。有效13条历史参考及当前证据绑定保留；拒绝、撤回、隔离和仅审核不释放。指定政策 `5f67141e-47ee-4521-bd66-7e842936c02f` 只审不发；MPA `292f8e02-dcde-4bb6-9839-df372a1e142a` 保留真实历史日期。
5. 执行下方隔离验证，确认低分相关稿进全部动态、高分增量稿按真实评分进入精选，多源事件、综述、日期和刊期边界正确，所有公开出口同资格。采集与模型只连本地假服务，推送一直关闭。周/月边界使用固定时钟演练，并与真实出刊区别记录。

```bash
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node scripts/fishery-native.ts status
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/fishery_native_test MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

`status` 为只读，不发送模型请求。`handover` 与 `initialize-review-only` 默认dry-run，只读展示目标检查；`--execute` 才写。`configure` 是显式写操作，先保持 `--enabled=false` 记录已批准的来源/时间范围。不要用未审核的全库脚本代替逐项接管。`fishery.native.processing` 缺失或关闭时不会隐式启用普通处理。后台 `/admin/fishery/collect` 与只读 `/api/admin/fishery/native-processing` 展示实际范围、账本和最近处理状态，完整失败记录查看 `/admin/runs` 与内容诊断。

先在副本核对下列命令的目标与输出，再将相同范围用于发布。`<...>` 必须替换成核对后的真实值；本手册不授予扩大处理范围的权限。

```bash
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node scripts/fishery-native.ts initialize-review-only
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node scripts/fishery-native.ts retire-legacy --actor='<操作者>' --reason='<不少于12字的旧任务核对原因>'
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node scripts/fishery-native.ts handover --documents='<明确的1至20个文书UUID>' --actor='<操作者>' --reason='<逐项核对后的接管原因>'
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node scripts/fishery-native.ts configure --sources='fishery-column-moa,fishery-column-fujian,fishery-column-fujian-notices,fishery-column-jfa-press' --created-after='<已批准的ISO起点>' --enabled=false --actor='<操作者>' --reason='<不少于12字的范围核对原因>'
```

零请求预演通过后，先用 `initialize-review-only --execute` 固化指定政策限制，再对完全相同且已核对的ID执行 `handover ... --execute`，保留输出和审计。接管本身不派发模型；显式开启同范围 `configure ... --enabled=true` 后，原生消费者才会扫描接入。`dispatch --documents='<明确UUID>'` 只对已配置范围和当前用途排队，不绕过许可。每次写操作之后重跑 `status`，比较范围revision、旧任务删除数量、用途和账本增量；初始化和接管均应零新增模型请求。

**迁移、清理与启动顺序：**

停止旧消费者后，按 `node scripts/migrate.ts` 执行新增迁移；迁移完整文件名记账，不改已发布文件。新增schema迁移 `0108_fishery_document_purposes.sql` 仅建立用途表；指定政策通过上方显式初始化写入review_only，须在开启消费者前完成。`fishery.flow.dispatch` 保留现役专项提名范围，只撤掉其普通新闻分支，不能整key删除。旧 `fishery.news` 队列先停消费者并核对active/未决请求，再用 `retire-legacy` 默认dry-run列出旧队列与普通占位；`--execute` 在同一处理租约内仅取消未开始的created/retry旧news任务，完成及历史任务保留，不由worker启动偷偷删除。旧普通占位只有经显式接管才删除，审计保存原ID与状态。`fishery.flow`、业务指南、证据核查、历史回执及专项发布绑定仍在使用，不删表。运行前核对迁移清单，若接管删除占位会改变现有数据，先保留快照与预演记录。

采集语义profile现只包含URL、列表与正文获取配置。已有旧profile先停止同源归档并读取原hash，逐源显式迁移，不能删除游标重新初始化：

```bash
MODEL_CALLS_ENABLED=false COLLECT_ENABLED=false node modules/fishery/scripts/migrate-column-progress.ts --column '<已核对栏目ID>' --expected-profile-hash '<当前持久profile哈希>' --reason '<不少于12字的采集配置核对证据>'
```

这是零GET、零导入、零模型的游标写操作。若需恢复旧partial已完成进度，另加 `--recover-round '<确切最新已结束roundID>'`，只在原before/sourceBinding与列表回执均能核对时恢复；未完成轮先按原ID显式resume，不能清零或跳过未知结果。保留历史、失败记录、首次发现时间及article原日期。新partial在列表成功时保存成功身份、firstSeen及逐篇待补证；`lastListingSuccessAt`、`lastBodySuccessAt`和`bodyFailures`分别显示，只有真实列表失败累计源退避与暂停，单篇正文失败不冻结同源新稿。

新的原生消费者使用 `WORKER_PROFILE=fishery-native`；示例叠加配置在 `modules/fishery/deploy/native-processing.yaml`。它使用既有数据库、私有凭据、data卷和累计账本，默认模型关闭；同一处理租约内还消费专项flow和非付费发布，不启动通用采集、向量服务或任何对外推送。专用采集仍由独立 `fishery-archive` 负责，每源只有一个采集器。full、native、manual三类处理进程互斥，共用独占处理租约；scope启用时full拒绝注册消费者。切换先停止旧执行者取新任务并排空在途，再释放租约启动新进程；专项单次操作也须遵守同一租约，archive另有每源租约独立运行。

原生常驻进程采用单副本 `restart: unless-stopped`，正常停机给515秒排空。故障重启仍须重新取得独占处理租约并核对同一持久账本，pending/unknown/refused保留原预留并阻止新请求；恢复已有回执不能自动重付未知请求。上线前在本地假服务中验证请求前中断、响应后中断和进程重启，不以容器重新运行当作费用已经核清。旧manual-processing的 `restart: no` 仅适用于专项人工操作。

保持模型开关关闭，先核对API/web私有预览、来源/范围、任务、账本和受限对象。启用scope会取得同一处理租约，因此必须先停止full/native/manual执行者取新任务并排空在途、释放租约，再执行 `configure ... --enabled=true`；不要在已运行的native进程旁修改启用范围。随后用模型关闭的native进程检查注册与状态，核对后正常停止，最后只为新processor明确启用模型并启动。模型边界也覆盖 `translate_body`，但当前来源保持summary-only，受控native不注册 `content.translate`，没有启用或验证全文翻译调度。未来仅在来源明确授予 `site_fulltext`、另行核对处理范围及2048-token分段验证后才接入，不能把边界覆盖说成能力已经开放。所有当前原生付费步骤仍在发送前检查原授权和金额预留，沿用累计10元账本；原生写作/周月总述请求受原2048输出token及96,000字节包络限制，不因原函数请求较高输出而扩大额度。超限、截断或失败须保留可见停因，不算成功；如需扩大容量须另列发布授权。飞书、邮件、IndexNow、全文及公开上线配置逐项独立核对。

运行后先观察原四源至少48小时并跨过两个日报边界：逐篇候选应有处理结果或明确阻塞，同源坏附件不冻结新稿，重启不重复付费，日报真实出刊，指定仅审核仍不可读。之后才评估ITF/FAO/MPA扩围；没有真实生产记录时只报告本地验证通过。

**回退：**

发现用途误放行、证据错配、重复计费或账本不连续，先关闭对应自动动作并正常停止取新任务，等待在途落账；保留全部新增文书、原件、审计、回执和费用。关闭原生scope后使用预先验证、能识别新用途和现有任务的兼容镜像恢复API/web/必要消费者，不盲启旧普通flow，也不恢复旧数据库抹掉已发生的费用。若旧镜像不认识新用途或新任务阶段，不能直接回退执行者；保持模型关闭并采用兼容修复版本。私有鉴权与来源权限保持原配置。

## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/KKKKhazix/AIHOT.git myhot
cd myhot
node scripts/init-env.ts --llm-key <你的模型 API Key>
```

`init-env.ts` 会生成 `.env`，填好随机密钥和管理员密码，并把密码打印一次。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `ADMIN_PASSWORD`（至少 12 位）、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。

启动前检查 `.env` 的 `SITE_URL`：本机试用保留 `http://localhost:3000`；部署到服务器时改成读者实际访问的地址。例如通过服务器 IP 访问时（把示例 IP 换成自己的）：

```dotenv
SITE_URL=http://192.0.2.10:3000
```

RSS、分享链接、站点地图和 Agent Markdown 中的绝对链接都使用这个值，不会随浏览器访问的地址自动改变。使用域名和 HTTPS 时按下方「配域名和 HTTPS」设置。

配置完成后启动：

```bash
docker compose up -d --build
```

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用管理员密码登录。第一次启动会导入示范信源，一两分钟后开始出现内容；第一次导入的一百多条资料大约半小时处理完（每条都要预筛、评分、结构化、写标题摘要，再归组）。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。`web` 只接收网站地址、API 地址等网页配置，通过 HTTP 读取 API；数据库、模型和管理员密钥，以及数据卷，只交给后端容器。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源和图片时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `site/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

MCP 默认接受 `SITE_URL` 的主机以及 `localhost`、`127.0.0.1`、`[::1]`。额外主机用 `MCP_ALLOWED_HOSTS` 配置，以逗号分隔，例如 `extra.example:8443,[2001:db8::1]`。主机名不区分大小写，IPv6 必须加方括号；可带 0–65535 的十进制端口，匹配时忽略端口。包含路径、用户信息或非法端口的配置不会生效。`127.1` 等别名需要明确列入；此配置只影响 Host 校验，不扩大浏览器 Origin 许可。

前面有 Nginx、CDN 这类缓存时，要遵循应用返回的缓存期限（`Cache-Control`）：公开网页、导航数据、API、RSS、条目 Markdown、报告分享图、站点地图，以及接入说明 `/api/v1/agent` 和 `/openapi-v1.json`（五分钟到期后也要重新验证），都不要另加更长的缓存期，不要在到期后离线返回旧内容，也不要在转发旧响应时重新起算它的寿命；不要让代理和 CDN 叠加缓存动态内容。框架不代管自建站的 CDN，也不替它清缓存。

### 私有预览的 Web 缓存

在 Web 进程设置 `PRIVATE_PREVIEW=true`，HTML 与导航数据返回 `private, no-store`，浏览器不复用已访问页面、列表快照、展开的报道分组或点击时的旧摘要；从浏览器往返缓存恢复时整页重载。收藏仍保留在本机。未设置或设为其他值时保留公共站原行为。

这是 Web 缓存策略，不授予访问权限，也不代替反向代理或 API 的身份与资格验证；私有预览仍须保护所有内容入口。此变量不需要传给 API 或 worker。使用自带 Compose 时，通过 Web 服务的 `environment` 或专用 override 显式传入；仅写入 `.env` 不会自动进入未列出的容器环境。已有标签页须重新加载以采用此策略。

### 更新

新增选填的 `PRIVATE_FEED_HOSTS`：信源订阅或列表地址用自建在内网的服务（比如 RSSHub）时，把它的主机名写进去，不必再打开整站的 `ALLOW_PRIVATE_NETWORK_FETCH`，用法见 [信源](sources.md)。不设置时行为不变；无需数据库迁移。

周报、月报的周期内，应有日报齐全且原始正文条目全部为空时，自动跳过该期，避免每半小时重复报错；归档里不会新增空周报或月报。首个周期从全站最早日报开始检查；没有可汇总条目时，若缺失日报、原有条目后来无法公开或正在人工更正，仍保留原有错误。无需数据库迁移或配置修改，升级后下次定时检查生效。

正文原生视频修复会为已有可用视频补播放控件，并去掉空播放器，不写回文章、不调用模型。旧版清洗时已经丢弃的媒体地址无法从存档恢复；升级不批量重新抽取，已有成功正文会跳过抽取，内容哈希相同时重新抽取也可能保留原 HTML。后续新正文按[信源说明](sources.md)保留原生视频，文件继续由浏览器直连原站，签名地址可能过期。

正文插图里的内嵌 SVG 图改为保留原站写的文字说明（见[信源说明](sources.md)），只作用于之后抽取的正文；已存的正文不变，升级不批量重新抽取。

先按下方 [备份](#备份) 一节备份。构建完成后停止旧服务，再运行迁移和新版服务：

```bash
git pull
docker compose build
docker compose stop api worker web
docker compose run --rm setup && docker compose up -d
```

迁移成功后再启动服务；迁移失败时先查看错误，不要继续启动。使用 HTTPS 配置的站点继续保留 `--profile https`。旧的 API 和 worker 要在迁移前停下：迁移可能删表删列，旧代码还在跑会出错；正常关闭 worker 会等进行中的付费调用收尾（最长三分多钟）。非 Docker 部署也按“备份、构建、停止 API/worker/web、迁移（`scripts/migrate.ts`）、种子数据（`scripts/seed.ts`）、启动”的顺序更新。

新迁移遇到长期占锁会报出文件名和等待超时，先处理占锁事务，再重跑 setup，不要跳过迁移或改写迁移账本。并发索引创建中断可能留下无效索引：核实报错中的对象后，用 `DROP INDEX CONCURRENTLY <索引名>` 清理该失败索引再重跑；有效但定义不同的同名索引须先核对差异。这些保护不改变上述 Docker 更新顺序，跨旧版本升级仍可能执行历史上的破坏性迁移。

下面按时间从新到旧列出每次更新要注意的事。

#### 渔业新闻主链路纠偏（2026 年 10 月 23 日）

无数据库结构迁移、无新环境变量。先备份并停止栏目worker，核对没有未完成round或付费请求；新闻栏目的旧 `fisheryColumnProgress` 档案游标需显式迁到最新列表的新profile。迁移应在原栏目锁下保留旧cursor完整审计、revision递增、completed身份及定时nextAt，清空旧翻页pending；不能改NPFC游标、历史资料或预算。代码遇旧profile会拒绝抓取，不能靠删状态绕过。

发布后以既有 `syncFisheryPublications` 零模型同步当前合格摘要的分类标签，再核对历史资料仍可读、首页只显示非历史资讯。回滚停worker并恢复旧镜像；若新游标尚未消费，可精确恢复审计中的旧cursor。若已有新轮次，保留新状态并停止对应worker，先对账，不能恢复整库或费用账本。旧稿不重新计费、不自动提高法律有效性或全文许可。详见模块操作说明。


日报缺期告警按北京时间的具体日期跟踪，跨午夜不会自动恢复；只有对应日报存在才发恢复通知。新缺期检查最近 7 个日历日（含今天），不早于最早的日报或 reports.compose 运行记录；没有历史记录时只检查今天。已告警的日期在这 7 天里一直跟踪，关闭采集/模型或 worker 启动宽限期也不会把缺期当成恢复；超出 7 天仍没有日报的，发一条“没能补出、停止提醒”后不再提醒。旧的 report.daily 状态自动按首次告警时间迁移，保留提醒间隔。出刊后两小时告警、每小时提醒及飞书开关保持不变；无需数据库迁移。自定义 responder 若按旧 `report.daily` 精确匹配，需改为识别 `report.daily:YYYY-MM-DD` 日期键。

#### 读者文字的改用词（2026 年 10 月 9 日）

没有迁移，没有必填的新环境变量。行业包多了 `industry/wording.ts`（读者文字里不用的词，模板里是空的）和提示词 `mend-wording.md`；合并时这两个文件随更新带进来，自己的行业包没有冲突。词表空着就不查、不多调用模型；写了词以后，用了这些词的标题、摘要、推荐理由会多一次模型调用（模型步骤“改用词”，可用选填的 `WORDING_MODEL` 单独选模型）。说明见 [把它改成你的行业](customize.md)。

#### 导航里可以不放某些入口

没有迁移，没有新环境变量。`site/site.ts` 多了 `NAV.hidden`（目前只支持热点榜 `"/hot"` 和主题 `"/topics"`，见 [把它改成你的行业](customize.md)）；框架从 `@aihot/site` 读它，**自己维护 `site/site.ts` 的站，合并时照模板加上 `NAV`**，不加通不过类型检查。模板里是空的，导航和原来一样；隐藏入口不会关闭页面或公开接口。

#### 原帖展示与引擎同步（2026 年 10 月 6 日）

没有新增必填环境变量或数据库迁移。自己维护 `site/site.ts` 的站点需补上 `REPORTS.quiet`，可对照示范配置：日报时段内有资料经过评判、但没有新大事时照常出刊，用这两句做标题与导语；导语的 `{start}`、`{end}` 是时段起止。没有任何资料经过评判仍算采集或判断失败，不伪装成平静的一天。

空正文、纯链接的 X 帖子保留原来的链接、图片和引用，不调用写作或翻译模型；来源允许展示全文时，纯图片帖子也可以显示，现有展示与再分发许可继续生效。已取得实际正文的 X 长文照常处理。旧译文也不会再出现在这些原帖的公开页面里。已生成过错误标题摘要的帖子，可在更新后用 `packages/backend/src/publication/publish.ts` 的 `publishArticle(id)` 重建公开内容，不需要重新调用模型。

MCP 的 `subscriptions/listen` 现在立即返回 HTTP 404 和 JSON-RPC `-32601 Method not found`。服务从不推送变更，普通工具调用照常使用；客户端收到这个回答后不应重试建立常驻订阅。

无需数据库的测试改为 `*.standalone.test.ts`；`npm test` 仍运行全部后端测试，只给需要数据库的文件建副本。可用 `npm run test:standalone` 单独运行这些测试。

#### 社区修复、时间规则与读取优化（2026 年 10 月 4 日）

公开接口版本仍是 4.0.0。没有必填的新环境变量；新增一个选填的 `LLM_REASONING_TOKENS`，见下面 `site/models.ts` 一条。

**开关只认 `true`**：`.env` 里所有 `*_ENABLED` 开关（`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 等）只有写成小写的 `true` 才打开。以前写 `1` 或 `TRUE` 也算打开，现在都当作关闭；升级前检查 `.env`，改成 `true`。

**迁移**：新增七个迁移，按上面的步骤等 setup 跑完即可。它们都不删数据，不重写文章或已有向量，也不调用模型；迁移按完整文件名记账，编号相同的不同文件各自执行。

- `0055_publication_selected_published_idx.sql`、`0056_analyses_composite_id_idx.sql`、`0056_publications_pool_category_timeline_idx.sql`、`0057_publications_pool_channel_timeline_idx.sql`：并发建立查询索引，不阻塞正常读写。
- `0056_publication_release_selection_stats.sql`、`0057_analyze_publication_release_selection.sql`：为公开列表创建并收集查询统计。
- `0083_publications_selected_source_idx.sql`：并发建立按信源统计精选的覆盖索引，减少后台统计时的读取。

这次连同这些索引一起减少了公开读取与事件召回的数据库开销，接口内容、搜索权重和事件候选范围不变。

**自己改过这些文件的站，合并时对照新文件**：

- `site/site.ts` 多了几项：
  - `EDITION_TIMES`、`EDITION_WHEN`：日报、周报、月报的出刊时间，原来写死在代码里；排程、日报的时间窗口、缺期告警和提到时间的文案都读它。`public/` 里的文件用占位 `{{dailyTime}}`、`{{weeklyTime}}`、`{{monthlyTime}}`。
  - `ITEM_COPY`：推荐理由叫什么，网页和分享图上显示不显示评分。
  - `REPORTS.descriptions`、`entry`、`metricUnits`、`shareUnit`：报告页面的描述和版面上的说法。
  - `ABOUT`、`CARDS` 里提到出刊时间和推荐理由的文案改成引用上面几项。
  - `DEPLOYMENT.directImageHosts` 改名为 `directFetchHosts`，采集和图片共用这份直连名单。
  - `SITE.feedbackLead`、`SITE.feedbackEmailHint`：反馈页标题下的一句话和邮箱框提示，原来写死在代码里。
  - `SITE.psb`：可选的公安备案号，未办理或不适用时填 `null`。
  - `ABOUT.lead` 里 `{sources}` 两边不再写空格，页面会自动加。
- `site/models.ts`：评分调用参数现在由具名预设的 `scoreCall` 配置；保留 `glm-5.3-flash-selection` 时同步示例中的温度、输出额度和超时。已有自定义模型没写这一项时沿用引擎默认值。
- `site/models.ts` 的 `ModelPreset` 和 `site/site.ts` 的 `Founder` 类型统一从 `@aihot/contracts/site-config` 导入，原有站点配置值保留；自定义过这两个文件时同步类型导入，避免漏掉引擎新增的可选字段。
- 数据库迁移遇到正在导出的 `pg_dump` 会先等待，最长与 worker 排空时间相同；超时后在执行这条迁移前退出，等导出结束后重跑更新命令。其他占锁仍快速报错。
- 迁移会删除已停用的 `translation_attempts.request_tag` 列；翻译正文、尝试记录和付费回执保留。来源发布时间的原始精度另行保存，旧资料无法确定的精度保持未知，不把零点自动当作来源只写了日期。
- `site/models.ts`：推理模型的额度改成明确配置。默认模型设 `LLM_REASONING_TOKENS`，具名模型写 `reasoningTokens`。原来只有名字以 `-think` 结尾的具名模型会多给 4000，这个做法去掉了；自己加过这类模型的，补上 `reasoningTokens: 4000` 才保持原来的额度。推理模型把额度用光时，报错会写明 `finish_reason=length` 和该改哪一项。
- `industry/prompts/story-digest.md`：事件概览换了写法，第一句讲清核心变化和目前的结论，再补必要背景，分成短段，不按日期复述下方的时间线，不评论报道本身，也不再写死行业。已有综述不会被批量重写，随新报道逐步换成新写法；想让某几个事件立即重写，见 [综述评测](story-digest-evaluation.md) 的最后一节（`rewriteStoryDigest`，每个事件一次模型调用）。
- 自己维护的 Compose 文件可以删去 `LOCAL_ROUTER_URL`：分享图预热现在直接复用后端渲染器，不再请求固定的本机端口，没有代码再读这一项，自带的 `docker-compose.yml` 已经去掉。分享图地址、格式和缓存约定不变。

**采集与发布时间**：

- **首次导入之后不再收信源的存档**：以前新信源首次导入后，第二次抓取会把订阅里剩下的旧条目全部当历史内容收进来，逐条付费分析（示范源一次就有上千条）。现在之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目；没有日期的照收，X 账号不受影响，见 [信源](sources.md#规则旧文不刷屏) 的“旧文不刷屏”。升级前已经收进来的旧条目按原文时间归档，不进“今天”和日报，分析也早已跑完，不用处理。
- **没有可信发布时间的新资料先不公开**：先不进公开列表、精选、报告、热点和推送，从原信源或原文页读到日期后再判断新旧。日期未知时，文章页、结构化数据和 Agent Markdown 标“收录时间”，RSS 不写 `pubDate`；OpenAPI 注明事件时间线和日报快讯的 `publishedAt` 这时是收录时间。
- **JSON 接口里不带时区的时间**（如 `2026-09-30 17:43:58`）按信源的 `publishedAtUtcOffset` 读，默认 `+08:00`。以前按服务器时区读，Docker 里是 UTC，所以已有这类信源的新条目时间会提前 8 小时，变成正确值。
- **文章页日期使用同一来源时区**：详情页补日期与正文提取先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，再默认 `+08:00`。只作用于之后的采集和补日期，不批量重写已有发布时间。
- **详情补全**：失败或超出本轮次数限制的日期、标题、摘要会在后续采集中补齐，已确认的正文保持原样；信源请求成功却漏掉日期、标题或正文时也会补全，并记进信源健康。Jina 详情规则要与实际返回格式匹配；固定采集起点、Intercom 日期章节及视频描述的配置见 [信源](sources.md)。
- **视频播放页不当正文**：对所有信源生效，YouTube、Vimeo 播放页不再作为文章正文抓取，YouTube 视频页也不再被当成图片。RSS 的视频描述只作摘要，订阅直接提供的真实文字保留。升级不会批量删除或重新分析已有正文；旧视频记录混入播放器导航的，先逐条核实，可在后台“内容诊断”的详情页设为仅摘要，停止展示错误正文。
- **RSS**：确认摘要就是全文的文字订阅可以设 `summaryIsBody`（Atom 的 `summary` 也算）。没有网页的播客单集，原文链接改为音频或视频文件，不再去抓网页。
- **预览和正式采集用同一组过滤**：后台“预览抓取”也套用地址前缀、分类、噪声词、地址改写和 `publishedAfter`，预览里看到的条目就是正式采集会存下的。
- **关掉采集后不再取信源图标**：`COLLECT_ENABLED` 不是 `true` 时，每天 04:40 取信源图标的任务也停下，不再访问信源网站。
- **已核实的历史日期可以纠正**：运维脚本先调用 `admin/content.ts` 的 `previewPublicationDateCorrection`，再按预览给出的版本和校验值调用 `correctPublicationDate`，并记录操作者与理由。只接受新旧日期都早于七天窗口的明确更正；保留材料修订、选稿与归组，不重跑模型。材料或日期已变化，或这次纠正会改变其他公开决定时，会拒绝操作并要求重新核对；没有批量回填，也没有新增公开接口。
- **公开评分可以人工更正或撤销**：后台内容详情支持“按模型”“撤销评分”“人工评分”。人工评分接受 0–100，撤销评分使公开值为 `null`；清除评分覆盖后恢复已保存的模型分数。更正要填写理由并核对版本，保留原始分析和审计记录，同步更新网页、API、RSS、Agent Markdown 与 MCP，不重跑模型。既有文章不会因升级而批量改分或重新入选。

**公开出口**：

- **按类别筛选按 `PUBLIC_CATEGORIES` 走**：API、RSS 和 MCP 的 `category` 取所有在公开接口里算作这一类的类别。不合并分类的站（默认就是），按 `tip` 查不再带出观点；没有 `tip` 类别的行业也能通过类型检查。
- **往期报告仍需重新验证**：日期、周和月份确定的是哪一期，不代表内容永久不变。报告保留出刊时写下的标题和摘要，来源名和引用时间跟随当前公开资料；已撤回的引用及依赖它的导读、封面不再分发。保留报告副本的客户端在 `Cache-Control` 到期后带 `If-None-Match` 重新请求。
- **自行配置过 Nginx 或 CDN 缓存的站点要检查规则**：按 [配域名和 HTTPS](#配域名和-https) 末尾的要求核对，并在更新时清理这些路径已有的代理和 CDN 缓存，包括接入说明 `/api/v1/agent` 和 `/openapi-v1.json`。
- **站点地图重建失败时不再无限沿用旧文件**：进程、磁盘副本和 HTTP 响应共用原来的五分钟期限，过期且无法重建时返回 `503` 和 `Retry-After`。MCP 继续使用 `no-store`；API 和 Agent 内容到期后重新验证。

**工具与修复**：

- **综述评测**：`scripts/eval-story-digests.ts` 从库里导出真实事件，在同一批事件上把现有提示词和候选提示词并排跑，见 [综述评测](story-digest-evaluation.md)。三个评测脚本共用 `scripts/eval-tools.ts`；`eval-selection.ts` 的 `--n`、`--concurrency` 和模型名写错时直接报错。
- **迁移不阻塞读写**：新迁移每个文件只放一条允许在线执行的语句，不整表回填或重写，建索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`；CI 用 `scripts/check-migrations.ts` 检查。统计维护只针对明确的表和列，规则见 [架构](architecture.md#数据库迁移)。
- MCP 请求有大小上限，错误日志去掉凭据。
- 桌面侧栏放大后显示细滚动条。
- 测试按每一步实际的提示词认请求、从 `industry/selection.ts` 读门槛，换行业改写提示词和门槛后不再误报；架构测试不再受路径分隔符影响。

#### 站点文件搬进 `site/`（2026 年 10 月 4 日）

公开接口没有变化，版本仍是 4.0.0。

- **站点自己的文件从 `industry/` 搬到了 `site/`**：`site.ts`、`models.ts`、`brand/`、`pages/`、`public/`、`changelog.json`。`industry/` 只留行业知识：`taxonomy.ts`、`topics.json`、`sources.json`、`prompts/`、`selection.ts`。自己改过这些文件的，合并时把改动挪到 `site/` 下的同名文件。
- **`site.ts` 多了几项**，都可以不填：`SITE.github`、`SITE.llmsIntro`、`SITE.rootIcons`，`POLICY.terms.license`、`POLICY.terms.headers`，`ABOUT.termsAnchor`（二维码卡片可以写 `alias`），以及 `ACCESS`、`ADMIN`、`DEPLOYMENT`、`FEED_COPY`、`PUBLIC_CATEGORIES`，说明见 [把它改成你的行业](customize.md)。`PUBLIC_CATEGORIES` 取代了 4.0.0 时的 `publicAs`：原来在类别上写 `publicAs: "tip"` 的，改在 `PUBLIC_CATEGORIES.merge` 里写（键是这个类别的 key，值是 `"tip"`）。
- **`DEPLOYMENT.requiredSecrets`** 是生产 API 启动时额外检查的凭据清单，默认空；基本会话、图片签名和管理员登录校验仍然生效。只有你的部署要求某个可选集成必须配置时才填写。
- **只属于你这个站的功能可以做成模块**：放进 `modules/<名字>/`，在 `site/modules/` 的清单里启用，见 [架构](architecture.md) 的“模块”。框架本身不带模块。
- **Agent 接入页默认打开 MCP**，页面列出 MCP、RSS 和 API 三种接入方式。Agent Markdown 接口仍在 `/api/v1/agent`，可从页面下方“Agent 使用说明”进入。
- **图片代理可以设流量上限**：`IMGPROXY_UPSTREAM_MB_PER_MINUTE`、`IMGPROXY_UPSTREAM_GB_PER_DAY`（或 `site.ts` 的 `DEPLOYMENT.imageUpstreamBudget`），默认不设。
- **修复**：同样的数据每次给出同样的字节（排序遇到并列时补上唯一的次序，API 和 RSS 的 ETag 不再无故变化）；网页转给 api 的请求不再带上逐跳头，`Connection: close` 不再让下一个 POST 失败；`llms.txt` 的接入方式按实际数，不再写成四种。

#### 升级到公开接口 4.0.0（2026 年 10 月 3 日）

- **模型榜、Codex 重置监控和主题页的大事记不再是框架的一部分**，只留在 AIHOT 上。页面（`/leaderboard`、`/codex-reset`）、接口（`/api/v1/codex-resets`、`/api/v1/codex-resets/recent`、`/api/v1/agent/codex-resets`）和 MCP 工具 `<前缀>_get_codex_resets` 都去掉了，MCP 和 `/openapi-v1.json` 的版本号升到 4.0.0。迁移 `0053` 删掉它们的表（`lb_*`、`monitor_*`、`fx_rates`）和设置，定时任务及其执行队列在 worker 启动时自动撤掉，后台运行记录继续保留；要留这些数据的，升级前先备份。公司主题页的标志改成公司名的首字母。
- **行业包有几处变化**，自己改过 `industry/` 的站，合并时对照新文件补上：
  - `site.ts` 多了 `topicsTitle`、`feedbackExample`、`keywords`、`since`、`interfaceVersion`、`POLICY`（使用规则和隐私说明两页的名字与简介、X 帖子算不算全文）、`ABOUT.description`、`ABOUT.sourcesFallback`、`AGENT`、`REPORTS`、`ALERTS`、`SOURCE_DEFAULTS`、`COMMUNITY_FEEDS`、`CARDS`；作者块的两张二维码卡片加了 `kind`，`ABOUT.copyright` 改成反馈页链接前后的两段。
  - 新增 `models.ts`：具名的模型和每一步默认用哪个，原来写在代码里。
  - 网页左上角的标志从 `apps/web/app/components/Logo.tsx` 搬到 `industry/brand/Logo.tsx`（后来搬到 `site/` 下，见上方）。
  - 新增 `public/`：`robots.txt`、`manifest.webmanifest` 原来在代码里生成，OpenAPI 说明原来在 `reference/`，现在都是这里的文件。原来填了 `contactEmail` 就会生成的 `/.well-known/security.txt`，现在要自己放一份 `public/.well-known/security.txt`（后来搬到 `site/` 下，见上方）。
  - 删掉了 `features.ts`、`chronicle.ts` 和 `chronicles/`；`topics.json` 里的 `orgNames`、`leaderboardProvider`、`chronicleTerms` 不再使用，可以删掉。
  - `taxonomy.ts` 的类别可以写 `feedLabel`（分类 RSS 标题里的名字，示例站用“AI 模型”这样的说法）；`ENTITIES` 加了几家公司。当时类别上还可以写 `publicAs`，让它在公开接口里并进另一类；这个字段后来删掉了，改成 `site/site.ts` 的 `PUBLIC_CATEGORIES.merge`（见上方），再写 `publicAs` 通不过类型检查。
- **推送接口的限流可以设置**：`/api/ingest/items` 每个客户端每分钟最多推几次由 `INGEST_RATE_LIMIT` 决定，`docker compose` 默认 10，和以前一样；不用 Docker 时默认不限，前面没有代理限流的话在 `.env` 里设上。
- **不再使用的环境变量**：`ARTIFICIAL_ANALYSIS_API_KEY`、`MONITOR_MODEL`，可以从 `.env` 删掉。

#### 升级到公开接口 3.0.0（2026 年 10 月 3 日）

- **安全阀默认关**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 只有写成 `true` 才打开，没写就是关。用 `scripts/init-env.ts` 生成的 `.env` 已经有这两行；自己写的 `.env` 没有的话要补上，否则升级后不再采集、不再调用模型。
- **周报月报接口换了形状**：`/api/v1/weeklies`、`/api/v1/monthlies` 的列表和每一期都带 `periodStart`、`periodEnd`，正文改成 `sections[]`（每栏 `label`、`summary`、`items`），不再有 `title`、`themes`，列表的 `limit` 最多 60。读这两个接口的程序要跟着改；MCP 和 `/openapi-v1.json` 的版本号随之升到 3.0.0。
- **精选的机器出口每条新闻一条**：API 的 `mode=selected`、同步接口和精选 RSS 里，同一条新闻只留代表报道，其他报道以 `remove` 出现在同步的变更里（`mode=all` 里还在）。升级前已经入选的旧报道不会被重新整理，等这条新闻再有报道发布时才归并。
- **精选要等去重确认**：分数够了的资料，要等归组确认它不是精选里已有新闻的重复、带来了新信息，才进精选；确认之前只在“全部动态”。归组用的模型回答不合格式时会停在那里，后台“运行”页能看到。
- **一手只看分级**：`T1` 就是一手，`first_party` 不再单独设置；以前单独标成一手的 `T1_5`、`T2` 信源不再算一手，要算就改成 `T1`。
- **行业包多了几项**：`taxonomy.ts` 新增 `RELEASE`、`PLAIN_TERMS`，评论类的类别标 `commentary: true`，`ENTITIES` 可以写 `otherNames`，`CATEGORY_BY_ITEM_TYPE` 不再使用。已经换成别的行业的站，合并时对照 [把它改成你的行业](customize.md) 补上。
- **主题只读 `industry/topics.json`**：迁移会删掉数据库里的 `topics` 表。只改过数据库、没改文件的主题，升级前先写进文件。公司主题只看 `entityId`，`related` 不再使用。
- **日报不再调用模型**：日报按规则编排，周报月报从日报汇编，模型只写总述和栏目导读；已经出过的各期不重写。
- **提示词有改动**：`industry/prompts/` 里的 `structure.md`、`group-*.md`、`story-digest.md`、`report-period.md` 换成了新的写法，`report-daily-lead.md` 删掉了，新加了 `report-period-sections.md`。改过这些提示词的，对照着把自己的改动搬过去。
- **删掉的脚本**：`scripts/delete-sources.ts`、`scripts/regroup-events.ts`、`scripts/enqueue-analysis.ts`。不要的信源在后台暂停；单篇的重新评估、重新归组在后台“内容诊断”里打开这一篇操作。
- **管理员会话绑定登录方式**（迁移 `0041`）：从还没有会话绑定的版本升级后，未绑定的旧会话需要重新登录。此前已试用会话绑定迁移的数据库可直接升级，已有列和绑定会被保留，无需手动修改迁移记录。之后的规则见下方“管理员会话与配置变更”。
- **3.x 的 `/agent` 默认打开 Agent Markdown**，MCP 的接入说明在 `/agent?tab=mcp`；当前接入页见上方“站点文件搬进 `site/`”。
- **飞书内容群只推 `T1`、`T1_5` 信源的精选。**

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。`DB_BACKUP_STORE_SECRET_ID`、`DB_BACKUP_STORE_SECRET_KEY`、`DB_BACKUP_STORE_BUCKET`、`DB_BACKUP_STORE_REGION` 四项都要填；不填 `DB_BACKUP_STORE_DOMAIN` 时按腾讯云 COS 拼地址（`<桶名>.cos.<地域>.myqcloud.com`），用其他 S3 兼容存储时，把这个存储桶的访问域名（含桶名，例如 AWS S3 的 `<桶名>.s3.<地域>.amazonaws.com`）填进 `DB_BACKUP_STORE_DOMAIN`。

一次完整备份包含同一时间戳的数据库 `.dump` 和文件包 `.tar.gz`，文件名取自数据库名：Docker 里数据库叫 `aihot`，所以是 `aihot-<时间>.dump` 和 `aihot-files-<时间>.tar.gz`。文件包保留 `uploads/` 以及仍存本地的 `feedback-screenshots/`，不包含图片缓存或本地备份目录。已经转发到飞书的图片只保留数据库中的外部引用，文件包不保存飞书上的图片。

恢复时同时取回这一对文件：使用与数据库版本兼容的 `pg_restore` 将 `.dump` 恢复到空数据库，再把文件包解压到数据目录根目录（Docker 中为 `/data`，非 Docker 使用 `AIHOT_DATA_DIR`，默认 `.data`），保留包内的子目录结构，并确保运行进程可读取这些文件。只恢复数据库不能找回仍由 `local:` 引用的反馈截图；旧备份中没有包含的文件也无法凭数据库引用恢复。

下面的手动导出只包含数据库，不包含上述附件目录：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > myhot-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

### 管理员会话与配置变更

会话绑定登录方式、登录时的管理员凭据或飞书身份。修改管理员密码、飞书管理员名单或会话密钥后，应重启所有 API 进程，使它们加载相同的新配置；只编辑配置文件不代表正在运行的进程已生效，混用旧代码或旧配置的进程不能提供统一撤权。

有效配置改变后，密码会话不再接受旧密码的授权，飞书会话按登录时实际取得的 union ID 或邮箱检查当前名单（两者任一仍获授权即可）。停用飞书登录应用或更换应用 ID 会使飞书会话失效；只轮换同一应用的 secret 不会使仍获授权的飞书会话退出。轮换或移除 `SESSION_SECRET` 会使两种会话都失效。

鉴权时确认失效的会话会被删除，恢复旧配置也不会让它复活。系统不记录全局凭据变更历史：某次配置变化若从未被进程加载，或在恢复前从未被会话检查观察到，不能据此追溯撤销会话。

## 花多少钱

- **模型**：每条新资料先预筛一次；过了预筛的再评两次分、做一次结构化、写一次标题摘要，然后归组（有相近的报道时才调用），另外还有事件综述、周报月报的总述和精选的全文翻译。空正文、纯链接的 X 帖子不调用写作或翻译模型。日报按规则编排，不调用模型。我们用示范信源在本地试跑，第一次导入的 152 条资料一共用了大约 930 次模型调用。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina）：按请求计费，默认不启用，填了 key 才会用。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 付费请求上限”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17，系统用 Linux 或 macOS；Windows 上请在 WSL2 里运行，或者用上面的 Docker 方式。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb myhot
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/myhot
API_BASE_URL=http://127.0.0.1:3001
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web

NODE_ENV=production node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
NODE_ENV=production node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程都要带 `NODE_ENV=production`。api 和 worker 不带它就按开发环境运行：启动时不检查生产密钥和管理员密码，`DEV_AUTH_ROLE` 免登录也会生效。

三个进程要一直运行，生产环境用 systemd 或 pm2 守护（守护配置里同样设 `NODE_ENV=production`）。停止 worker 时给它 515 秒（systemd 的 `TimeoutStopSec=515`、pm2 的 `kill_timeout: 515000` 和 `treekill: false`），覆盖队列的 470 秒排空和数据库清理；systemd 还需设 `KillMode=mixed`，只先通知主进程停止接任务，让正在备份的 `pg_dump`、`tar` 自然完成。被提前杀掉的调用结果不明，要等至少半小时自动放行后才会重试。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_AUTH_ROLE=admin`（生产环境会拒绝启动）。


### 远洋旧处理器升级说明

2026-10-23的普通新闻 `fishery.flow` → `fishery.news` → 维护循环成刊路径已由上方原生迁移替换，不再按旧说明启用或恢复。`0105`–`0107` 已发布的阶段迁移保持原样，历史任务及专项核查仍需识别这些阶段；已有回执和累计账本不回滚。既有日期、机构角色、附件、私有预览和业务指南证据约束继续保留，旧验收记录只代表其记录日期的运行结果。
