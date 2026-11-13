// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { checkedTestGame } from "../../__tests__/fixtures/test-game";
import { applyOpsToDoc } from "../../collab/apply";
import { stampWins } from "../../collab/build-stamp";
import { docToScene } from "../../collab/convert";
import { readLog } from "../../collab/log";
import { applyProjectBatch, applyRegistryBatch } from "../../collab/project-apply";
import { projectBuildMap, projectCodeMap, readProject, writeEntry } from "../../collab/project-doc";
import { readProjectLog } from "../../collab/project-log";
import { createProjectSession } from "../../collab/project-session";
import type { SceneOrigin } from "../../collab/types";
import { stableJson } from "../../project/canonical";
import type { ContentStore } from "../../project/content-store";
import { docNameOf } from "../../project/doc-names";
import { inspectEntry } from "../../project/inspect/entry";
import { buildRefIndex } from "../../project/refs";
import { projectView } from "../../project/view";
import { formatScene } from "../../scene/format";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import { ASSET_CHANGED, listenSceneCollab, type ListeningSceneCollab } from "../collab-server";
import { fileContentStore } from "../content-store";
import { gameRegisters, readFileProject } from "../project-files";
import {
  connect,
  engineProjectCopy,
  pushed,
  record,
  until,
  type ProjectCopy,
} from "./dev-server-fixture";

const YARD = docNameOf({ kind: "scene", project: "engine", key: "engine-yard" });
const PROJECT = docNameOf({ kind: "project", project: "engine" });
const ada: SceneOrigin = { kind: "user", userId: "ada" };
const bob: SceneOrigin = { kind: "user", userId: "bob" };
const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`../../project/__tests__/fixtures/${name}`, import.meta.url)));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let copy: ProjectCopy;
let server: ListeningSceneCollab;
const clients: HocuspocusProvider[] = [];
const warnings: string[] = [];

const registry = () => copy.project.registry;
const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
const disk = () => copy.read("engine-yard.json");
const serverDoc = (name = YARD) => server.server.hocuspocus.documents.get(name)!;
const open = (name = YARD) => connect(server.url, name, clients);

async function start(paths = ["engine-yard.json"]) {
  copy = await engineProjectCopy(paths);
  server = await listenSceneCollab({
    projects: [copy.project],
    debounceMs: 50,
    watchDelayMs: 20,
    settleMs: 150,
    buildAt: 1234,
    warn: (m) => warnings.push(m),
  });
}

beforeEach(() => {
  warnings.length = 0;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  await server?.close();
  await copy?.remove();
});

