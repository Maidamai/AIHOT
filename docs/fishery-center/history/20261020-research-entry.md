# 远洋渔业信源中心：研究结论与实施入口

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../current-status.md) and [source/hash inventory](../provenance/source-manifest.json).


日期：2026-10-20。基线：[`5633b648b9ca6453caec5bcf70a76785a794286f`](https://github.com/KKKKhazix/AIHOT/commit/5633b648b9ca6453caec5bcf70a76785a794286f)。本目录保留研究方案；2026-10-20已获授权开始本地首期实现，新增管理员手工素材模块，未部署。

早期阶段仅进行只读研究与六份草案更新；后续用户已授权将文档放入本地仓库并交由独立会话改造。当前仅本地代码、迁移与隔离测试，不push、公共发布、Library/截图上传、部署、付费或创建真实凭据。首期实际范围与样例见[模块说明](https://github.com/Maidamai/AIHOT/blob/3a162cb5f30e27a6385d0fb0c1b7227f059028a3/modules/fishery/README.md)，验证记录见[实施](../implementation.md)。

AIHOT适合作为自托管采集和编辑底座；政策证据档案与面向Easel的素材合同需要补齐。现成线上API适合立即试读AI大众早报，不能直接提供用户需要的远洋渔业生产信源。开源包含18个AI演示源，线上生产源/数据与部分线上功能不随仓库附带。[README](https://github.com/KKKKhazix/AIHOT/blob/5633b648b9ca6453caec5bcf70a76785a794286f/README.md)

## 建议范围：由业务链决定，不以“日本以东”画硬边界

目标是服务中国远洋经营和运营人员，其次是鱼货贸易、加工采购。首版必须能持续回答政策变化、资源/季节背景和经营影响，不能只靠媒体热榜或实时渔场噱头。

| 候选 | 已核实的业务依据 | 起步收益与成本判断 | 规划定位 |
|---|---|---|---|
| 东南太平洋茎柔鱼（Dosidicus gigas）鱿钓 | 中国提交的2026 SPRFMO年报描述秘鲁外公海与东中太平洋赤道海域往返；报告有2025年度规模与作业类型 | 单一主要物种/渔法便于形成经营主题；RFMO与中国源可先起步，完整港口/沿岸国政策还要补西语及许可核验 | 第一关联观察与优先扩展候选；首版保留重大政策、资源、回运加工信息；升为全面自动采集前完成秘鲁/智利政策与港口源小样本核验 |
| 西北/北太平洋NPFC非高度洄游资源 | NPFC 2026公开概览中，中国2025 Convention Area捕捞有秋刀鱼、鲐、Japanese sardine及Neon flying squid；不能只看秋刀鱼或把“鱿鱼”当同种 | 中英日官方材料集中，适合政策档案与附件版本的首个技术试点；资源预报必须说明沿近海与公海差别 | 首批核心与有限采集试点，保留“日本以东”兴趣，但不覆盖全部远洋业务 |
| 西中太平洋金枪鱼 | WCPFC中国2026年报明确延绳钓/围网、太平洋岛国EEZ/公海及日本、斐济、泰国处置链 | 业务价值和官方资料强，但物种、渔法、国家准入与港口加工链更多，首版全面铺开审核成本较高 | 关联观察；第二阶段根据内容使用与审核能力决定是否升为核心；东太金枪鱼还需IATTC，不能用WCPFC替代 |
| 大西洋、印度洋、西非及全部低空/海事泛资讯 | 本轮没有完成对应组织/国家/经营链证据核验 | 扩得过快会稀释来源质量和审核 | 暂缓；AI×无人机×低空仅收有渔业实证的技术选题 |

最终采用：首批采集与审核集中NPFC相关西北太平洋公海多物种线；东南太平洋鱿钓作为第一经营扩展观察方向，金枪鱼作为第二观察线。先用证据集中、样本已核过的NPFC/JFA/FRA验证政策版本和素材交付，再按业务使用、来源许可和审核成本扩容。不会同时建设三个完整地域平台，也不认定NPFC船队代表全部中国远洋渔业。早期研究分支名曾使用northwest-pacific；当前正式实现分支 `feat/fishery-materials-mvp` 不表示地域硬边界。

以上是执行者的范围建议，不是官方区域排名或付费市场研究结论。三份年报的统计口径、船只唯一性、时期及范围不同，不能简单相加或用船数直接推导市场份额；缺少真实读者使用和支付意愿证据。先用30—50件有主次的样本验证，政策重要性与实际使用反馈决定下一步。

## 支撑范围判断的官方原件

- [SPRFMO SC14-Doc19 China，2026](https://www.sprfmo.int/assets/Meetings/02-SC/14th-SC-2026/Plenary/SC14-Doc19-Annual-Report-China-a.pdf)，第1—2、5页：鱿钓、目标物种、秘鲁外公海/赤道海域及年度活动；已下载并核看摘要页。
- [NPFC-2026-TCC09-IP01，2025 Fisheries Overview](https://www.npfc.int/system/files/2026-03/NPFC-2026-TCC09-IP01%20Fisheries%20Overview.pdf)，PDF第3—4页：Convention Area与National Waters分开、成员与物种统计；已下载、提取和核看表格。
- [WCPFC-SC22-2026-AR-CCM03，中国年报](https://meetings.wcpfc.int/file/21027/download)，PDF第3—4页：渔法、作业区域、市场链；已下载并核看第4页。年报描述过去年度，不证明当前作业许可。

法律范围以各RFMO条约、具体措施及国家实施为准。NPFC官方地图自带“无法律地位”说明；地理上在北太平洋不等于全部物种由NPFC管理，公海措施也不等于沿岸国EEZ准入。中国国内远洋管理是所有专题的共同核心；外籍船员、港口国、转运、海关贸易按实际相关主体和活动分别核验。

物种归并必须保留学名和来源原名。NPFC的[Japanese Flying Squid 2026资料](https://www.npfc.int/system/files/2026-01/Japanese%20Flying%20Squid%202026.pdf)第1、4页将Todarodes pacificus对应为太平洋褶柔鱼/スルメイカ，并在其资料口径下说明中国船队并不以该种为目标。它不能与Neon flying squid或南太茎柔鱼仅因同叫“鱿鱼”合并；这也限制了日本FRA预报作为中国远洋经营主源的直接适用性。此资料含历史统计，不能推定未来船队永不调整目标。

## 阅读顺序

1. [信源登记](../source-register.md)：实际可达/已读/待验、更新证据、许可与缺口。
2. [最小实现设计](../architecture.md)：新闻与政策两条处理线，独立观测、附件、修订、审核及安全成本。
3. [Easel合同](../easel-contract.md)：已存在的入口、拟议接口、版本/许可/撤回和台账。
4. [实施与验收](../implementation.md)：P0—P3、路径级任务、失败条件和回滚。
5. [Pro评审采纳记录](../review-assessment.md)：实际浏览器评审、证据复核及保留意见。

## 五项最危险的遗漏

1. 把文章hash等同于政策档案：A→B→A和同URL附件替换会丢证据。
2. 把精选同步等同于许可/全文同步：公开payload不含完整权利和证据状态，Easel可能保留已收紧权限的旧稿。
3. 把“发布/通过/生效/成员实施”合成一个日期状态：错过修订、未来生效、异议或豁免，进而误导经营。
4. 把网页200、官方来源或双模型评分当事实和权利都已核实：统计口径、表格脚注、版权和外文翻译仍需审核。
5. 把后台Cookie、本地Easel保护和调用次数预算误认为公网机器认证、内容授权和人民币硬上限。

本次仅有静态源码、公开GET、原件提取/渲染及文档检查证据。没有验证采集器长期运行、PDF/OCR生产准确率、Easel端到端交付、平台撤回、主机性能和备份恢复，也没有订阅付费内容、创建凭据、部署、改DNS、操作平台发布或新增调度。
