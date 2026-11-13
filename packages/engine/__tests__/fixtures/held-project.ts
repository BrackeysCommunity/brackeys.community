import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";

import * as Y from "yjs";

import { planContent } from "../../export/content";
import { finishExport, type BuiltCode, type ExportInput } from "../../export/plan";
import { createRegistry, withProject } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { projectPathMatcher } from "../../project/asset-files";
import { parseProjectFile } from "../../project/project-file";
import type { ReleaseManifest } from "../../project/release";
import { heldProject, type HeldFile, type ProjectRuntimeView } from "../../project/runtime-view";
import type { AssetSidecar } from "../../project/sidecar";
import { jsonValues, snapshotProject } from "../../project/snapshot";
import { PROJECT_FILE, type ProjectFile } from "../../project/types";
import { isErrorIssue } from "../../scene/issues";
import type { SceneDefinition } from "../../scene/types";

/** A project as a host holds it: docs by their JSON, binaries by their sidecars, and each doc's text by path. */
export type HeldFiles = { files: HeldFile[]; texts: Map<string, string> };

const SIDECAR = ".asset.json";

/**
 * Every file under `dir` (only the paths `keep` takes, when given) as a
 * host holds it: docs by their JSON and text, binaries by their sidecars.
 */
export function readHeld(dir: string, keep?: (path: string) => boolean): HeldFiles {
  const files: HeldFile[] = [];
  const texts = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(dir, full).split("\\").join("/");
      if (path.endsWith(SIDECAR) || path === PROJECT_FILE || (keep && !keep(path))) continue;
      let sidecar: AssetSidecar | null = null;
      try {
        sidecar = JSON.parse(readFileSync(full + SIDECAR, "utf8")) as AssetSidecar;
      } catch {
        sidecar = null;
      }
      if (!path.endsWith(".json")) {
        files.push({ path, sidecar });
        continue;
      }
      const text = readFileSync(full, "utf8");
      texts.set(path, text);
      files.push({ path, json: JSON.parse(text), sidecar });
    }
  };
  walk(dir);
  return { files, texts };
}

/** A doc's text as a host writes it: two-space JSON and a newline. */
const docText = (json: unknown) => `${JSON.stringify(json, null, 2)}\n`;

/** Docs by path, held as their JSON and text. */
export function heldDocs(docs: Readonly<Record<string, unknown>>): HeldFiles {
  const texts = new Map<string, string>();
  const files: HeldFile[] = [];
  for (const [path, json] of Object.entries(docs)) {
    texts.set(path, docText(json));
    files.push({ path, json });
  }
  return { files, texts };
}

/** `held` with the doc at `path` replaced by `json`, written as `text` (by default as `heldDocs` writes it). */
export function withHeldDoc(
  held: HeldFiles,
  path: string,
  json: unknown,
  text = docText(json),
): HeldFiles {
  const texts = new Map(held.texts);
  texts.set(path, text);
  return { texts, files: held.files.map((f) => (f.path === path ? { path, json } : f)) };
}

/** A Y.Doc as the other end of the wire has it, the way an editor builds from it. */
export function overTheWire(doc: Y.Doc): Y.Doc {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return remote;
}

/** The Rapier build `fakeBuiltCode({ rapier: true })` ships. */
export const FAKE_RAPIER = {
  package: "@dimforge/rapier2d" as const,
  version: "0.19.3",
  file: "code/rapier-0a1b2c.wasm",
  bytes: 1_400_000,
};

/** A bundler's output as an export plans it: one entry script, plus Rapier's wasm with `rapier`. */
export function fakeBuiltCode(opts: { rapier?: boolean } = {}): BuiltCode {
  const entry = "code/main-abc123.js";
  return {
    files: [
      { path: entry, sha256: "d".repeat(64), bytes: 1000, role: "code" },
      ...(opts.rapier
        ? [
            {
              path: FAKE_RAPIER.file,
              sha256: "f".repeat(64),
              bytes: FAKE_RAPIER.bytes,
              role: "wasm" as const,
            },
          ]
        : []),
    ],
    entry,
    rapier: opts.rapier ? FAKE_RAPIER : null,
    thirdParty: [],
  };
}

/**
 * `input` exported with `code`: its manifest and every planned file's text by
 * path (`<kind>` for a file that isn't text). Throws on an export error.
 */
export async function releaseFiles(
  input: ExportInput,
  code: BuiltCode = fakeBuiltCode(),
): Promise<{ manifest: ReleaseManifest; files: Map<string, string> }> {
  const plan = await finishExport(await planContent(input), code, input);
  const errors = plan.issues.filter(isErrorIssue);
  if (errors.length > 0) throw new Error(JSON.stringify(errors, null, 2));
  const files = new Map<string, string>();
  for (const f of plan.files)
    files.set(f.path, f.source.kind === "text" ? f.source.text : `<${f.source.kind}>`);
  return { manifest: plan.manifest, files };
}