describe("the dev collab server: scene docs", () => {
  beforeEach(() => start());

  it("seeds scene:<project>.<key> from its file and serves the scene and project lists", async () => {
    const { doc } = await open();
    expect(text(doc)).toBe(await disk());
    expect(readLog(doc)).toEqual([]);
    const scenes = await fetch(`${server.httpUrl}/__scene`);
    expect(await scenes.json()).toEqual({ ok: true, scenes: ["engine-yard"] });
    const projects = await fetch(`${server.httpUrl}/__project`);
    expect(await projects.json()).toEqual({
      ok: true,
      projects: [{ id: "engine", name: "Engine", game: null }],
    });
  });

  it("refuses a doc name outside the grammar or the projects it serves", async () => {
    for (const name of ["scene:engine-yard", "scene:other.engine-yard"]) {
      warnings.length = 0;
      const provider = new HocuspocusProvider({ url: server.url, name });
      clients.push(provider);
      await until(() => warnings.length > 0, `the refusal of ${name}`);
      expect(warnings[0]).toContain("isn't a doc of a project this server holds");
      expect(provider.synced).toBe(false);
    }
  });

  it("turns a disk edit during a session into one disk transaction, then stores canonical form", async () => {
    const { doc } = await open();
    const seen = record(doc);
    const def = parseSceneOrThrow(await disk(), registry());
    const edited = applyOps(
      def,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 40 } }] },
      registry(),
    );
    if (!edited.ok) throw new Error(edited.issue.message);
    // Valid but not canonical, as a hand edit would leave it.
    await writeFile(copy.file("engine-yard.json"), `${JSON.stringify(edited.def, null, 2)}\n`);

    await until(() => seen.length > 0, "the disk change to reach the client");
    await server.idle();
    await until(async () => (await disk()) === formatScene(edited.def).text, "the canonical store");
    await new Promise((r) => setTimeout(r, 150));
    await server.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.local).toBe(false);
    expect(seen[0]!.entries.map((e) => e.actor)).toEqual([{ kind: "disk" }]);
    expect(text(doc)).toBe(formatScene(edited.def).text);
    expect(await disk()).toBe(text(doc));
    expect(warnings).toEqual([]);
  });

  it("converges two clients' edits and leaves the file canonical", async () => {
    const a = await open();
    const b = await open();
    const ra = applyOpsToDoc(
      a.doc,
      { ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] },
      ada,
      registry(),
    );
    const rb = applyOpsToDoc(
      b.doc,
      { ops: [{ op: "add", entity: { id: "flag", type: "marker", at: [50, 50] } }] },
      bob,
      registry(),
    );
    expect(ra.ok && rb.ok).toBe(true);
    await Promise.all([pushed(a.provider), pushed(b.provider)]);
    await until(() => text(a.doc) === text(b.doc), "the clients to converge");

    await until(async () => (await disk()) === text(a.doc), "the store");
    expect(text(serverDoc())).toBe(text(a.doc));
    const onDisk = parseSceneOrThrow(await disk(), registry());
    expect(formatScene(onDisk).text).toBe(await disk());
    expect(onDisk.entities!.map((e) => e.id)).toContain("flag");
  });

  it("doesn't echo its own writes back as disk transactions", async () => {
    const a = await open();
    const b = await open();
    const seen = record(b.doc);
    const before = await disk();
    applyOpsToDoc(a.doc, { ops: [{ op: "setScene", set: { name: "renamed" } }] }, ada, registry());
    await pushed(a.provider);
    await until(async () => (await disk()) !== before, "the store");
    await new Promise((r) => setTimeout(r, 200));
    await server.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.entries.map((e) => e.actor.kind)).toEqual(["user"]);
    expect(readLog(serverDoc()).some((e) => e.actor.kind === "disk")).toBe(false);
    expect(readProjectLog(serverDoc(PROJECT))).toEqual([]);
    expect(JSON.parse(await disk()).name).toBe("renamed");
  });
});

