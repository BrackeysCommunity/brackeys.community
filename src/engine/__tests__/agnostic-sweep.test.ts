// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { resolveSettings, settingsSources } from "../scene/expand";
import type { Pt, SceneSettings } from "../scene/types";
import type { GenreProbe, ProbeRun, ProbeVariant } from "./genres/harness";

/**
 * The engine assumes no side view: the genre probes run with no gravity,
 * sideways gravity and no physics, and no engine source hard-codes the
 * side-view defaults that live in `game/defaults.ts`.
 */

const ENGINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const posix = (p: string) => p.split(sep).join("/");

const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", ".output"]);
/** The one home of the world-default literals. */
const EXEMPT = new Set(["game/defaults.ts"]);
const WAIVER = /agnostic-ok:\s*\S/;

const LITERALS: readonly RegExp[] = [
  /\[\s*0\s*,\s*1200\s*\]/,
  /\bTICK_RATE\b/,
  /1000\s*\/\s*60\b/,
  /Vector2\(\s*0\s*,\s*-1\s*\)/,
  /\{\s*x:\s*0\s*,\s*y:\s*-1\s*\}/,
];

/** Exports earlier releases removed; none may come back. */
const REMOVED_EXPORTS = ["VIRTUAL_HEIGHT", "DISPLAY_RESOLUTIONS", "LAYERS"] as const;

function engineFiles(test: (name: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (test(entry.name)) out.push(posix(full.slice(ENGINE.length + 1)));
    }
  };
  visit(ENGINE);
  return out.sort();
}

const SOURCES = engineFiles((n) => /\.tsx?$/.test(n) && !n.endsWith(".d.ts"));

// ─── Variants ────────────────────────────────────────────

type Required = { name: string; matches: (s: { gravity: Pt; physics: string }) => boolean };

const REQUIRED: readonly Required[] = [
  { name: "gravity [0, 0]", matches: (s) => s.gravity[0] === 0 && s.gravity[1] === 0 },
  { name: "gravity [1200, 0]", matches: (s) => s.gravity[0] === 1200 && s.gravity[1] === 0 },
  { name: 'physics "none"', matches: (s) => s.physics === "none" },
];

const PROBE_MODULES = import.meta.glob<Record<string, unknown>>("./genres/*.probe.ts", {
  eager: true,
});
const HARNESS = import.meta.glob<{
  runGenreProbe: (probe: GenreProbe, variant?: ProbeVariant) => Promise<ProbeRun>;
}>("./genres/harness.ts");

function isProbe(value: unknown): value is GenreProbe {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<GenreProbe>;
  return (
    typeof p.id === "string" && !!p.game && !!p.scene && !!p.script && typeof p.expect === "object"
  );
}

const PROBES: GenreProbe[] = Object.values(PROBE_MODULES)
  .flatMap((mod) => Object.values(mod))
  .filter(isProbe)
  .filter((p, i, all) => all.indexOf(p) === i)
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Each run a probe makes (its default, then each variant), with the settings it resolves to. */
function runsOf(probe: GenreProbe) {
  const registry = createRegistry(probe.game as Parameters<typeof createRegistry>[0]);
  const sources = settingsSources(registry);
  const variants: (ProbeVariant | undefined)[] = [undefined, ...(probe.variants ?? [])];
  return variants.map((variant) => {
    const settings: SceneSettings = { ...probe.scene.settings, ...variant?.settings };
    return { probe, variant, resolved: resolveSettings(settings, sources) };
  });
}

