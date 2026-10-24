# 单 prompt 澄清与单 JFA 正式重评：准备阶段

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../current-status.md) and [source/hash inventory](../../provenance/source-manifest.json).


当前生产保持 d92，实际 BLOCK/analysis1/receipt46/ledger54 保留。此文件仅本地准备，不代表已有新 SHA、部署或重评。d92 阶段不可覆盖的报告为 `production-deployment-d92-report.md`，hash见 `production-preparation/jfa-final/d92-phase-checkpoint.safe.json`。

## 代码与构建门槛

待 core/reviewer 批准并正常提交推送，精确 d92 子 SHA 只修改 `industry/prompts/prefilter.md`。不改数值门槛、白名单、二次审核、日常 permit、预算或来源范围。先保存新 committed blob/完整 manifest、定向测试及独立审查记录，再导出新源/旁路镜像，不从未提交工作树构建。

前端复用证据：web入口/模块前端/site/contracts 的源文件和依赖均不变；prefilter Markdown 由 backend `editorial/prompts.ts` 的 fs loader 在 worker 调用时读取，`writing.ts` 以 promptText('prefilter')渲染。frontend没有导入 backend 或 industry/prompts，唯一 import.meta.glob 指向特定 site/changelog/FeatureRelease.tsx；industry包导出指向 *.ts。已验 web JS 无旧 prefilter 文本/版本/systemHash。收到新 SHA 后须再次核上述输入未变，并对全部85个复用web build文件逐hash核验；证据不足则只重build必要web，不扩跑全量。

prompt版本改变不会自行重扫 blocked article；专项 fisheryConfigurationVersion 必须与 d92 相同，不能以改普通预筛重新派发政策/既有专项任务。发布准备不执行 handover、schema迁移、profile/recover、policy init 或 retire。

## 正式鉴权重评路径（尚未执行）

唯一允许路径为 `POST /api/admin/content/jxr71d4jo1wbyzpbkrob4rwe6/rerun`，JSON `{ "step": "analyze" }`，应用自带 `Idempotency-Key`（同一已提交命令由 useAdminAction 保留key，后端以actor+requestId审计去重）。该接口走原 adminHandler：有效既有会话+CSRF，随后原 content.rerun.analyze 审计、queueProcessing 和 native consumer。它保留旧 analysis/receipt/ledger，仅通过正常业务动作请求重评；不直SQL改PASS或清状态、不调用内部无鉴权rerun函数。

现有 Chrome UI 停在本站/all，已有页面内容，但不能据此认定当前会话仍有效。浏览器连接pipe不可用，原生Chrome UI可用；已只读进入精确目标admin页并确认“管理员/退出登录”、blocked/analysis1/receipt46与“重新评估”控件；未点击重评，未读cookie或认证存储。

后续有界方案：只在既有浏览器会话正常目标admin内容页，通过可见“对当前修订重新评估”控件执行；应用自动处理原会话/CSRF/Idempotency-Key。useAdminAction生成Date.now+random key，页面不支持自选SHA固定key，因此不强制注入自选key，不用Cua受限evaluate/DevTools/网络fetch获取me或POST。实际requestId、actor和jobId事后由后端审计安全确认并与新SHA/当次操作记录关联。只一次目标Analyze确认；若响应未知，先查audit/job/receipt，不刷新再点或换key重提。不得读取或打印cookie/CSRF/密码/env/密钥，不使用后端内部函数绕过身份验证。

当前既有会话已通过正常目标admin页展示确认有效；未获取任何新凭据。若只有登录页、401/403、过期CSRF或工具审批拒绝，则停止该重评动作，报告具体 action/target/reason/outcome；不降低鉴权、不创造session、不读取密码、不换无鉴权路径。正常服务Compose已有凭据注入与该诊断/重评鉴权是不同动作，不能互相替代授权。

## 新 SHA 到位后的副本与生产顺序

1. 新源manifest/前端复用证明/定向验证/独立审查通过后，旁路镜像逐文件核验。当前生产继续自动运行，准备不碰状态。
2. 私有副本仅核新 prompt hash/版本和专项配置不变、旧BLOCK及54账本/receipt46/analysis1/原13/政策/MARA/四源范围都保留；不实际调外部模型、不伪造生产管理员身份。
3. 具体升级脚本另交 root/reviewer：正常排空/停止必要消费者、保存当次新备份和账本；精确新版本4服务，维持原鉴权/私有预览/全文和外发关闭；无schema/profile/handover等重复动作。
4. 验新worker使用新prompt版本且旧BLOCK不会自动重扫。仅在正式鉴权路径可用且新SHA生效后，唯一JFA通过正常可见控件提交一次应用key的analyze命令。若结果不确定，先核审计/job/receipt，保留原审计结果而不再次点击；不能换key自动重付。
5. 只观察原native处理器实际结果；新判定仍可能BLOCK/低分/失败，不能保证PASS/精选/发布。保原54个entries不可变、合法追加+回执结算、累计原¥10及unknown/pending真实状态；保护指定政策/MARA/13历史/真实日期。若得到真实新发布，再核网页/API/RSS/MCP统一出口及原刊期；不补假日期，不强造日报。

当前未调用任何重评API、模型、凭据或新部署动作。待新SHA/manifest/review及可用鉴权路径确认后，再按既有用户授权推进。