describe("the dev collab server: the project doc", () => {
  it("seeds the registry with keys equal to ids, the code map and this build's stamps", async () => {
    await start(["engine-yard.json", "engine-yard.checks.json"]);
    const { doc } = await open(PROJECT);
    const state = readProject(doc);
    const assets = Object.values(state.assets).filter((e) => e.kind !== "material");
    expect(assets.map((e) => [e.key, e.id, e.kind])).toEqual([
      ["engine-yard", "engine-yard", "scene"],
      ["engine-yard-checks", "engine-yard-checks", "checks"],
    ]);
    expect(state.code).toEqual({});
    const stamps = [...projectBuildMap(doc).values()];
    expect(stamps.length).toBeGreaterThan(0);
    expect(new Set(stamps.map((s) => s.buildAt))).toEqual(new Set([1233]));
    // A page on the server's own build outranks the server, whatever its hash.
    for (const stamp of stamps) expect(stampWins(1234, "0".repeat(64), stamp)).toBe(true);
  });

  it("lists the code modules, the game module with what the loaded game registers, and follows new ones", async () => {
    await start();
    await writeFile(copy.file("index.ts"), "export {};\n");
    await mkdir(copy.file("__tests__"));
    await writeFile(copy.file("__tests__/a.test.ts"), "export {};\n");
    await writeFile(
      copy.file("jams.project.json"),
      JSON.stringify({
        kind: "project",
        v: 1,
        id: "engine",
        name: "Engine",
        game: { module: "./index.ts", export: "game" },
        code: ["**/*.ts", "!**/__tests__/**"],
      }),
    );
    await server.close();
    const project = await readFileProject(copy.dir, {
      game: checkedTestGame,
      cacheDir: copy.cacheDir,
    });
    server = await listenSceneCollab({
      projects: [project],
      debounceMs: 50,
      watchDelayMs: 20,
      warn: (m) => warnings.push(m),
    });
    const { doc } = await open(PROJECT);
    expect(projectCodeMap(doc).toJSON()).toEqual({
      "index.ts": { registers: gameRegisters(checkedTestGame) },
    });
    expect(gameRegisters(checkedTestGame).tables).toHaveLength(1);
    await writeFile(copy.file("extra.ts"), "export {};\n");
    await until(() => projectCodeMap(doc).has("extra.ts"), "the new module");
    expect(projectCodeMap(doc).get("extra.ts")).toEqual({ registers: {} });
  });

  it("turns a disk move into one registry op with the disk origin, keeping the key", async () => {
    await start();
    const project = await open(PROJECT);
    await open();
    await mkdir(copy.file("levels"));
    await rename(copy.file("engine-yard.json"), copy.file("levels/engine-yard.json"));
    await until(
      () => readProject(project.doc).assets["engine-yard"]?.path === "levels/engine-yard.json",
      "the move to reach the registry",
    );
    await server.idle();
    const entry = readProject(project.doc).assets["engine-yard"]!;
    expect([entry.id, entry.deleted]).toEqual(["engine-yard", undefined]);
    expect(readProjectLog(project.doc).map((e) => e.actor)).toEqual([{ kind: "disk" }]);
    expect(warnings).toEqual([]);
  });

  it("turns a disk delete into a deleteAsset to the trash", async () => {
    await start();
    const project = await open(PROJECT);
    await rm(copy.file("engine-yard.json"));
    await until(
      () => readProject(project.doc).assets["engine-yard"]?.deleted?.by === "disk",
      "the delete to reach the registry",
    );
  });

  it("restores a trashed prefab a loaded scene still names, on store", async () => {
    await start(["kitchen-sink.json", "prefabs/post.json", "prefabs/gate.json"]);
    const project = await open(PROJECT);
    await open(docNameOf({ kind: "scene", project: "engine", key: "kitchen-sink" }));
    const result = applyRegistryBatch(
      project.doc,
      { v: 1, ops: [{ op: "deleteAsset", id: "gate", force: true }] },
      ada,
      { registry: registry(), kinds: copy.project.kinds },
    );
    expect(result.ok).toBe(true);
    await pushed(project.provider);
    await until(
      () => readProjectLog(project.doc).some((e) => e.actor.kind === "repair"),
      "the repair",
    );
    expect(readProject(project.doc).assets.gate!.deleted).toBeUndefined();
    expect(readProjectLog(project.doc).at(-1)).toMatchObject({
      actor: { kind: "repair", reason: "asset-in-use" },
      label: "Restore gate",
    });
    await server.idle();
    expect(await copy.read("prefabs/gate.json")).toContain('"id": "gate"');
    expect(warnings.some((w) => w.includes("asset-in-use"))).toBe(true);
  });

  it("writes each held entry as its own path frees, whichever is reported", async () => {
    await start(["engine-yard.json", "prefabs/post.json", "prefabs/gate.json"]);
    await writeFile(copy.file("stuff"), "a file");
    await writeFile(copy.file("other"), "a file");
    const postText = await copy.read("prefabs/post.json");
    const gateText = await copy.read("prefabs/gate.json");
    const project = await open(PROJECT);
    const entry = (id: string) => readProject(project.doc).assets[id]!;
    writeEntry(project.doc, { ...entry("post"), path: "stuff/post.json" });
    writeEntry(project.doc, { ...entry("gate"), path: "other/gate.json" });
    await pushed(project.provider);
    await until(() => warnings.some((w) => w.includes("path-taken")), "the path-taken warning");
    const reported = warnings.find((w) => w.includes("path-taken"))!;
    const [first, second] = reported.includes('blocked by "stuff"')
      ? (["stuff", "other"] as const)
      : (["other", "stuff"] as const);
    const moved: Record<string, readonly [string, string]> = {
      stuff: ["stuff/post.json", postText],
      other: ["other/gate.json", gateText],
    };

    await rm(copy.file(second));
    const [secondPath, secondText] = moved[second]!;
    await until(
      () =>
        copy.read(secondPath).then(
          () => true,
          () => false,
        ),
      `${secondPath} once only its own holder is gone`,
    );
    await server.idle();
    expect(await copy.read(secondPath)).toBe(secondText);
    expect(await copy.read(first)).toBe("a file");

    await rm(copy.file(first));
    const [firstPath, firstText] = moved[first]!;
    await until(
      () =>
        copy.read(firstPath).then(
          () => true,
          () => false,
        ),
      `${firstPath} once its holder is gone`,
    );
    await server.idle();
    expect(await copy.read(firstPath)).toBe(firstText);
  });

  it("leaves a forced delete trashed while its referrers are closed, and restores it once one loads", async () => {
    await start(["kitchen-sink.json", "prefabs/post.json", "prefabs/gate.json"]);
    const project = await open(PROJECT);
    const sink = docNameOf({ kind: "scene", project: "engine", key: "kitchen-sink" });
    const gateText = await copy.read("prefabs/gate.json");
    const result = applyRegistryBatch(
      project.doc,
      { v: 1, ops: [{ op: "deleteAsset", id: "gate", force: true }] },
      ada,
      { registry: registry(), kinds: copy.project.kinds },
    );
    expect(result.ok).toBe(true);
    await pushed(project.provider);
    await until(
      () =>
        copy.read("prefabs/gate.json").then(
          () => false,
          () => true,
        ),
      "the trash",
    );
    await new Promise((r) => setTimeout(r, 150));
    await server.idle();
    expect(server.server.hocuspocus.documents.has(sink)).toBe(false);
    expect(readProject(project.doc).assets.gate!.deleted).toBeDefined();
    expect(readProjectLog(project.doc).some((e) => e.actor.kind === "repair")).toBe(false);
    const view = projectView(readProject(project.doc), copy.project.kinds);
    const values = new Map([["kitchen-sink", JSON.parse(await copy.read("kitchen-sink.json"))]]);
    const missing = buildRefIndex(view, values, copy.project.kinds, {
      registry: registry(),
      project: view,
    }).dangling();
    expect(missing.map((i) => [i.code, i.got])).toContainEqual(["asset-missing", "gate"]);

    await open(sink);
    await until(() => !readProject(project.doc).assets.gate!.deleted, "the restore on load");
    expect(readProjectLog(project.doc).at(-1)).toMatchObject({
      actor: { kind: "repair", reason: "asset-in-use" },
      label: "Restore gate",
    });
    await until(
      () =>
        copy.read("prefabs/gate.json").then(
          (t) => t === gateText,
          () => false,
        ),
      "the restored file",
    );
  });

  it("points a binary whose bytes the store lacks back at its file's (hash-mismatch)", async () => {
    await start();
    const png = await fixture("texture.png");
    await writeFile(copy.file("crate.png"), png);
    const project = await open(PROJECT);
    await until(() => readProject(project.doc).assets.crate !== undefined, "the add");
    const entry = readProject(project.doc).assets.crate!;
    project.doc.transact(() =>
      writeEntry(project.doc, { ...entry, sha256: "ab".repeat(32), bytes: 3 }),
    );
    await pushed(project.provider);
    await until(() => readProject(project.doc).assets.crate!.sha256 === sha(png), "the repair");
    expect(readProject(project.doc).assets.crate).toMatchObject({
      sha256: sha(png),
      bytes: png.byteLength,
      meta: { format: "png", width: 12, height: 10 },
    });
    expect(readProjectLog(project.doc).at(-1)!.actor).toEqual({
      kind: "repair",
      reason: "hash-mismatch",
    });
    expect(warnings.some((w) => w.includes("hash-mismatch"))).toBe(true);
  });

  it("sends asset:changed on the project doc when a binary's bytes change on disk", async () => {
    await start();
    const png = await fixture("texture.png");
    const hero = await fixture("hero.png");
    await writeFile(copy.file("crate.png"), png);
    const project = await open(PROJECT);
    await until(() => readProject(project.doc).assets.crate !== undefined, "the add");
    await server.idle();
    await writeFile(copy.file("crate.png"), hero);
    await until(() => project.stateless.length > 0, "the asset:changed message");
    expect(JSON.parse(project.stateless[0]!)).toEqual({
      type: ASSET_CHANGED,
      project: "engine",
      key: "crate",
      id: "crate",
      kind: "texture",
      path: "crate.png",
      sha256: sha(hero),
      bytes: hero.byteLength,
      previous: sha(png),
    });
    expect(readProject(project.doc).assets.crate).toMatchObject({ meta: { width: 32 } });
    await server.idle();
    expect(project.stateless).toHaveLength(1);
  });
});

