import {
  crc32,
  finishExport,
  planContent,
  type BuiltCode,
  type ExportInput,
} from "@jams/engine/export";
import { createRegistry, defineGame, withProject } from "@jams/engine/game";
import {
  formatReleaseManifest,
  heldProject,
  releaseId,
  sha256,
  snapshotProject,
  type AssetSidecar,
  type ExportBudget,
  type HeldFile,
  type ProjectFile,
  type ReleaseManifest,
  type ReleaseTarget,
} from "@jams/engine/project";
import { z } from "zod";

export type PlannedReleaseOptions = {
  projectId?: string;
  /** The game the release is built for (`manifest.game.id`). */
  gameId?: string;
  /** Stamped over `manifest.engine.version` after planning, e.g. one older than the site hosts. */
  engineVersion?: string;
  /** Moves a marker in the "hall" scene, so the release differs from the default in that scene's `data/` file. */
  hallVariant?: number;
  /** Extra code chunks with distinct bytes, for the size and count quotas; the export budget grows to fit them. */
  extraFiles?: { count: number; bytes: number };
  target?: ReleaseTarget;
};

export type PlannedRelease = {
  manifest: ReleaseManifest;
  /** `release.json` as uploaded. */
  text: string;
  releaseId: string;
  /** Every `build.files` entry's bytes by path; `release.json` is `text`. */
  files: Map<string, Uint8Array>;
};

const encode = (text: string) => new TextEncoder().encode(text);

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function pngChunk(type: string, data: number[]): number[] {
  const body = new Uint8Array([...encode(type), ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** A valid 1×1 RGBA PNG, its pixel stored uncompressed. */
function onePixelPng(rgba: [number, number, number, number]): Uint8Array {
  const raw = [0, ...rgba];
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const zlib = [
    0x78,
    0x01,
    0x01,
    raw.length,
    0,
    ~raw.length & 0xff,
    0xff,
    ...raw,
    ...u32((b << 16) | a),
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32(1), ...u32(1), 8, 6, 0, 0, 0]),
    ...pngChunk("IDAT", zlib),
    ...pngChunk("IEND", []),
  ]);
}

const fixtureGame = (id: string) =>
  defineGame({
    id,
    types: [],
    actions: [],
    time: { kind: "turns", rate: 30 },
    world: { physics: "none" },
    tables: { card: { description: "A card.", row: { cost: z.number().int() } } },
    createRuntime: () => ({ snapshot: () => null }),
  });

const scene = (name: string, assets: string[], at: [number, number]) => ({
  v: 4,
  name,
  bounds: [0, 0, 6.4, 3.84],
  settings: { physics: "none" },
  assets,
  entities: [{ id: "start", type: "marker", at, tags: ["spawn"] }],
});

/** A physics-free project as a host holds it: two scenes, a data table, a texture. */
function heldFiles(png: Uint8Array, pngHash: string, hallVariant: number) {
  const docs: Record<string, unknown> = {
    "scene-list.json": {
      kind: "scene-list",
      v: 1,
      start: "yard",
      scenes: [{ scene: "yard", title: "Yard" }, { scene: "hall" }],
    },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": scene("yard", ["tiles"], [1, 1]),
    "hall.json": scene("hall", [], [1 + hallVariant * 0.5, 1]),
    "data/cards.json": {
      kind: "data-table",
      v: 2,
      table: "card",
      rows: [
        { id: "fireball", cost: 3 },
        { id: "heal", cost: 2 },
      ],
    },
  };
  const texts = new Map<string, string>();
  const files: HeldFile[] = [];
  for (const [path, json] of Object.entries(docs)) {
    texts.set(path, `${JSON.stringify(json, null, 2)}\n`);
    files.push({ path, json });
  }
  const sidecar: AssetSidecar = {
    kind: "asset-sidecar",
    v: 1,
    key: "key-tiles",
    id: "tiles",
    sha256: pngHash,
    bytes: png.length,
    meta: { format: "png", width: 1, height: 1 },
    licence: { spdx: "CC0-1.0", author: "Test authors" },
  };
  files.push({ path: "art/tiles.png", sidecar });
  return { files, texts };
}

