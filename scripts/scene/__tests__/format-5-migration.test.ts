// @vitest-environment node
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expandInstance,
  expandScene,
  parsePrefab,
  parseScene,
  type Prefab,
  type Registry,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_PROJECT_GLOBS, discoverProjects } from "../projects";
import { poseDigest, readFormat4Corpus } from "./fixtures/format-4-corpus";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROJECTS = await discoverProjects(ROOT, [
  ...DEFAULT_PROJECT_GLOBS,
  "scripts/engine-smoke/fixtures/**/jams.project.json",
]);
const CORPUS = readFormat4Corpus();
const FILES = Object.keys(CORPUS.files).sort();

/** The project a corpus file sits in, else the one whose game the file names. */
function projectOf(path: string) {
  const inside = PROJECTS.find((p) => !relative(p.dir, `${ROOT}${path}`).startsWith(".."));
  if (inside) return inside;
  const game = (JSON.parse(CORPUS.files[path]!) as { game?: string }).game;
  const named = PROJECTS.find((p) => p.registry.id === game);
  if (!named) throw new Error(`${path}: no project for it`);
  return named;
}

const isPrefabText = (text: string) => (JSON.parse(text) as { kind?: string }).kind === "prefab";

/** The corpus's own v4 prefabs beside `path`, each lifted to the current format. */
function prefabsFor(path: string, registry: Registry): Map<string, Prefab> {
  const home = projectOf(path);
  const raw = new Map<string, Prefab>();
  for (const file of FILES) {
    const text = CORPUS.files[file]!;
    if (isPrefabText(text) && projectOf(file) === home) {
      const p = JSON.parse(text) as Prefab;
      raw.set(p.id, p);
    }
  }
  const lookup = (id: string) => raw.get(id);
  const out = new Map<string, Prefab>();
  for (const [id, p] of raw) {
    const parsed = parsePrefab(p, registry, { prefab: lookup });
    if (!parsed.ok) throw new Error(`${id}: ${JSON.stringify(parsed.issues)}`);
    out.set(id, parsed.prefab);
  }
  return out;
}

describe("format 5 keeps every format 4 file where it was", () => {
  it("holds every scene and prefab file that was at format 4", () => {
    expect(FILES.length).toBe(41);
    expect(FILES.every((f) => (JSON.parse(CORPUS.files[f]!) as { v: number }).v === 4)).toBe(true);
  });

  it.each(FILES)(
    "%s expands entity for entity and pose for pose, but for the nodes that replaced its groups",
    (path) => {
      const text = CORPUS.files[path]!;
      const registry = projectOf(path).registry;
      const prefabs = prefabsFor(path, registry);
      const lookup = (id: string) => prefabs.get(id);
      if (isPrefabText(text)) {
        const parsed = parsePrefab(text, registry, { prefab: lookup });
        expect(parsed.ok && parsed.migratedFrom).toBe(4);
        if (!parsed.ok) return;
        const out = expandInstance(
          { id: "p", prefab: parsed.prefab.id, at: [0, 0] },
          prefabs,
          registry,
        );
        expect(out.ok).toBe(true);
        if (out.ok) expect(poseDigest(out.entities, registry)).toEqual(CORPUS.expanded[path]);
        return;
      }
      const parsed = parseScene(text, registry, { prefab: lookup });
      expect(parsed.ok && parsed.migratedFrom).toBe(4);
      if (!parsed.ok) return;
      const groups = Object.keys((JSON.parse(text) as { groups?: object }).groups ?? {}).length;
      const nodes = new Set((parsed.def.entities ?? []).slice(0, groups).map((e) => e.id));
      for (const e of (parsed.def.entities ?? []).slice(0, groups)) expect(e.type).toBe("node");
      const expanded = expandScene(parsed.def, registry, { prefabs });
      expect(poseDigest(expanded.entities, registry, nodes)).toEqual(CORPUS.expanded[path]);
    },
  );
});