describe("agnostic sweep: variants", () => {
  it("finds the genre probes and their harness", () => {
    expect(Object.keys(HARNESS)).toEqual(["./genres/harness.ts"]);
    expect(PROBES.length).toBeGreaterThan(0);
  });

  for (const req of REQUIRED) {
    it(`a probe runs under ${req.name} and reaches its result`, async () => {
      const run = PROBES.flatMap(runsOf).find((r) => req.matches(r.resolved));
      expect(run, `no probe lists or defaults to ${req.name}`).toBeDefined();
      if (!run) return;
      const load = HARNESS["./genres/harness.ts"];
      if (!load) throw new Error("genres/harness.ts is missing");
      const { runGenreProbe } = await load();
      const out = await runGenreProbe(run.probe, run.variant);
      const label = `${run.probe.id} ${run.variant?.name ?? "(default)"}`;
      expect(out.report.outcome.result, label).toBe(run.probe.expect.result);
      if (run.probe.expect.maxTicks !== undefined) {
        expect(out.report.ticks, label).toBeLessThanOrEqual(run.probe.expect.maxTicks);
      }
      if (run.resolved.physics === "none") expect(out.usedRapier, label).toBe(false);
    }, 60_000);
  }
});

// ─── Literals ────────────────────────────────────────────

describe("agnostic sweep: literals", () => {
  it("scans the engine's sources", () => {
    expect(SOURCES).toContain("engine.ts");
    expect(SOURCES).toContain("game/defaults.ts");
    expect(SOURCES.some((f) => f.includes("__tests__/"))).toBe(false);
  });

  it("keeps the side-view literals in game/defaults.ts", () => {
    const leaks: string[] = [];
    for (const file of SOURCES) {
      if (EXEMPT.has(file)) continue;
      readFileSync(join(ENGINE, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (WAIVER.test(line)) return;
          const hit = LITERALS.find((re) => re.test(line));
          if (hit) leaks.push(`${file}:${i + 1} ${hit.source}: ${line.trim()}`);
        });
    }
    expect(leaks).toEqual([]);
  });

  it("generated schemas name no default gravity", () => {
    const schemas = engineFiles((n) => n.endsWith(".schema.json"));
    expect(schemas).toContain("scene/scene.schema.json");
    const leaks: string[] = [];
    const isSideView = (v: unknown) =>
      Array.isArray(v) && v.length === 2 && v[0] === 0 && v[1] === 1200;
    const visit = (file: string, path: string, v: unknown) => {
      if (isSideView(v)) leaks.push(`${file} ${path}`);
      else if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) visit(file, `${path}/${k}`, child);
      }
    };
    for (const file of schemas) {
      const text = readFileSync(join(ENGINE, file), "utf8");
      text.split("\n").forEach((line, i) => {
        if (LITERALS[0]!.test(line)) leaks.push(`${file}:${i + 1}: ${line.trim()}`);
      });
      visit(file, "", JSON.parse(text));
    }
    expect(leaks).toEqual([]);
  });
});

// ─── Removed exports ─────────────────────────────────────

function entryFiles(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  const out: Record<string, string> = {};
  for (const entry of Object.keys(pkg.exports)) {
    const file = entry === "." ? "index.ts" : `${entry.slice(2)}/index.ts`;
    if (existsSync(join(ENGINE, file))) out[entry] = file;
  }
  return out;
}

describe("agnostic sweep: removed exports", () => {
  it("no entry exports them at runtime", async () => {
    const entries = entryFiles();
    expect(Object.keys(entries)).toContain("./game");
    const found: string[] = [];
    for (const [entry, file] of Object.entries(entries)) {
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(join(ENGINE, file)).href
      )) as Record<string, unknown>;
      for (const name of REMOVED_EXPORTS) if (name in mod) found.push(`${entry} ${name}`);
    }
    expect(found).toEqual([]);
  }, 60_000);

  it("no engine source declares or re-exports them, types included", () => {
    const found: string[] = [];
    for (const file of SOURCES) {
      const text = readFileSync(join(ENGINE, file), "utf8");
      for (const name of REMOVED_EXPORTS) {
        const declared = new RegExp(
          `\\bexport\\s+(?:declare\\s+)?(?:const|let|var|function|class|type|interface|enum)\\s+${name}\\b`,
        );
        const listed = new RegExp(`\\bexport\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`);
        if (declared.test(text) || listed.test(text)) found.push(`${file} ${name}`);
      }
    }
    expect(found).toEqual([]);
  });
});
