// 远洋渔业分类与专题词表；栏目身份用于网址与公开接口。
export const CATEGORIES = [
  { key: "policy", tagColor: "indigo", label: "政策", section: "政策", guide: "政策法规、许可配额、履约和正式征求意见。区分生效、拟议和历史文件。" },
  { key: "safety", tagColor: "orange", label: "安全", section: "安全", guide: "事故调查、航行安全、官方气象预警与应急。预警时效只按原文，不推断当前状态。" },
  { key: "market", tagColor: "turquoise", label: "市场", section: "市场", guide: "水产品贸易、销售、通关、价格和融资补贴消息。价格须保留时间、币种、地区与统计口径。" },
  { key: "research", tagColor: "violet", label: "研究", section: "研究", guide: "渔业资源评估、科研成果、调查和研究报告；研究结果不等于实时鱼情。" },
  { key: "equipment", tagColor: "green", label: "装备", section: "装备", guide: "船舶、捕捞装备、检修改造和技术产品的实质变化。" },
  { key: "operations", tagColor: "purple", label: "运营", section: "运营", guide: "船员用工、备航补给、港口、转运追溯、回港和经营活动。" },
  { key: "reference", tagColor: "blue", label: "资料", section: "资料", guide: "指南、解读、观点和历史参考资料；不将参考内容写成办理承诺。", commentary: true },
 ] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;
export const RELEASE: { category: string; tag: string; unit: string } | null = null;
export const PLAIN_TERMS: readonly string[] = ["远洋渔业", "捕捞", "船员", "渔船", "港口", "配额", "追溯"];
// 保留评分接口的类型标识及五轴权重；各类型的行业含义见提示词。
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;
export const CATEGORY_TAGS = ["政策", "安全", "市场", "研究", "装备", "运营", "资料"] as const;
export const TOPIC_TAGS = ["补贴融资", "船舶购租改造检修", "船员/外籍用工", "许可配额履约", "备航油料补给保险", "捕捞禁区/休渔/鱼情", "气象应急", "转运追溯", "销售通关回款", "回港维修换班结算退出"] as const;
// 未经确认的机构与别名不预填；原文机构名仍可在新闻标题和摘要中保留。
export const ENTITY_TAGS: readonly string[] = [];
export const TAG_SYNONYMS: Readonly<Record<string, string>> = { 政策法规: "政策", 政策监管: "政策", 航行安全: "安全", 贸易: "市场", 科研: "研究", 船舶装备: "装备", 经营: "运营", 指南: "资料", 解读: "资料" };
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {};
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [];
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [];
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
