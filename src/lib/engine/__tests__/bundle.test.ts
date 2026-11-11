import {
  formatAssetDoc,
  materialKind,
  memoryContentStore,
  type ContentStore,
  type ProjectBundle,
  type ProjectFile,
} from "@jams/engine/project";
import { createRegistry, createScene, formatScene } from "@jams/engine/scene";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  engineAssetDocs,
  engineBlobs,
  engineProjects,
  sceneDocs,
  user,
} from "@/db/schema";
import { seedDefinition, seedState } from "@/lib/scene/doc-bytes";
import {
  assetDocValue,
  assetSnapshot,
  emptyProjectState,
  readProjectState,
  sceneDocValue,
  seedAssetState,
  seedProjectState,
} from "@/lib/scene/project-bytes";
import { seedUser, type TestDb } from "@/test/db";

import {
  bundleProjectState,
  parseProjectBundle,
  readHostedProject,
  reserveHostedProject,
  seedHostedProject,
  type BundleProblem,
} from "../bundle";
import { PNG } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const PROJECT = "kitchen";

const PROJECT_FILE: ProjectFile = {
  kind: "project",
  v: 1,
  id: PROJECT,
  name: "Kitchen",
  game: null,
  assets: ["**"],
  code: [],
};

const SCENE = formatScene(createScene("yard", createRegistry(null))).text;
const RUBBER = formatAssetDoc(materialKind, {
  kind: "material",
  v: 2,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
});
const ICE = formatAssetDoc(materialKind, { kind: "material", v: 2, description: "Slick." });
const POST = `${JSON.stringify({
  kind: "prefab",
  v: 2,
  id: "post",
  entities: [{ id: "pole", type: "solid", shape: ["box", 0, -20, 10, 40] }],
})}\n`;
const sidecar = (fields: Record<string, unknown>) =>
  `${JSON.stringify({ kind: "asset-sidecar", v: 1, ...fields })}\n`;

let PNG_HASH = "";

async function bundle(): Promise<ProjectBundle> {
  return {
    project: PROJECT_FILE,
    texts: {
      "scenes/yard.json": SCENE,
      "scenes/prefabs/post.json": POST,
      "materials/rubber.json": RUBBER,
      "materials/ice.json": ICE,
    },
    blobs: { "art/crate.png": PNG_HASH },
    sidecars: {
      "materials/ice.json": sidecar({ key: "frost", id: "ice", licence: { spdx: "CC0-1.0" } }),
      "art/crate.png": sidecar({ id: "crate", import: { filter: "nearest" } }),
    },
  };
}

/** The same bundle with every record's keys in reverse order. */
const reversed = (b: ProjectBundle): ProjectBundle => {
  const flip = <T>(r: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(r).reverse());
  return {
    project: b.project,
    texts: flip(b.texts),
    blobs: flip(b.blobs),
    sidecars: flip(b.sidecars),
  };
};

let db: TestDb;
let store: ContentStore;

async function addBlob(projectId = PROJECT) {
  await db.insert(engineBlobs).values({
    projectId,
    sha256: PNG_HASH,
    byteSize: PNG.byteLength,
    contentType: "image/png",
    storageKey: `engine-assets/${projectId}/${PNG_HASH}`,
  });
}

/** A reserved id with the bundle's blob uploaded under it, as a push leaves it. */
async function reserveWithBlob(projectId = PROJECT) {
  expect(await reserveHostedProject({ projectId, name: "Kitchen", createdById: "staff" })).toEqual({
    ok: true,
  });
  await addBlob(projectId);
}

async function seed(
  b?: ProjectBundle,
  extra: Partial<Parameters<typeof seedHostedProject>[0]> = {},
) {
  return seedHostedProject({
    bundle: b ?? (await bundle()),
    store,
    createdById: "staff",
    ...extra,
  });
}

/** Every row a seed writes, with the bytes as hex. */
async function rows(projectId = PROJECT) {
  const [project] = await db
    .select()
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId));
  const assets = await db
    .select({
      key: engineAssetDocs.assetKey,
      kind: engineAssetDocs.kind,
      seed: engineAssetDocs.seed,
      state: engineAssetDocs.state,
    })
    .from(engineAssetDocs)
    .where(eq(engineAssetDocs.projectId, projectId))
    .orderBy(engineAssetDocs.assetKey);
  const scenes = await db
    .select({
      sceneId: sceneDocs.sceneId,
      projectId: sceneDocs.projectId,
      seed: sceneDocs.seed,
      state: sceneDocs.state,
    })
    .from(sceneDocs)
    .where(eq(sceneDocs.projectId, projectId))
    .orderBy(sceneDocs.sceneId);
  return {
    project: project && {
      name: project.name,
      game: project.game,
      layout: project.layout,
      byteSize: project.byteSize,
      state: project.state && Buffer.from(project.state).toString("hex"),
    },
    assets,
    scenes,
  };
}

