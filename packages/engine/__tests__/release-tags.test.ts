// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import pkg from "../package.json";

/**
 * Engine tags (`engine-vX.Y.Z`) and site tags (`vX.Y.Z`) trigger different
 * pipelines: a site tag migrates and deploys production, an engine tag only
 * packs a tarball. This reads every tag rule in the CI files and checks that
 * neither kind can start the other's jobs.
 */

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CI_FILES = [
  join(REPO, ".gitlab-ci.yml"),
  ...readdirSync(join(REPO, ".gitlab"))
    .filter((f) => f.endsWith(".yml"))
    .map((f) => join(REPO, ".gitlab", f)),
];

type TagRule = { file: string; pattern: RegExp };

function tagRules(): TagRule[] {
  const rules: TagRule[] = [];
  for (const file of CI_FILES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*-\s*if:\s*'?\$CI_COMMIT_TAG\s*=~\s*\/(.+?)\/'?\s*$/gm)) {
      rules.push({ file: file.slice(REPO.length + 1), pattern: new RegExp(m[1]!) });
    }
  }
  return rules;
}

const ENGINE_TAGS = ["engine-v0.1.0", "engine-v1.0.0", `engine-v${pkg.version.split("-")[0]}`];
const SITE_TAGS = ["v1.8.10", "v2.0.0"];

describe("release tags", () => {
  const rules = tagRules();
  const engine = rules.filter((r) => r.pattern.source.includes("engine"));
  const site = rules.filter((r) => !r.pattern.source.includes("engine"));

  it("finds the site's tag rules and exactly one engine rule", () => {
    expect(site.length).toBeGreaterThanOrEqual(2);
    expect(engine.map((r) => r.file)).toEqual([".gitlab/release.gitlab-ci.yml"]);
  });

  it("never starts a site release from an engine tag", () => {
    for (const rule of site) {
      const label = (tag: string) => `${rule.file} on ${tag}`;
      for (const tag of ENGINE_TAGS) expect(rule.pattern.test(tag), label(tag)).toBe(false);
      for (const tag of SITE_TAGS) expect(rule.pattern.test(tag), label(tag)).toBe(true);
    }
  });

  it("starts the engine release only from an engine-vX.Y.Z tag", () => {
    const [rule] = engine;
    for (const tag of ENGINE_TAGS) expect(rule!.pattern.test(tag), tag).toBe(true);
    for (const tag of [...SITE_TAGS, "engine-v0.1.0-dev.4", "engine-0.1.0", "xengine-v0.1.0"]) {
      expect(rule!.pattern.test(tag), tag).toBe(false);
    }
  });

  it("puts every engine job behind the engine rule", () => {
    const text = readFileSync(join(REPO, ".gitlab/release.gitlab-ci.yml"), "utf8");
    const jobs = [...text.matchAll(/^(engine-[a-z-]+):\n((?: .*\n|\n)*)/gm)];
    expect(jobs.map((j) => j[1])).toEqual(["engine-pack", "engine-publish-release"]);
    for (const [, name, body] of jobs) {
      expect(body, name).toMatch(/^\s+extends: \.engine-release$/m);
      expect(body, name).not.toMatch(/^\s+rules:/m);
    }
  });
});
