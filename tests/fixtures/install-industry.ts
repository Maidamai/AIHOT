import fs from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";

/** Load real engine code against explicit test-only entities/releases and a topic catalog. */
export function installFixtureIndustry() {
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === "@aihot/industry/taxonomy") return { url: new URL("./generic-industry.ts", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  } });
  const topicPath = fileURLToPath(new URL("../../industry/topics.json", import.meta.url));
  const read = fs.readFileSync;
  const catalog = JSON.parse(read(topicPath, "utf8"));
  catalog.topics.push(
    { slug: "fixture-lab", name: "FixtureLab", group: "company", entityId: "fixture-lab", definition: "Synthetic company fixture" },
    { slug: "fixture-port", name: "FixturePort", group: "company", entityId: "fixture-port", definition: "Synthetic company fixture" },
    { slug: "fixture-meta", name: "MetaDock", group: "company", entityId: "fixture-meta", definition: "Synthetic company fixture" },
  );
  catalog.groups.push({ key: "company", name: "Synthetic companies", blurb: "Test-only input" });
  mock.method(fs, "readFileSync", ((...args: unknown[]) => {
    if (String(args[0]) === topicPath && args[1] === "utf8") return JSON.stringify(catalog);
    return Reflect.apply(read, fs, args);
  }) as typeof fs.readFileSync);
  syncBuiltinESMExports();
}