const codes = (problems: readonly BundleProblem[]) =>
  problems.flatMap((p) => p.issues.map((i) => `${p.path}: ${i.code}`));

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(sceneDocs);
  await db.delete(engineAssetDocs);
  await db.delete(engineBlobs);
  await db.delete(engineProjects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  store = memoryContentStore();
  PNG_HASH = await store.put(PNG);
});

describe("seedHostedProject", () => {
  it("holds the registry in the project row, seeds in asset rows and scenes with their project", async () => {
    await reserveWithBlob();
    const result = await seed();
    expect(result).toMatchObject({ ok: true, projectId: PROJECT, docs: 4, warnings: [] });

    const written = await rows();
    expect(written.project).toMatchObject({ name: "Kitchen", game: null, layout: 1 });
    expect(written.assets).toEqual([
      { key: "frost", kind: "material", seed: ICE, state: null },
      { key: "post", kind: "prefab", seed: POST, state: null },
      { key: "rubber", kind: "material", seed: RUBBER, state: null },
    ]);
    expect(written.scenes).toEqual([
      { sceneId: `${PROJECT}.yard`, projectId: PROJECT, seed: SCENE, state: null },
    ]);

    const registry = readProjectState(new Uint8Array(Buffer.from(written.project!.state!, "hex")));
    expect(registry.meta).toEqual({ projectId: PROJECT, layout: 1, name: "Kitchen" });
    expect(registry.assets.frost).toEqual({
      key: "frost",
      id: "ice",
      kind: "material",
      path: "materials/ice.json",
      licence: { spdx: "CC0-1.0" },
      created: { at: 0, by: "disk" },
    });
    expect(registry.assets.crate).toMatchObject({
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: PNG_HASH,
      bytes: PNG.byteLength,
      import: { filter: "nearest" },
      meta: { format: "png", width: 1, height: 1 },
    });
    expect(Object.keys(registry.assets).sort()).toEqual([
      "crate",
      "frost",
      "post",
      "rubber",
      "yard",
    ]);
    expect(written.project!.byteSize).toBe(Buffer.from(written.project!.state!, "hex").byteLength);
  });

  it("is byte-identical when seeded twice, whatever the bundle's key order", async () => {
    await reserveWithBlob();
    expect((await seed()).ok).toBe(true);
    const first = await rows();

    await db.delete(engineProjects).where(eq(engineProjects.projectId, PROJECT));
    expect((await rows()).assets).toEqual([]);
    await reserveWithBlob();
    expect((await seed(reversed(await bundle()))).ok).toBe(true);
    expect(await rows()).toEqual(first);
  });

  it("derives one state from one bundle", async () => {
    const a = await bundleProjectState((await bundle()) as ProjectBundle, { store });
    const b = await bundleProjectState(reversed(await bundle()), { store });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(seedProjectState(a.state)).toEqual(seedProjectState(b.state));
    expect(a.docs).toEqual(b.docs);
    expect(a.blobs).toEqual([PNG_HASH]);
  });

  it("seeds a free id when the bundle has no blobs, and stores the code map", async () => {
    const b = await bundle();
    const { "art/crate.png": _png, ...sidecars } = b.sidecars;
    const result = await seed(
      { ...b, blobs: {}, sidecars },
      { game: "kitchen-game", code: { "index.ts": { registers: { types: ["crate"] } } } },
    );
    expect(result).toMatchObject({ ok: true, docs: 4 });
    const written = await rows();
    expect(written.project).toMatchObject({ game: "kitchen-game" });
    const registry = readProjectState(new Uint8Array(Buffer.from(written.project!.state!, "hex")));
    expect(registry.code).toEqual({ "index.ts": { registers: { types: ["crate"] } } });
  });

  it("refuses an id that already holds a project", async () => {
    await reserveWithBlob();
    expect((await seed()).ok).toBe(true);
    const before = await rows();
    expect(await seed()).toEqual({ ok: false, reason: "exists" });
    expect(await reserveHostedProject({ projectId: PROJECT, name: "Again" })).toEqual({
      ok: false,
      reason: "exists",
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses a deleted project's id, one with docs, and one the service has opened", async () => {
    const b = await bundle();
    const { "art/crate.png": _png, ...sidecars } = b.sidecars;
    const noBlobs = { ...b, blobs: {}, sidecars };

    await db
      .insert(engineProjects)
      .values({ projectId: PROJECT, name: "Gone", deletedAt: new Date() });
    expect(await seed(noBlobs)).toEqual({ ok: false, reason: "exists" });
    await db.delete(engineProjects);

    await db.insert(engineProjects).values({ projectId: PROJECT, name: "Backfilled" });
    await db.insert(sceneDocs).values({ sceneId: `${PROJECT}.old`, projectId: PROJECT });
    expect(await seed(noBlobs)).toEqual({ ok: false, reason: "exists" });
    await db.delete(engineProjects);

    await db.insert(engineProjects).values({
      projectId: PROJECT,
      name: "Opened",
      state: Buffer.from(seedProjectState(emptyProjectState(PROJECT, "Opened"))),
    });
    expect(await seed(noBlobs)).toEqual({ ok: false, reason: "exists" });
    expect(await db.select().from(engineAssetDocs)).toEqual([]);
  });

  it("needs every blob in engine_blobs for the project", async () => {
    expect(await seed()).toMatchObject({
      ok: false,
      reason: "invalid",
      problems: [{ path: "art/crate.png", issues: [{ code: "hash-mismatch" }] }],
    });
    expect((await rows()).project).toBeUndefined();

    await reserveHostedProject({ projectId: PROJECT, name: "Kitchen" });
    expect(await seed()).toMatchObject({ ok: false, reason: "invalid" });

    await db.insert(engineProjects).values({ projectId: "elsewhere", name: "Elsewhere" });
    await addBlob("elsewhere");
    expect(await seed()).toMatchObject({ ok: false, reason: "invalid" });
    expect(await db.select().from(engineAssetDocs)).toEqual([]);
  });

  it("needs the blob's bytes in the content store", async () => {
    await reserveWithBlob();
    store = memoryContentStore();
    const result = await seed();
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "invalid") return;
    expect(codes(result.problems)).toEqual(["art/crate.png: hash-mismatch"]);
  });

  it("asks the quota policy about the docs it creates", async () => {
    await reserveWithBlob();
    const result = await seed(undefined, {
      quota: {
        check: (usage, add) => ({
          ok: false,
          limit: "docs",
          used: usage.docs + (add.docs ?? 0),
          max: 2,
          message: "too many docs",
        }),
      },
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "quota-exceeded",
      refusal: { code: "quota-exceeded", limit: "docs", used: 4, max: 2 },
    });
  });
});

describe("bundle validation", () => {
  const judge = async (patch: (b: ProjectBundle) => ProjectBundle) => {
    const result = await seed(patch(await bundle()));
    expect(result.ok).toBe(false);
    return !result.ok && result.reason === "invalid" ? codes(result.problems) : [];
  };

  it("refuses what isn't a bundle or has no valid project file", async () => {
    expect(parseProjectBundle({ project: PROJECT_FILE, texts: {} })).toMatchObject({ ok: false });
    expect(
      parseProjectBundle({
        project: { ...PROJECT_FILE, id: "Not An Id" },
        texts: {},
        blobs: {},
        sidecars: {},
      }),
    ).toMatchObject({ ok: false, problems: [{ path: "jams.project.json" }] });
    expect(await seed({ nope: true } as unknown as ProjectBundle)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses bad paths, paths outside the globs and files of no kind", async () => {
    expect(
      await judge((b) => ({
        ...b,
        project: { ...b.project, assets: ["scenes/**", "materials/**", "art/**"] },
        texts: {
          ...b.texts,
          "../up.json": RUBBER,
          "notes/readme.json": RUBBER,
          "materials/broken.json": "{",
          "materials/odd.json": `${JSON.stringify({ kind: "nope", v: 1 })}\n`,
          "art/fake.png": "not text",
        },
      })),
    ).toEqual([
      "../up.json: schema",
      "art/fake.png: asset-kind",
      "materials/broken.json: asset-kind",
      "materials/odd.json: asset-kind",
      "notes/readme.json: schema",
    ]);
  });

  it("refuses a sidecar with no file, a path in both maps and an id two assets share", async () => {
    expect(
      await judge((b) => ({
        ...b,
        blobs: { ...b.blobs, "materials/rubber.json": PNG_HASH },
        sidecars: {
          ...b.sidecars,
          "art/missing.png": sidecar({ id: "missing" }),
          "scenes/prefabs/post.json": sidecar({ key: "other-post", id: "ice" }),
        },
      })),
    ).toEqual([
      "art/missing.png.asset.json: ref-not-found",
      "materials/rubber.json: schema",
      "scenes/prefabs/post.json: asset-id-taken",
    ]);
  });

  it("refuses a scene seed the service can't lay out and a bad code map", async () => {
    const result = await seed(
      {
        ...(await bundle()),
        texts: { ...(await bundle()).texts, "scenes/new.json": `{"v": 99}\n` },
      },
      { code: { "index.ts": { registers: { types: "crate" } } } as never },
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "invalid") return;
    expect(codes(result.problems)).toEqual(["scenes/new.json: schema", ": schema"]);
  });

  it("keeps a binary whose header doesn't read, without meta, as the dev scan does", async () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    const hash = await store.put(junk);
    const b = await bundle();
    const result = await bundleProjectState(
      { ...b, blobs: { ...b.blobs, "art/junk.png": hash } },
      { store },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assets.junk).toMatchObject({ sha256: hash, bytes: 4 });
    expect(result.state.assets.junk?.meta).toBeUndefined();
    expect(codes(result.warnings)).toEqual(["art/junk.png: import-failed"]);
  });
});

describe("readHostedProject", () => {
  it("reads every doc back as a seed or state, with the blob hashes", async () => {
    await reserveWithBlob();
    const seeded = await seed();
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const derived = await bundleProjectState(await bundle(), { store });
    if (!derived.ok) throw new Error("bundle refused");

    const read = (await readHostedProject(PROJECT))!;
    expect(read).toMatchObject({ projectId: PROJECT, name: "Kitchen", game: null });
    expect(read.project).toEqual(seeded.state);
    const registry = readProjectState(read.project);
    expect(registry.assets).toEqual(derived.state.assets);
    expect(registry.meta).toEqual(derived.state.meta);
    expect(read.blobs).toEqual([
      { sha256: PNG_HASH, bytes: PNG.byteLength, contentType: "image/png" },
    ]);
    expect(read.docs.map((d) => [d.prefix, d.key, d.kind, d.state, d.seed])).toEqual([
      ["scene", "yard", "scene", null, SCENE],
      ["asset", "frost", "material", null, ICE],
      ["asset", "post", "prefab", null, POST],
      ["asset", "rubber", "material", null, RUBBER],
    ]);

    // What the service seeds from those rows gives the files back.
    const sceneId = `${PROJECT}.yard`;
    const scene = sceneDocValue(seedState(sceneId, seedDefinition(sceneId, read.docs[0]!.seed)));
    expect(formatScene(scene!).text).toBe(SCENE);
    const rubber = seedAssetState({
      project: PROJECT,
      key: "rubber",
      kind: "material",
      seed: RUBBER,
    });
    expect((await assetSnapshot(rubber))?.text).toBe(RUBBER);
  });

  it("reads a stored state in place of the seed once the service has written one", async () => {
    await reserveWithBlob();
    expect((await seed()).ok).toBe(true);
    const state = seedAssetState({
      project: PROJECT,
      key: "rubber",
      kind: "material",
      seed: RUBBER,
    });
    await db
      .update(engineAssetDocs)
      .set({ state: Buffer.from(state), byteSize: state.byteLength })
      .where(eq(engineAssetDocs.assetKey, "rubber"));

    const doc = (await readHostedProject(PROJECT))!.docs.find((d) => d.key === "rubber")!;
    expect(doc.seed).toBeNull();
    expect(doc.state).toEqual(state);
    expect(formatAssetDoc(materialKind, assetDocValue(doc.state!) as never)).toBe(RUBBER);
  });

  it("answers the empty registry the service would seed for an unopened project", async () => {
    await reserveHostedProject({ projectId: PROJECT, name: "Kitchen" });
    const read = (await readHostedProject(PROJECT))!;
    expect(read.project).toEqual(seedProjectState(emptyProjectState(PROJECT, "Kitchen")));
    expect(read.docs).toEqual([]);
  });

  it("has nothing for a missing or deleted project", async () => {
    expect(await readHostedProject("nope")).toBeNull();
    expect(await readHostedProject("Not An Id")).toBeNull();
    await db
      .insert(engineProjects)
      .values({ projectId: PROJECT, name: "Gone", deletedAt: new Date() });
    expect(await readHostedProject(PROJECT)).toBeNull();
  });
});