describe("the dev collab server: binaries end to end", () => {
  /** The dev server's content store as a browser or the CLI sees it: its blob routes. */
  const routeStore = (): ContentStore => {
    const at = (hash: string) => `${server.httpUrl}/__project/engine/blob/${hash}`;
    return {
      has: async (hash) => (await fetch(at(hash))).status === 200,
      async get(hash) {
        const res = await fetch(at(hash));
        return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
      },
      async put(bytes, expect) {
        const res = await fetch(`${server.httpUrl}/__project/engine/blob`, {
          method: "POST",
          body: new Uint8Array(bytes),
          headers: expect ? { "x-expect-sha256": expect } : {},
        });
        if (res.status !== 200) throw new Error(`upload refused: ${res.status}`);
        return ((await res.json()) as { sha256: string }).sha256;
      },
    };
  };

  /** A project session over the server's websocket, reading blobs through its routes. */
  const liveSession = (origin: SceneOrigin) =>
    createProjectSession({
      project: "engine",
      origin,
      registry: registry(),
      kinds: copy.project.kinds,
      store: routeStore(),
      openDoc: async (name) => {
        const { doc, provider } = await connect(server.url, name, clients);
        return { doc, awareness: provider.awareness!, close: () => provider.destroy() };
      },
    });

  const sidecar = async (path: string) =>
    JSON.parse(await copy.read(`${path}.asset.json`)) as Record<string, unknown>;

  async function withCrate() {
    await start();
    const png = await fixture("texture.png");
    await writeFile(copy.file("crate.png"), png);
    const project = await open(PROJECT);
    await until(() => readProject(project.doc).assets.crate !== undefined, "the add");
    await server.idle();
    return { png, project };
  }

  it("uploads, then replaceContent from a session: the file and sidecar follow and asset:changed names the new hash", async () => {
    const { png, project } = await withCrate();
    const hero = new Uint8Array(await fixture("hero.png"));
    const session = await liveSession(ada);
    const store = session.store!;
    const hash = await store.put(hero, sha(hero));
    const result = await applyProjectBatch(
      session,
      { v: 1, ops: [{ op: "replaceContent", id: "crate", sha256: hash, bytes: hero.byteLength }] },
      ada,
    );
    expect(result.ok).toBe(true);
    await until(() => project.stateless.length > 0, "the asset:changed message");
    expect(JSON.parse(project.stateless[0]!)).toEqual({
      type: ASSET_CHANGED,
      project: "engine",
      key: "crate",
      id: "crate",
      kind: "texture",
      path: "crate.png",
      sha256: hash,
      bytes: hero.byteLength,
      previous: sha(png),
    });
    await until(
      async () => sha(await readFile(copy.file("crate.png"))) === hash,
      "the file to take the new bytes",
    );
    await server.idle();
    expect(await sidecar("crate.png")).toMatchObject({
      sha256: hash,
      bytes: hero.byteLength,
      meta: { format: "png", width: 32, height: 8 },
    });
    expect(readProject(project.doc).history.crate!.map((h) => [h.sha256, h.by])).toEqual([
      [sha(png), "ada"],
      [hash, "ada"],
    ]);
    expect(warnings).toEqual([]);
    session.destroy();
  });

  it("refuses a session's replace or import whose bytes were never uploaded, and a recording's replace", async () => {
    const { project } = await withCrate();
    const recording = await fixture("run.recording.json");
    await writeFile(copy.file("run.recording.json"), recording);
    await until(() => readProject(project.doc).assets["run-recording"] !== undefined, "the add");
    await server.idle();
    const session = await liveSession(ada);
    const hero = new Uint8Array(await fixture("hero.png"));
    const missing = await applyProjectBatch(
      session,
      {
        v: 1,
        ops: [{ op: "replaceContent", id: "crate", sha256: sha(hero), bytes: hero.byteLength }],
      },
      ada,
    );
    expect(missing.ok || missing.issue.code).toBe("hash-mismatch");
    const imported = await applyProjectBatch(
      session,
      {
        v: 1,
        ops: [{ op: "importAsset", path: "hero.png", sha256: sha(hero), bytes: hero.byteLength }],
      },
      ada,
    );
    expect(imported.ok || imported.issue.code).toBe("hash-mismatch");
    await session.store!.put(hero);
    const frozen = await applyProjectBatch(
      session,
      {
        v: 1,
        ops: [
          { op: "replaceContent", id: "run-recording", sha256: sha(hero), bytes: hero.byteLength },
        ],
      },
      ada,
    );
    expect(frozen.ok || frozen.issue.code).toBe("asset-kind");
    expect(readProject(project.doc).assets.crate!.sha256).toBe(sha(await fixture("texture.png")));
    session.destroy();
  });

  it("two clients replacing one binary at once end on one hash on disk, with both in its history and both blobs kept", async () => {
    const { png, project } = await withCrate();
    const other = await open(PROJECT);
    const hero = await fixture("hero.png");
    const resaved = Buffer.concat([png, Buffer.from([0])]);
    const store = fileContentStore(copy.cacheDir);
    for (const bytes of [hero, resaved]) await store.put(new Uint8Array(bytes));
    const replace = (doc: Y.Doc, bytes: Buffer, origin: SceneOrigin) => {
      const r = applyRegistryBatch(
        doc,
        {
          v: 1,
          ops: [{ op: "replaceContent", id: "crate", sha256: sha(bytes), bytes: bytes.byteLength }],
        },
        origin,
        {
          registry: registry(),
          kinds: copy.project.kinds,
          inspect: (def, entry) => inspectEntry(def, entry, new Uint8Array(bytes), () => undefined),
        },
      );
      expect(r.ok).toBe(true);
    };
    // No await between them, so neither client has seen the other's update.
    replace(project.doc, resaved, ada);
    replace(other.doc, hero, bob);
    await pushed(project.provider);
    await pushed(other.provider);
    const settled = () =>
      stableJson(readProject(project.doc)) === stableJson(readProject(other.doc));
    await until(settled, "the clients to converge");
    await server.idle();
    const end = readProject(serverDoc(PROJECT));
    const crate = end.assets.crate!;
    expect([sha(resaved), sha(hero)]).toContain(crate.sha256);
    const winner = crate.sha256 === sha(hero) ? hero : resaved;
    expect(crate).toMatchObject({
      bytes: winner.byteLength,
      meta: { width: winner === hero ? 32 : 12 },
    });
    await until(
      async () => sha(await readFile(copy.file("crate.png"))) === crate.sha256,
      "the winner's bytes on disk",
    );
    expect(new Set(end.history.crate!.map((h) => h.sha256))).toEqual(
      new Set([sha(png), sha(resaved), sha(hero)]),
    );
    for (const bytes of [png, resaved, hero]) expect(await store.has(sha(bytes))).toBe(true);
    expect(await sidecar("crate.png")).toMatchObject({ sha256: crate.sha256 });
  });

  it("re-inspects on store a binary whose meta lags its bytes and settings", async () => {
    await start();
    await writeFile(copy.file("hero.png"), await fixture("hero.png"));
    await writeFile(copy.file("hero.atlas.json"), await fixture("hero.json"));
    const project = await open(PROJECT);
    await until(() => readProject(project.doc).assets["hero-atlas"] !== undefined, "the add");
    await server.idle();
    const atlas = readProject(project.doc).assets["hero-atlas"]!;
    expect(atlas.import).toEqual({ texture: "hero" });
    // What a merge of a pivot edit and an edit made without it leaves: the settings, but not their meta.
    project.doc.transact(() =>
      writeEntry(project.doc, { ...atlas, import: { ...atlas.import, pivotDefault: [0, 1] } }),
    );
    await pushed(project.provider);
    const pivoted = () =>
      Object.values(
        (readProject(project.doc).assets["hero-atlas"]!.meta as { frames: object }).frames,
      ).every((f) => "pivot" in f);
    await until(pivoted, "the re-inspection");
    expect(readProjectLog(project.doc).at(-1)).toMatchObject({
      actor: { kind: "repair", reason: "reinspect" },
      label: "Re-inspect hero-atlas",
    });
    await server.idle();
    expect(await sidecar("hero.atlas.json")).toMatchObject({
      import: { texture: "hero", pivotDefault: [0, 1] },
    });
    expect(project.stateless).toEqual([]);
  });
});