/** Distinct bytes of `size`, so each extra file is its own object. */
function filler(index: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(encode(`// chunk ${index}\n`).subarray(0, size));
  return bytes;
}

/**
 * A small release planned in memory through `./export`, with a hand-made
 * build standing in for the bundler: every file's real bytes, so its hashes
 * check, and the manifest text an upload begins with. A real game build
 * (tactics, bundled) goes through the same upload calls in the play-frame
 * smoke (`scripts/engine-smoke/play-adapter.ts`).
 */
export async function plannedRelease(opts: PlannedReleaseOptions = {}): Promise<PlannedRelease> {
  const project: ProjectFile = {
    kind: "project",
    v: 1,
    id: opts.projectId ?? "fixture",
    name: "Fixture",
    game: null,
  };
  const game = fixtureGame(opts.gameId ?? "fixture-game");
  const png = onePixelPng([64, 160, 96, 255]);
  const held = heldFiles(png, await sha256(png), opts.hallVariant ?? 0);
  const { view, kinds } = heldProject(held.files, createRegistry(game), {
    projectId: project.id,
    name: project.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const text = entry.sha256 === undefined ? held.texts.get(entry.path) : undefined;
    if (text !== undefined) texts.set(entry.id, text);
  }
  const values = new Map([...texts].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  const input: ExportInput = {
    project,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(game), view, values),
    game,
    engine: {},
    target: opts.target ?? "web",
    snapshot: await snapshotProject(view, texts, view.state.build),
  };

  const built = new Map<string, Uint8Array>([["code/main-fixture.js", encode("export {};\n")]]);
  const extra = opts.extraFiles ?? { count: 0, bytes: 0 };
  for (let i = 0; i < extra.count; i++)
    built.set(`code/chunk-${String(i).padStart(4, "0")}.js`, filler(i, extra.bytes));
  const code: BuiltCode = {
    files: await Promise.all(
      [...built].map(async ([path, bytes]) => ({
        path,
        sha256: await sha256(bytes),
        bytes: bytes.length,
        role: "code" as const,
      })),
    ),
    entry: "code/main-fixture.js",
    rapier: null,
    thirdParty: [],
  };
  const extraBytes = extra.count * extra.bytes;
  const room = extraBytes + 16 * 1_048_576;
  const budget: Partial<ExportBudget> | undefined =
    extra.count > 0
      ? {
          codeBytes: room,
          firstLoadBytes: room,
          totalBytes: room,
          fileBytes: Math.max(extra.bytes, 32 * 1_048_576),
        }
      : undefined;

  const plan = await finishExport(await planContent(input), code, input, budget);
  const errors = plan.issues.filter((i) => i.severity === "error");
  if (errors.length > 0)
    throw new Error(`the fixture release doesn't plan: ${errors.map((i) => i.message).join("; ")}`);

  const blobs = new Map([[await sha256(png), png]]);
  const files = new Map<string, Uint8Array>();
  for (const f of plan.files) {
    const { source } = f;
    const bytes =
      source.kind === "text"
        ? encode(source.text)
        : source.kind === "bytes"
          ? source.bytes
          : source.kind === "built"
            ? built.get(source.path)
            : blobs.get(source.sha256);
    if (!bytes) throw new Error(`the fixture has no bytes for "${f.path}"`);
    files.set(f.path, bytes);
  }

  const manifest: ReleaseManifest =
    opts.engineVersion === undefined
      ? plan.manifest
      : { ...plan.manifest, engine: { ...plan.manifest.engine, version: opts.engineVersion } };
  return {
    manifest,
    text: formatReleaseManifest(manifest),
    releaseId: await releaseId(manifest),
    files,
  };
}
