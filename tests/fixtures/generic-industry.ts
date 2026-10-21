// Explicit synthetic industry input for engine invariants, never a production catalog.
export * from "../../industry/taxonomy.ts";
import { ENTITY_TAGS as siteEntityTags } from "../../industry/taxonomy.ts";
export const RELEASE = { category: "research", tag: "研究", unit: "项新研究" };
export const ENTITIES = {
  "fixture-lab": { name: "FixtureLab", displayTag: "FixtureLab", aliases: ["FixtureLab", "LabTool"], orgNames: ["FixtureLab"] },
  "fixture-port": { name: "FixturePort", displayTag: "FixturePort", aliases: ["FixturePort", "PortTool"], orgNames: ["FixturePort"] },
  "fixture-meta": { name: "MetaDock", displayTag: "MetaDock", aliases: ["MetaDock"], otherNames: ["MetaDockTool"] },
  "fixture-rename": { name: "NewHarbor", displayTag: null, aliases: ["NewHarbor"], otherNames: ["OldHarbor", "HarborTool"] },
  "fixture-global": { name: "示例集团", displayTag: null, aliases: ["ExampleGlobal", "示例集团"], otherNames: ["ExampleGlobal Team"] },
};
export const ENTITY_TAGS = [...siteEntityTags, "FixtureLab", "FixturePort", "MetaDock"];
export const IDENTITY_LEXICON = [
  { id: "fixture-lab", name: "FixtureLab", patterns: [/FixtureLab|LabTool/i] },
  { id: "fixture-port", name: "FixturePort", patterns: [/FixturePort|PortTool/i] },
  { id: "fixture-global", name: "示例集团", patterns: [/ExampleGlobal|示例集团/i] },
];
export const PUBLISHER_DOMAINS: Array<{ entityId: string; domains: string[] }> = [];
export const IDENTITY_CONTEXT_ALIASES: Array<{ entityId: string; pattern: RegExp }> = [];
