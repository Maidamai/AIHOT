# 福建政策原件正文处理验收

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../../current-status.md) and [source/hash inventory](../../../../provenance/source-manifest.json).


已推送并部署 `f98ce6a9df880060fb2ae961dd7a01746b1f35e5`。本批新增一份可追溯的待审原件，未增加已批准或对外发布内容。

原件：[福建省强企惠渔资金政策明白纸（2025年版）](https://hyyyj.fujian.gov.cn/xxgk/tzgg/202507/P020250728594612073287.pdf)。原始SHA256 `7c3299815df28291b535e4635515219327db3e81511e0f61336fe8bfa8dced22`。

- 生产Poppler逐页提取保留34物理页，16,839字符、730证据片段。第2、4页完整mediaBox渲染经授权代理目视确认为白页，登记审计453；空白页无事实片段。
- 同URL第二次导入返回unchanged，素材 `5ffb1e16-f15e-4590-8fdd-95e81945ee28` 保持revision1，无素材审批、AI任务、业务指南或文章批准。
- manifest只能引用审阅ID；审计、原件、图片或绑定发生变化会阻断当前处理/指南读取/素材导出。扫描件不能凭无文字自动认定空白。
- 它是2025历史参考，网页发布日期、现行效力、申请资格均unknown，转载许可未知。通知批次仍保留原待复核状态，单独PDF归档不冒充通知全部处理成功。
- 文章生成请求仍超96KB容量而停住；没有删页、调大限制或新增模型费用。紧凑指南仅做本地容量诊断，未形成实际指南审核结果。

线上私有访问保持；原站200、正常TLS校验通过，现有13条合格投影不变。费用仍33次、估算¥0.486372/累计¥10，无未决。

测试：完整后端在966f0af为1164/1164；最终f98ce6a只修一处审阅身份文案，针对性证明失效链与类型检查通过。前端源码未变，构建及75浏览器检查通过；部署smoke30/30。详细失败/修正与未测范围见RESULT，不将父任务启动失败的云端复审算成成功。

NPFC前两轮是人为配置60秒、最多2轮的验证模式，再由pg-boss调度；不是两个正常6小时周期。正式周期下一轮仍为UTC06:12:36（北京时间14:12），本批没有提前到点或手动补跑。

未做：OCR、XLSX运行解析、福建长期定时、新模型调用、新公开发布；14页扫描件继续待复核，XLSX未发现远洋相关条目。非空文字不证明任意混合扫描PDF视觉内容完整。

回滚：已备份数据库/数据/配置到服务器保护目录，保留original-2563192代码镜像；没有回滚或重置账本、游标、审核历史。精确路径见RESULT。