describe("the dev server's blob routes", () => {
  beforeEach(() => start());

  it("stores a POSTed blob, answers its hash and size, and serves it immutable", async () => {
    const png = new Uint8Array(await fixture("texture.png"));
    const res = await fetch(`${server.httpUrl}/__project/engine/blob`, {
      method: "POST",
      body: png,
      headers: { "x-expect-sha256": sha(png) },
    });
    expect([res.status, await res.json()]).toEqual([
      200,
      { sha256: sha(png), bytes: png.byteLength },
    ]);
    expect(await fileContentStore(copy.cacheDir).has(sha(png))).toBe(true);

    const got = await fetch(`${server.httpUrl}/__project/engine/blob/${sha(png)}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
  });

  it("refuses mismatched bytes, unknown blobs and projects, and other sites' pages", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const wrong = await fetch(`${server.httpUrl}/__project/engine/blob`, {
      method: "POST",
      body,
      headers: { "x-expect-sha256": "ab".repeat(32) },
    });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { issue: { code: string } }).issue.code).toBe("hash-mismatch");
    expect(await fileContentStore(copy.cacheDir).has(sha(body))).toBe(false);

    expect((await fetch(`${server.httpUrl}/__project/engine/blob/${"cd".repeat(32)}`)).status).toBe(
      404,
    );
    expect((await fetch(`${server.httpUrl}/__project/engine/blob/nope`)).status).toBe(400);
    expect((await fetch(`${server.httpUrl}/__project/other/blob`, { method: "POST" })).status).toBe(
      404,
    );
    const cross = await fetch(`${server.httpUrl}/__project/engine/blob`, {
      method: "POST",
      body,
      headers: { origin: "https://elsewhere.test" },
    });
    expect(cross.status).toBe(403);
  });
});