export const CC0 = { spdx: "CC0-1.0", author: "Test authors" };

/** A PNG's sidecar: `size`×`size` pixels, `bytes` long. */
export const png = (
  id: string,
  sha: string,
  bytes: number,
  size: number,
  licence?: AssetSidecar["licence"],
): AssetSidecar => ({
  kind: "asset-sidecar",
  v: 1,
  key: `key-${id}`,
  id,
  sha256: sha,
  bytes,
  meta: { format: "png", width: size, height: size },
  ...(licence ? { licence } : {}),
});

/** A physics-free scene with one spawn marker, using `assets`. */
export const scene = (name: string, assets: string[] = []): SceneDefinition =>
  ({
    v: 4,
    name,
    bounds: [0, 0, 6.4, 3.84],
    settings: { physics: "none" },
    ...(assets.length > 0 ? { assets } : {}),
    entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
  }) as SceneDefinition;

/**
 * A physics-free project: two listed scenes (yard, the start, and hall), two
 * unlisted ones (cellar, which a check names, and attic), a checks file and
 * its input script, and three textures (rocks without a licence, unused
 * reached only by attic).
 */
export function physicsFreeFiles(): HeldFiles {
  const docs: Record<string, unknown> = {
    "scene-list.json": {
      kind: "scene-list",
      v: 1,
      start: "yard",
      scenes: [{ scene: "yard", title: "Yard" }, { scene: "hall" }],
    },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": scene("yard", ["tiles"]),
    "hall.json": scene("hall", ["rocks", "tiles"]),
    "cellar.json": scene("cellar"),
    "attic.json": scene("attic", ["unused"]),
    "yard.checks.json": {
      v: 3,
      checks: [
        {
          id: "down",
          kind: "reaches",
          result: "script-end",
          expect: { scene: "cellar" },
          script: "walk.script.json",
        },
      ],
    },
    "walk.script.json": { v: 2, scene: "yard", steps: [{ wait: 1 }] },
  };
  const { files, texts } = heldDocs(docs);
  files.push(
    { path: "art/tiles.png", sidecar: png("tiles", "a".repeat(64), 300, 16, CC0) },
    { path: "art/rocks.png", sidecar: png("rocks", "b".repeat(64), 200, 16) },
    { path: "art/unused.png", sidecar: png("unused", "c".repeat(64), 100, 16, CC0) },
  );
  return { files, texts };
}

export const FREE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "free",
  name: "Free",
  game: null,
};

/** The export input of `held`: the project read as held files, its doc texts by id, a snapshot of it. */
export async function heldInput(
  project: ProjectFile,
  held: HeldFiles,
  game: GameDefinition,
  target: ExportInput["target"] = "web",
): Promise<ExportInput> {
  return (await heldRead(project, held, game, target)).input;
}

/**
 * The project whose `jams.project.json` is in `dir`, read from disk as a
 * host holds it (the files its asset globs take), judged by `game`: its
 * export input and the runtime view a game plays it with.
 */
export async function projectInput(
  dir: string,
  game: GameDefinition,
  target: ExportInput["target"] = "web",
): Promise<{ input: ExportInput; runtime: ProjectRuntimeView }> {
  const parsed = parseProjectFile(JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")));
  if (!parsed.ok) throw new Error(`${dir}: ${parsed.issues.map((i) => i.message).join("; ")}`);
  const { isAsset } = projectPathMatcher(parsed.file, matchesGlob);
  return heldRead(parsed.file, readHeld(dir, isAsset), game, target);
}

async function heldRead(
  project: ProjectFile,
  held: HeldFiles,
  game: GameDefinition,
  target: ExportInput["target"],
): Promise<{ input: ExportInput; runtime: ProjectRuntimeView }> {
  const { view, kinds, runtime } = heldProject(held.files, createRegistry(game), {
    projectId: project.id,
    name: project.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values())
    if (entry.sha256 === undefined) {
      const text = held.texts.get(entry.path);
      if (text !== undefined) texts.set(entry.id, text);
    }
  const values = jsonValues(texts);
  const settings = [...view.byId.values()].find((e) => e.kind === "game-settings");
  const engine = ((settings && (values.get(settings.id) as { engine?: object })?.engine) ??
    {}) as Record<string, unknown>;
  return {
    input: {
      project,
      view,
      texts,
      kinds,
      registry: withProject(createRegistry(game), view, values),
      game,
      engine,
      target,
      snapshot: await snapshotProject(view, texts, view.state.build),
    },
    runtime,
  };
}
